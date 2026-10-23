import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The iPhone's offline queue replayed against the real event service (stability audit 22 Oct,
// iphone-timer-sync-2, test gap 1): the requests are the ones the phone sends, in the order its
// recovery pass sends them, through the `/api/events` and `/api/bootstrap` route handlers.
const mocks = vi.hoisted(() => ({ session: null as null | {
  authMode: "provider";
  scopes: string[];
  userId: string;
  workspaceId: string;
} }));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: vi.fn(async () => {
    if (!mocks.session) throw new Error("No test session");
    return mocks.session;
  })
}));
vi.mock("@/lib/live-activity-post-response", () => ({
  scheduleLiveActivityNotification: vi.fn(),
  scheduleLiveActivityRetry: vi.fn()
}));

import { pool } from "@/lib/db";
import { GET as getBootstrap } from "../bootstrap/route";
import { POST as postEvent } from "./route";

const runDatabaseIntegration = process.env.DAYFRAME_RUN_DB_INTEGRATION === "1";

describe.runIf(runDatabaseIntegration)("an offline iPhone timer queue replayed through /api/events", () => {
  let userId: string;
  let workspaceId: string;
  const day = "2026-10-14";
  const base = Date.parse(`${day}T09:00:00.000Z`);
  const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString();

  beforeEach(async () => {
    userId = randomUUID();
    workspaceId = randomUUID();
    mocks.session = { authMode: "provider", scopes: ["app:read", "app:write", "events:write"], userId, workspaceId };
    await pool.query(`insert into users (id, email, name) values ($1, $2, 'Offline replay test')`,
      [userId, `dayframe-offline-replay-${userId}@example.invalid`]);
    await pool.query(`insert into workspaces (id, name) values ($1, 'Offline replay test')`, [workspaceId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id) values ($1, $2)`, [workspaceId, userId]);
  });

  afterEach(async () => {
    mocks.session = null;
    await pool.query("delete from workspaces where id = $1", [workspaceId]).catch(() => undefined);
    await pool.query("delete from users where id = $1", [userId]).catch(() => undefined);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function post(body: Record<string, unknown>) {
    const response = await postEvent(new Request("http://localhost/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test" },
      body: JSON.stringify(body)
    }));
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  /** The activity-queue request for a Start tapped on the Dashboard (queuedEventRequestBody). */
  function queuedStart(minute: number, description: string) {
    return post({
      source: "mobile_app",
      type: "timer_start",
      occurredAt: at(minute),
      clientEventId: `optimistic-${randomUUID()}`,
      description,
      rawPayload: { origin: "mobile_timer_start", startedAt: at(minute), tagNames: [] }
    });
  }

  /** The Stop outbox request, sent once the Start it stops has a server ID (deliverPendingTimerStop). */
  function outboxStop(minute: number, targetEntryId: string) {
    return post({
      source: "mobile_app",
      type: "timer_stop",
      occurredAt: at(minute),
      clientEventId: `mobile-timer-stop:${randomUUID()}`,
      rawPayload: { origin: "mobile_timer_stop", stopScope: "entry", targetEntryId }
    });
  }

  async function bootstrapTimeline() {
    const response = await getBootstrap(new Request(`http://localhost/api/bootstrap?date=${day}`, {
      headers: { Authorization: "Bearer test" }
    }));
    expect(response.status).toBe(200);
    const data = await response.json() as {
      activeEntry: { description: string | null; startedAt: string } | null;
      dayEntries: Array<{ description: string | null; startedAt: string; stoppedAt: string | null }>;
    };
    const minutes = (value: string | null) => value === null ? null : (Date.parse(value) - base) / 60_000;
    return {
      active: data.activeEntry ? [data.activeEntry.description, minutes(data.activeEntry.startedAt)] : null,
      day: data.dayEntries
        .map((entry) => [entry.description, minutes(entry.startedAt), minutes(entry.stoppedAt)] as const)
        .sort((left, right) => (left[1] ?? 0) - (right[1] ?? 0))
    };
  }

  it("keeps a block's own Stop when the next Start reaches the server first (Start A 09:00, Stop A 10:00, Start B 11:00)", async () => {
    // Recovery pass: Stop A waits for A's server ID, the queue sends Start A then Start B, then the
    // correlated Stop A goes.
    const startA = await queuedStart(0, "A");
    expect(startA.status).toBe(201);
    const entryA = startA.body.timeEntryId as string;
    expect(typeof entryA).toBe("string");
    expect((await queuedStart(120, "B")).status).toBe(201);

    const stopA = await outboxStop(60, entryA);
    expect(stopA.status).toBe(201);
    expect(stopA.body).toMatchObject({ stopOutcome: "stopped", timeEntryId: entryA });

    // The phone drops a delivered Stop and shows the next bootstrap as it is.
    expect(await bootstrapTimeline()).toEqual({
      active: ["B", 120],
      day: [["A", 0, 60], ["B", 120, null]]
    });
  });

  it("keeps every block's own Stop across several offline blocks", async () => {
    const startA = await queuedStart(0, "A");
    const startB = await queuedStart(120, "B");
    expect((await queuedStart(240, "C")).status).toBe(201);

    expect((await outboxStop(60, startA.body.timeEntryId as string)).body).toMatchObject({ stopOutcome: "stopped" });
    expect((await outboxStop(180, startB.body.timeEntryId as string)).body).toMatchObject({ stopOutcome: "stopped" });

    expect(await bootstrapTimeline()).toEqual({
      active: ["C", 240],
      day: [["A", 0, 60], ["B", 120, 180], ["C", 240, null]]
    });
  });

  it("delivering the same Stop again changes nothing", async () => {
    const startA = await queuedStart(0, "A");
    await queuedStart(120, "B");
    const stop = {
      source: "mobile_app",
      type: "timer_stop",
      occurredAt: at(60),
      clientEventId: `mobile-timer-stop:${randomUUID()}`,
      rawPayload: { origin: "mobile_timer_stop", stopScope: "entry", targetEntryId: startA.body.timeEntryId }
    };
    expect((await post(stop)).status).toBe(201);
    expect((await post(stop)).status).toBe(200);
    expect((await bootstrapTimeline()).day).toEqual([["A", 0, 60], ["B", 120, null]]);
  });
});
