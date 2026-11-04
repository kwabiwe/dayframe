import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: vi.fn(async () => holder.session) }));
vi.mock("@/lib/live-activity-post-response", () => ({ scheduleLiveActivityNotification: vi.fn() }));

import type pg from "pg";
import { pool } from "@/lib/db";
import { POST as postEvent } from "../../events/route";
import { POST as postEntry } from "../route";
import { DELETE, PATCH } from "./route";

const runDatabaseIntegration = process.env.DAYFRAME_RUN_DB_INTEGRATION === "1";
const T = (hhmm: string) => `2026-10-20T${hhmm}:00.000Z`;

/** Waits until a backend of this database is blocked behind another's lock (the resend on the row lock). */
async function waitUntilBlocked(blockingPid?: number) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const blocked = await pool.query<{ count: number }>(
      `select count(*)::int as count from pg_stat_activity
       where datname = current_database() and cardinality(pg_blocking_pids(pid)) > 0
         and ($1::int is null or $1 = any(pg_blocking_pids(pid)))`,
      [blockingPid ?? null]
    );
    if ((blocked.rows[0]?.count ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The resend never waited on the row lock.");
}

// Stability audit 22 Oct 2026, item 17: an iPhone Edit whose response was lost is resent unchanged.
// With its outbox command id the resend is answered as delivered and never reverts a newer edit.
describe.runIf(runDatabaseIntegration)("Block catalogue ownership and Edit receipts (Postgres)", () => {
  let userId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let catX: string;
  let catY: string;
  let entryId: string;

  beforeEach(async () => {
    userId = randomUUID();
    workspaceId = randomUUID();
    otherWorkspaceId = randomUUID();
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
    vi.restoreAllMocks();
    await pool.query("delete from workspaces where id = any($1::uuid[])", [[workspaceId, otherWorkspaceId]]).catch(() => undefined);
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

  async function catalogue(owner: string) {
    const ids = { projectId: randomUUID(), categoryId: randomUUID(), placeId: randomUUID() };
    await pool.query("insert into projects (id, workspace_id, name) values ($1, $2, 'Project')", [ids.projectId, owner]);
    await pool.query("insert into categories (id, workspace_id, name) values ($1, $2, 'Activity')", [ids.categoryId, owner]);
    await pool.query("insert into places (id, workspace_id, name) values ($1, $2, 'Place')", [ids.placeId, owner]);
    return ids;
  }

  async function foreignCatalogue() {
    await pool.query("insert into workspaces (id, name) values ($1, 'Other workspace')", [otherWorkspaceId]);
    return catalogue(otherWorkspaceId);
  }

  function post(handler: (request: Request) => Promise<Response>, path: string, body: object) {
    return handler(new Request(`http://localhost/api/${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    }));
  }

  async function entryCatalogue() {
    return (await pool.query(
      `select project_id as "projectId", category_id as "categoryId", place_id as "placeId",
              description, stopped_at as "stoppedAt"
       from time_entries where workspace_id = $1 and user_id = $2 order by started_at, id`,
      [workspaceId, userId]
    )).rows;
  }

  async function eventCount() {
    return (await pool.query<{ count: number }>(
      "select count(*)::int as count from activity_events where workspace_id = $1 and user_id = $2",
      [workspaceId, userId]
    )).rows[0].count;
  }

  it.each(["manual", "start", "event", "edit"] as const)(
    "rejects foreign and unknown catalogue IDs in %s without changing blocks or events", async (action) => {
      const foreign = await foreignCatalogue();
      if (action === "start" || action === "event") {
        await pool.query("update time_entries set stopped_at = null where id = $1", [entryId]);
      }
      const before = await entryCatalogue();
      const mutate = async (details: object) => {
        const body = { ...details, description: "Catalogue test" };
        if (action === "edit") return patch(body);
        const response = action === "event"
          ? await post(postEvent, "events", {
            ...body, source: "mobile_app", type: "timer_start", clientEventId: "catalogue-check", occurredAt: T("11:00")
          })
          : await post(postEntry, "time-entries", {
            ...body, mode: action, startedAt: T("11:00"), stoppedAt: T("12:00")
          });
        return { status: response.status, json: await response.json() as Record<string, unknown> };
      };

      for (const [field, id] of Object.entries(foreign)) {
        const foreignResult = await mutate({ [field]: id });
        const unknownResult = await mutate({ [field]: randomUUID() });
        expect(foreignResult.status).toBe(action === "edit" ? 400 : 422);
        expect(unknownResult).toEqual(foreignResult);
        expect(JSON.stringify(foreignResult.json)).not.toContain(id);
      }
      expect(await entryCatalogue()).toEqual(before);
      expect(await eventCount()).toBe(0);
      expect(await audit()).toEqual([]);

      const own = await catalogue(workspaceId);
      expect((await mutate(own)).status).toBe(action === "edit" ? 200 : 201);
      expect(await entryCatalogue()).toContainEqual(expect.objectContaining({ ...own, description: "Catalogue test" }));
    }
  );

  it("allows an unrelated edit or a clear on a block with historical foreign references", async () => {
    const foreign = await foreignCatalogue();
    await pool.query("update time_entries set project_id = $2, category_id = $3, place_id = $4 where id = $1",
      [entryId, foreign.projectId, foreign.categoryId, foreign.placeId]);
    expect((await patch({ description: "New description" })).status).toBe(200);
    expect(await entryCatalogue()).toEqual([expect.objectContaining({ ...foreign, description: "New description" })]);
    expect((await patch({ projectId: null, categoryId: null, placeId: null })).status).toBe(200);
    expect(await entryCatalogue()).toEqual([expect.objectContaining({
      projectId: null, categoryId: null, placeId: null, description: "New description"
    })]);
  });

  it("returns accepted Start and Edit receipts after the referenced activity is deleted", async () => {
    const event = { source: "mobile_app", type: "timer_start", occurredAt: T("11:00"),
      clientEventId: "catalogue-replay", categoryId: catX };
    const edit = { categoryId: catX, description: "Accepted edit" };
    const commandId = "mobile-time-entry:catalogue-replay";
    expect((await post(postEvent, "events", event)).status).toBe(201);
    expect((await patch(edit, commandId)).status).toBe(200);
    await pool.query("delete from categories where id = $1 and workspace_id = $2", [catX, workspaceId]);

    const startRetry = await post(postEvent, "events", event);
    expect(startRetry.status).toBe(200);
    expect(await startRetry.json()).toMatchObject({ duplicate: true });
    const editRetry = await patch(edit, commandId);
    expect(editRetry.status).toBe(200);
    expect(editRetry.json).toMatchObject({ replayed: true });
    expect(await eventCount()).toBe(1);
    expect(await audit()).toHaveLength(1);
    expect((await entryCatalogue()).map(({ categoryId }) => categoryId)).toEqual([null, null]);
  });

  it("finds a Start receipt committed while the retry waits on the timer lock", async () => {
    const request = { source: "mobile_app", type: "timer_start", occurredAt: T("11:00"),
      clientEventId: "concurrent-catalogue-replay", categoryId: catX };
    const firstDelivery = await pool.connect();
    let retry: Promise<Response> | undefined;
    try {
      await firstDelivery.query("begin");
      const { rows: [backend] } = await firstDelivery.query<{ pid: number }>("select pg_backend_pid() as pid");
      await firstDelivery.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))", [workspaceId, userId]);
      const { rows: [event] } = await firstDelivery.query<{ id: string }>(
        `insert into activity_events (workspace_id, user_id, client_event_id, source, event_type,
             occurred_at, confidence, suggested_category_id)
         values ($1, $2, $3, 'mobile_app', 'timer_start', $4, 'high', $5) returning id`,
        [workspaceId, userId, request.clientEventId, request.occurredAt, catX]
      );
      const { rows: [entry] } = await firstDelivery.query<{ id: string }>(
        `insert into time_entries (workspace_id, user_id, category_id, started_at, created_from_event_id)
         values ($1, $2, $3, $4, $5) returning id`,
        [workspaceId, userId, catX, request.occurredAt, event.id]
      );
      retry = post(postEvent, "events", request);
      await waitUntilBlocked(backend.pid);
      await firstDelivery.query("delete from categories where id = $1 and workspace_id = $2", [catX, workspaceId]);
      await firstDelivery.query("commit");

      const response = await retry;
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ duplicate: true, eventId: event.id, timeEntryId: entry.id });
      expect(await eventCount()).toBe(1);
    } finally {
      await firstDelivery.query("rollback");
      firstDelivery.release();
      await retry?.catch(() => undefined);
    }
  });

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

  it("a resend that waits on the first delivery's row lock is answered as delivered once it commits", async () => {
    // Hold the first delivery's transaction open at its commit: row locked, edit and receipt written.
    let releaseCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
    let reachedCommit!: () => void;
    const atCommit = new Promise<void>((resolve) => { reachedCommit = resolve; });
    const connect = pool.connect.bind(pool) as () => Promise<pg.PoolClient>;
    vi.spyOn(pool, "connect").mockImplementationOnce((async () => {
      const client = await connect();
      const query = client.query;
      client.query = (async (...args: Parameters<typeof query>) => {
        if (args[0] === "commit") {
          reachedCommit();
          await commitGate;
          client.query = query;
        }
        return (query as (...input: unknown[]) => unknown).apply(client, args);
      }) as typeof query;
      return client;
    }) as never);

    const first = patch(phoneA(), COMMAND);
    await atCommit;
    const resend = patch(phoneA(), COMMAND);
    await waitUntilBlocked();
    releaseCommit();
    const [a, b] = await Promise.all([first, resend]);

    expect(a.status).toBe(200);
    expect(a.json).not.toHaveProperty("replayed");
    expect(b.status).toBe(200);
    expect(b.json).toMatchObject({ replayed: true, entry: { id: entryId, description: "phone A" } });
    expect((await audit()).filter((entry) => entry.metadata.clientCommandId === COMMAND)).toHaveLength(1);
  });

  it("a resend that waits while the block is being deleted is answered as delivered once the delete commits", async () => {
    expect((await patch(phoneA(), COMMAND)).status).toBe(200); // applied; the response is lost
    const deleting = await pool.connect();
    try {
      await deleting.query("begin");
      await deleting.query("delete from time_entries where id = $1", [entryId]);
      const resend = patch(phoneA(), COMMAND);
      await waitUntilBlocked();
      await deleting.query("commit");

      const result = await resend;
      expect(result.status).toBe(200);
      expect(result.json).toMatchObject({ ok: true, replayed: true, entry: null });
      expect(await row()).toBeNull();
    } finally {
      await deleting.query("rollback").catch(() => undefined);
      deleting.release();
    }
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
