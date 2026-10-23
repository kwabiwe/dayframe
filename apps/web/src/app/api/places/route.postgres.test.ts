import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The route's own pool (used by updatePlace) must point at the disposable database too.
const holder = vi.hoisted(() => {
  if (process.env.DAYFRAME_PLACE_PATCH_TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.DAYFRAME_PLACE_PATCH_TEST_DATABASE_URL;
  }
  return { session: null as unknown };
});

vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: vi.fn(async () => holder.session) }));

import { pool } from "@/lib/db";
import { PATCH } from "./route";

// Run with DAYFRAME_PLACE_PATCH_TEST_DATABASE_URL pointing at a disposable local *_test database.
// Drives the real PATCH route → updatePlace → SQL (route.test.ts mocks updatePlace), so it guards
// that a partial PATCH only changes the fields the request actually sent (stability audit server-3).
const databaseUrl = process.env.DAYFRAME_PLACE_PATCH_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("place PATCH on disposable PostgreSQL", () => {
  let userId: string;
  let workspaceId: string;
  let placeId: string;
  let categoryId: string;

  beforeAll(() => {
    const target = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("Place PATCH integration tests require a disposable local *_test database.");
    }
    if (pool.options.connectionString !== databaseUrl) {
      throw new Error("The app pool is not the disposable test database; run this file in its own worker.");
    }
  });

  beforeEach(async () => {
    userId = randomUUID();
    workspaceId = randomUUID();
    placeId = randomUUID();
    categoryId = randomUUID();
    holder.session = { authMode: "dev", scopes: ["app:read", "app:write"], userId, workspaceId };
    await pool.query("insert into users (id, email, name) values ($1, $2, 'Place PATCH test')", [userId, `place-patch-${userId}@example.test`]);
    await pool.query("insert into workspaces (id, name) values ($1, 'Place PATCH')", [workspaceId]);
    await pool.query("insert into workspace_members (workspace_id, user_id) values ($1, $2)", [workspaceId, userId]);
    await pool.query("insert into categories (id, workspace_id, name, color) values ($1, $2, 'Synthetic category', 'coral')", [categoryId, workspaceId]);
    await pool.query(
      `insert into places (id, workspace_id, name, radius_meters, priority, default_category_id, default_activity_description, logging_enabled, auto_log)
       values ($1, $2, 'Place A', 150, 7, $3, 'Synthetic activity', true, true)`,
      [placeId, workspaceId, categoryId]
    );
  });

  afterEach(async () => {
    await pool.query("delete from workspaces where id = $1", [workspaceId]);
    await pool.query("delete from users where id = $1", [userId]);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function patch(body: Record<string, unknown>) {
    const response = await PATCH(new Request("http://localhost/api/places", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: placeId, ...body })
    }));
    return response.status;
  }

  async function storedPlace() {
    const result = await pool.query(
      `select name,
              radius_meters as "radiusMeters",
              priority,
              default_category_id as "defaultCategoryId",
              default_activity_description as "defaultActivityDescription",
              logging_enabled as "loggingEnabled",
              auto_log as "autoLog"
         from places where id = $1`,
      [placeId]
    );
    return result.rows[0];
  }

  it("a name-only PATCH keeps the place's logging defaults and other fields", async () => {
    expect(await patch({ name: "Place B" })).toBe(200);
    expect(await storedPlace()).toEqual({
      name: "Place B",
      radiusMeters: 150,
      priority: 7,
      defaultCategoryId: categoryId,
      defaultActivityDescription: "Synthetic activity",
      loggingEnabled: true,
      autoLog: true
    });
  });

  it("turning Log automatically off alone keeps the default activity", async () => {
    expect(await patch({ autoLog: false })).toBe(200);
    expect(await storedPlace()).toMatchObject({
      name: "Place A",
      defaultCategoryId: categoryId,
      defaultActivityDescription: "Synthetic activity",
      loggingEnabled: true,
      autoLog: false
    });
  });

  it("an explicit null still clears a default", async () => {
    expect(await patch({ defaultActivityDescription: null })).toBe(200);
    expect(await storedPlace()).toMatchObject({ defaultCategoryId: categoryId, defaultActivityDescription: null, autoLog: true });
  });

  it("turning logging off still clears both defaults and Log automatically", async () => {
    expect(await patch({ loggingEnabled: false })).toBe(200);
    expect(await storedPlace()).toMatchObject({
      defaultCategoryId: null,
      defaultActivityDescription: null,
      loggingEnabled: false,
      autoLog: false
    });
  });

  it("a full save (what both clients send) keeps its values", async () => {
    expect(await patch({
      name: "Place A",
      loggingEnabled: true,
      autoLog: true,
      defaultCategoryId: categoryId,
      defaultActivityDescription: "Synthetic activity"
    })).toBe(200);
    expect(await storedPlace()).toMatchObject({ defaultCategoryId: categoryId, defaultActivityDescription: "Synthetic activity", autoLog: true });
  });
});
