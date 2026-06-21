import pg from "pg";
import {
  mapTogglTimeEntry,
  TogglClientSchema,
  TogglProjectSchema,
  TogglTagSchema,
  TogglTimeEntrySchema,
  togglExternalId
} from "@dayframe/shared";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://dayframe:dayframe@localhost:54322/dayframe";
const workspaceId = process.env.DAYFRAME_DEV_WORKSPACE_ID ?? "00000000-0000-4000-8000-000000000010";
const userId = process.env.DAYFRAME_DEV_USER_ID ?? "00000000-0000-4000-8000-000000000001";
const togglToken = process.env.TOGGL_API_TOKEN;
const togglWorkspaceId = process.env.TOGGL_WORKSPACE_ID;
const dryRun = process.argv.includes("--dry-run");
const since = argValue("--since") ?? new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();
const until = argValue("--until") ?? new Date().toISOString();

const pool = new pg.Pool({ connectionString: databaseUrl });

type ImportSummary = {
  clients: number;
  projects: number;
  tags: number;
  timeEntries: number;
  skippedTimeEntries: number;
};

async function main() {
  if (!togglToken) throw new Error("Set TOGGL_API_TOKEN before running the Toggl importer.");
  if (!togglWorkspaceId) throw new Error("Set TOGGL_WORKSPACE_ID before running the Toggl importer.");

  const auth = `Basic ${Buffer.from(`${togglToken}:api_token`).toString("base64")}`;
  const summary: ImportSummary = {
    clients: 0,
    projects: 0,
    tags: 0,
    timeEntries: 0,
    skippedTimeEntries: 0
  };

  const [clients, projects, tags, timeEntries] = await Promise.all([
    togglFetch(`/workspaces/${togglWorkspaceId}/clients`, auth, TogglClientSchema.array()),
    togglFetch(`/workspaces/${togglWorkspaceId}/projects`, auth, TogglProjectSchema.array()),
    togglFetch(`/workspaces/${togglWorkspaceId}/tags`, auth, TogglTagSchema.array()),
    togglFetch(
      `/me/time_entries?start_date=${encodeURIComponent(since)}&end_date=${encodeURIComponent(until)}`,
      auth,
      TogglTimeEntrySchema.array()
    )
  ]);

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          workspaceId,
          togglWorkspaceId,
          since,
          until,
          planned: {
            clients: clients.length,
            projects: projects.length,
            tags: tags.length,
            timeEntries: timeEntries.length
          }
        },
        null,
        2
      )
    );
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const run = await client.query<{ id: string }>(
      `insert into import_runs (workspace_id, provider, mode, status, summary)
       values ($1, 'toggl', 'import', 'running', '{}'::jsonb)
       returning id`,
      [workspaceId]
    );
    const runId = run.rows[0].id;

    for (const item of clients) {
      const exists = await upsertExternalRef(client, "client", togglExternalId(item.id), async () => {
        const inserted = await client.query<{ id: string }>(
          `insert into clients (workspace_id, name, color)
           values ($1, $2, 'steel')
           on conflict do nothing
           returning id`,
          [workspaceId, item.name]
        );
        return inserted.rows[0]?.id ?? null;
      });
      if (exists.created) summary.clients += 1;
    }

    for (const item of tags) {
      const exists = await upsertExternalRef(client, "tag", togglExternalId(item.id), async () => {
        const inserted = await client.query<{ id: string }>(
          `insert into tags (workspace_id, name, color)
           values ($1, $2, 'steel')
           on conflict (workspace_id, name) do update set name = excluded.name
           returning id`,
          [workspaceId, item.name]
        );
        return inserted.rows[0]?.id ?? null;
      });
      if (exists.created) summary.tags += 1;
    }

    for (const item of projects) {
      const clientRef = item.cid ? await findExternalRef(client, "client", togglExternalId(item.cid)) : null;
      const exists = await upsertExternalRef(client, "project", togglExternalId(item.id), async () => {
        const inserted = await client.query<{ id: string }>(
          `insert into projects (workspace_id, name, client_id, color, billable)
           values ($1, $2, $3, 'blue', $4)
           returning id`,
          [workspaceId, item.name, clientRef, Boolean(item.billable)]
        );
        return inserted.rows[0]?.id ?? null;
      });
      if (exists.created) summary.projects += 1;
    }

    for (const entry of timeEntries) {
      const mapped = mapTogglTimeEntry(entry);
      const existing = await findExternalRef(client, "time_entry", mapped.externalId);
      if (existing) {
        summary.skippedTimeEntries += 1;
        continue;
      }
      const projectId = mapped.projectExternalId
        ? await findExternalRef(client, "project", mapped.projectExternalId)
        : null;
      const inserted = await client.query<{ id: string }>(
        `insert into time_entries (
            workspace_id, user_id, project_id, source, confidence, review_status,
            description, started_at, stopped_at
         )
         values ($1, $2, $3, 'toggl_import', 'high', 'confirmed', $4, $5, $6)
         returning id`,
        [workspaceId, userId, projectId, mapped.description, mapped.startedAt, mapped.stoppedAt]
      );
      await insertExternalRef(client, "time_entry", mapped.externalId, inserted.rows[0].id, mapped.rawPayload);
      summary.timeEntries += 1;
    }

    await client.query(
      `update import_runs
       set completed_at = now(), status = 'completed', summary = $2::jsonb
       where id = $1`,
      [runId, JSON.stringify(summary)]
    );
    await client.query("commit");
    console.log(JSON.stringify({ dryRun: false, summary }, null, 2));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function togglFetch<T>(path: string, auth: string, schema: { parse(value: unknown): T }) {
  const response = await fetch(`https://api.track.toggl.com/api/v9${path}`, {
    headers: {
      Authorization: auth,
      "Content-Type": "application/json"
    }
  });
  if (!response.ok) throw new Error(`Toggl request failed: ${response.status}`);
  return schema.parse(await response.json());
}

async function findExternalRef(client: pg.PoolClient, entityType: string, externalId: string) {
  const result = await client.query<{ entityId: string }>(
    `select entity_id as "entityId"
     from external_entity_refs
     where workspace_id = $1 and provider = 'toggl' and entity_type = $2 and external_id = $3`,
    [workspaceId, entityType, externalId]
  );
  return result.rows[0]?.entityId ?? null;
}

async function upsertExternalRef(
  client: pg.PoolClient,
  entityType: string,
  externalId: string,
  createEntity: () => Promise<string | null>
) {
  const existing = await findExternalRef(client, entityType, externalId);
  if (existing) return { created: false, entityId: existing };
  const entityId = await createEntity();
  if (!entityId) return { created: false, entityId: null };
  await insertExternalRef(client, entityType, externalId, entityId, {});
  return { created: true, entityId };
}

async function insertExternalRef(
  client: pg.PoolClient,
  entityType: string,
  externalId: string,
  entityId: string,
  metadata: unknown
) {
  await client.query(
    `insert into external_entity_refs (workspace_id, provider, external_id, entity_type, entity_id, metadata)
     values ($1, 'toggl', $2, $3, $4, $5::jsonb)
     on conflict (workspace_id, provider, entity_type, external_id)
     do update set entity_id = excluded.entity_id, metadata = excluded.metadata, updated_at = now()`,
    [workspaceId, externalId, entityType, entityId, JSON.stringify(metadata)]
  );
}

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
