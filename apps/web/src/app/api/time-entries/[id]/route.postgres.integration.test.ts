import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: vi.fn(async () => holder.session) }));
vi.mock("@/lib/live-activity-post-response", () => ({ scheduleLiveActivityNotification: vi.fn() }));

import { pool } from "@/lib/db";
import { DELETE, PATCH } from "./route";

const runDatabaseIntegration = process.env.DAYFRAME_RUN_DB_INTEGRATION === "1";
const T = (hhmm: string) => `2026-10-20T${hhmm}:00.000Z`;

// Stability audit 22 Oct 2026, item 17: an iPhone Edit whose response was lost is resent unchanged.
// With its outbox command id the resend is answered as delivered and never reverts a newer edit.
describe.runIf(runDatabaseIntegration)("PATCH /api/time-entries/[id] resend of an applied iPhone Edit (Postgres)", () => {
  let userId: string;
  let workspaceId: string;
  let catX: string;
  let catY: string;
  let entryId: string;

  beforeEach(async () => {
    userId = randomUUID();
    workspaceId = randomUUID();
    catX = randomUUID();
    catY = randomUUID();
    holder.session = { authMode: "provider", scopes: ["app:read", "app:write"], userId, workspaceId };
    await pool.query(`insert into users (id, email, name) values ($1, $2, 'Resend test')`, [userId, `dayframe-resend-${userId}@example.invalid`]);
    await pool.query(`insert into workspaces (id, name) values ($1, 'Resend test')`, [workspaceId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id) values ($1, $2)`, [workspaceId, userId]);
    await pool.query(
      `insert into categories (id, workspace_id, name, color) values ($1, $2, 'X', 'coral'), ($3, $2, 'Y', 'sky')`,
      [catX, workspaceId, catY]
    );
    entryId = (await pool.query<{ id: string }>(
      `insert into time_entries (workspace_id, user_id, category_id, description, started_at, stopped_at)
       values ($1, $2, $3, 'orig', $4, $5) returning id`,
      [workspaceId, userId, catX, T("09:00"), T("10:00")]
    )).rows[0]!.id;
  });

  afterEach(async () => {
    await pool.query("delete from workspaces where id = $1", [workspaceId]).catch(() => undefined);
    await pool.query("delete from users where id = $1", [userId]).catch(() => undefined);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function patch(body: Record<string, unknown>, commandId?: string) {
    const response = await PATCH(new Request(`http://localhost/api/time-entries/${entryId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(commandId ? { "X-Dayframe-Client-Command-Id": commandId } : {})
      },
      body: JSON.stringify(body)
    }), { params: Promise.resolve({ id: entryId }) });
    return { status: response.status, json: await response.json() as Record<string, unknown> };
  }

  async function del() {
    const response = await DELETE(new Request(`http://localhost/api/time-entries/${entryId}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: entryId }) });
    return response.status;
  }

  async function row() {
    const result = await pool.query(
      `select te.description, case te.category_id when $2 then 'X' when $3 then 'Y' else null end as cat,
              to_char(te.started_at at time zone 'UTC', 'HH24:MI') as start,
              to_char(te.stopped_at at time zone 'UTC', 'HH24:MI') as stop,
              coalesce((select array_agg(t.name order by t.name) from time_entry_tags tt join tags t on t.id = tt.tag_id
                        where tt.time_entry_id = te.id), '{}') as tags
       from time_entries te where te.id = $1`,
      [entryId, catX, catY]
    );
    return result.rows[0] ?? null;
  }

  async function audit() {
    return (await pool.query<{ action: string; metadata: Record<string, unknown> }>(
      `select action, metadata from audit_log where entity_id = $1 order by created_at, id`,
      [entryId]
    )).rows;
  }

  // ActiveTimerEditSheet's whole-form save of a completed block (no expectedDetails).
  const phoneA = () => ({ categoryId: catX, description: "phone A", tagNames: ["alpha"], startedAt: T("09:00"), stoppedAt: T("10:00") });
  const COMMAND = "mobile-time-entry:mh2abc:resendtest01";

  it("a resend after newer web edits is answered as delivered and leaves every web edit in place", async () => {
    expect((await patch(phoneA(), COMMAND)).status).toBe(200); // applied; the response is lost
    expect((await patch({
      description: "web B",
      categoryId: catY,
      tagNames: ["beta"],
      expectedDetails: { description: "phone A", categoryId: catX, tagNames: ["alpha"] }
    })).status).toBe(200);
    expect((await patch({ startedAt: T("09:00"), stoppedAt: T("10:30") })).status).toBe(200);
    const afterWeb = await row();
    const auditBefore = await audit();

    const resend = await patch(phoneA(), COMMAND);

    expect(resend.status).toBe(200);
    expect(resend.json).toMatchObject({ ok: true, replayed: true, entry: { id: entryId, description: "web B" } });
    expect(await row()).toEqual(afterWeb);
    expect(afterWeb).toMatchObject({ description: "web B", cat: "Y", stop: "10:30", tags: ["beta"] });
    // No new audit row: the reverted 10:00 end is never recorded as one a person set.
    expect(await audit()).toEqual(auditBefore);
    // A's end was the stored one, so its receipt is a plain edit; the web's 10:30 end stays the one set.
    expect(auditBefore[0]).toMatchObject({ action: "time_entry.edited", metadata: { clientCommandId: COMMAND } });
    expect(auditBefore.at(-1)).toMatchObject({ action: "time_entry.end_set", metadata: { stoppedAt: expect.any(String) } });
  });

  it("a resend of a details-only Edit of a running block leaves the newer web description", async () => {
    await pool.query("update time_entries set stopped_at = null where id = $1", [entryId]);
    const edit = { categoryId: catX, description: "phone A", tagNames: ["alpha"] };
    expect((await patch(edit, COMMAND)).status).toBe(200);
    expect((await patch({ description: "web B", expectedDetails: { description: "phone A" } })).status).toBe(200);

    expect((await patch(edit, COMMAND)).status).toBe(200);
    expect(await row()).toMatchObject({ description: "web B", stop: null });
    expect((await audit()).find((entry) => entry.metadata.clientCommandId === COMMAND))
      .toMatchObject({ action: "time_entry.edited" });
  });

  it("a resend after the block was deleted is answered as delivered, not a false rejection", async () => {
    expect((await patch(phoneA(), COMMAND)).status).toBe(200);
    expect(await del()).toBe(200);

    const resend = await patch(phoneA(), COMMAND);
    expect(resend.status).toBe(200);
    expect(resend.json).toMatchObject({ ok: true, replayed: true, entry: null });
    expect(await row()).toBeNull();
  });

  it("an Edit for a deleted block that never landed is still 404", async () => {
    expect(await del()).toBe(200);
    expect((await patch(phoneA(), COMMAND)).status).toBe(404);
  });

  it("the first delivery with a command id applies, and a different command id applies again", async () => {
    const first = await patch(phoneA(), COMMAND);
    expect(first.status).toBe(200);
    expect(first.json).not.toHaveProperty("replayed");
    expect(await row()).toMatchObject({ description: "phone A", cat: "X", tags: ["alpha"] });

    expect((await patch({ description: "web B" })).status).toBe(200);
    const later = await patch({ description: "phone C" }, "mobile-time-entry:mh2abc:resendtest02");
    expect(later.json).not.toHaveProperty("replayed");
    expect(await row()).toMatchObject({ description: "phone C" });
  });

  it("two concurrent deliveries of the same command apply it once", async () => {
    const [a, b] = await Promise.all([patch(phoneA(), COMMAND), patch(phoneA(), COMMAND)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.json.replayed, b.json.replayed].filter(Boolean)).toHaveLength(1);
    expect((await audit()).filter((entry) => entry.metadata.clientCommandId === COMMAND)).toHaveLength(1);
  });

  it("an older iPhone's resend (no command id) still applies as before", async () => {
    expect((await patch(phoneA())).status).toBe(200);
    expect((await patch({ description: "web B" })).status).toBe(200);
    const resend = await patch(phoneA());
    expect(resend.status).toBe(200);
    expect(resend.json).not.toHaveProperty("replayed");
    expect(await row()).toMatchObject({ description: "phone A" });
    expect((await audit()).every((entry) => !("clientCommandId" in entry.metadata))).toBe(true);
  });

  it("a command id recorded for another block does not suppress this block's edit", async () => {
    const otherId = (await pool.query<{ id: string }>(
      `insert into time_entries (workspace_id, user_id, description, started_at, stopped_at)
       values ($1, $2, 'other', $3, $4) returning id`,
      [workspaceId, userId, T("11:00"), T("12:00")]
    )).rows[0]!.id;
    await PATCH(new Request(`http://localhost/api/time-entries/${otherId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "X-Dayframe-Client-Command-Id": COMMAND },
      body: JSON.stringify({ description: "other edited" })
    }), { params: Promise.resolve({ id: otherId }) });

    const edit = await patch({ description: "phone A" }, COMMAND);
    expect(edit.json).not.toHaveProperty("replayed");
    expect(await row()).toMatchObject({ description: "phone A" });
  });
});
