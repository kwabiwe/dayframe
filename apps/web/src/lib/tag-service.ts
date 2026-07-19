import { normalizeTagName } from "@dayframe/shared";
import type pg from "pg";
import { isUniqueViolationError, pool, query } from "./db";
import { getDevSession, type RequestSession } from "./session";

export type PersistedTag = {
  id: string;
  name: string;
  normalizedName: string;
};

export class TagNotFoundError extends Error {
  status = 404;

  constructor(message = "Tag not found.") {
    super(message);
    this.name = "TagNotFoundError";
  }
}

export class TagConflictError extends Error {
  status = 409;

  constructor(message = "A tag with that name already exists.") {
    super(message);
    this.name = "TagConflictError";
  }
}

export async function listTags(
  session: RequestSession = getDevSession(),
  queryText?: string | null
) {
  const normalizedQuery = queryText?.trim().replace(/^#/, "").toLowerCase() ?? "";
  const result = await query<PersistedTag & { usageCount: number }>(
    `select tag.id,
            tag.name,
            tag.normalized_name as "normalizedName",
            count(tet.time_entry_id)::int as "usageCount"
     from tags tag
     left join time_entry_tags tet
       on tet.tag_id = tag.id and tet.workspace_id = tag.workspace_id
     where tag.workspace_id = $1
       and ($2 = '' or tag.normalized_name like $2 || '%')
     group by tag.id
     order by
       case when tag.normalized_name = $2 then 0 else 1 end,
       count(tet.time_entry_id) desc,
       tag.name
     limit 50`,
    [session.workspaceId, normalizedQuery]
  );
  return result.rows;
}

/** Concurrent creates converge on the existing workspace-scoped normalized row. */
export async function createTag(
  input: { name: string },
  session: RequestSession = getDevSession()
) {
  const tag = normalizeTagName(input.name);
  const result = await query<PersistedTag>(
    `insert into tags as existing (
        workspace_id, name, normalized_name, created_by_user_id
     )
     values ($1, $2, $3, $4)
     on conflict (workspace_id, normalized_name)
     do update set normalized_name = excluded.normalized_name
     returning existing.id,
               existing.name,
               existing.normalized_name as "normalizedName"`,
    [session.workspaceId, tag.name, tag.normalizedName, session.userId]
  );
  return result.rows[0];
}

export async function renameTag(
  id: string,
  input: { name: string },
  session: RequestSession = getDevSession()
) {
  const tag = normalizeTagName(input.name);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await client.query<{ normalizedName: string }>(
      `select normalized_name as "normalizedName"
       from tags
       where id = $1 and workspace_id = $2
       for update`,
      [id, session.workspaceId]
    );
    if (!current.rows[0]) throw new TagNotFoundError();

    const result = await client.query<PersistedTag>(
      `update tags
       set name = $3, normalized_name = $4
       where id = $1 and workspace_id = $2
       returning id, name, normalized_name as "normalizedName"`,
      [id, session.workspaceId, tag.name, tag.normalizedName]
    );
    await client.query(
      `update time_entries entry
       set description = regexp_replace(
             entry.description,
             $3,
             $4,
             'gi'
           ),
           updated_at = now()
       from time_entry_tags tet
       where tet.time_entry_id = entry.id
         and tet.workspace_id = entry.workspace_id
         and tet.workspace_id = $1
         and tet.tag_id = $2
         and entry.description is not null`,
      [
        session.workspaceId,
        id,
        `(^|[^A-Za-z0-9_@/.:?=&%#+-])#${current.rows[0].normalizedName}([^A-Za-z0-9_-]|$)`,
        `\\1#${tag.normalizedName}\\2`
      ]
    );
    await client.query("commit");
    return result.rows[0];
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolationError(error)) throw new TagConflictError();
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteTag(id: string, session: RequestSession = getDevSession()) {
  const result = await query<{ id: string }>(
    "delete from tags where id = $1 and workspace_id = $2 returning id",
    [id, session.workspaceId]
  );
  if (!result.rows[0]) throw new TagNotFoundError();
  return { id, deleted: true };
}

export async function attachTagToTimeEntry(
  timeEntryId: string,
  tagId: string,
  session: RequestSession = getDevSession()
) {
  const result = await query<{ tagId: string }>(
    `insert into time_entry_tags (
        workspace_id, time_entry_id, tag_id, created_by_user_id
     )
     select $1, entry.id, tag.id, $2
     from time_entries entry
     join tags tag on tag.id = $4 and tag.workspace_id = entry.workspace_id
     where entry.id = $3
       and entry.workspace_id = $1
       and entry.user_id = $2
     on conflict (time_entry_id, tag_id) do nothing
     returning tag_id as "tagId"`,
    [session.workspaceId, session.userId, timeEntryId, tagId]
  );
  if (!result.rows[0]) {
    const existing = await query<{ exists: boolean }>(
      `select exists (
         select 1
         from time_entry_tags tet
         join time_entries entry
           on entry.id = tet.time_entry_id and entry.workspace_id = tet.workspace_id
         where tet.workspace_id = $1
           and tet.time_entry_id = $2
           and tet.tag_id = $3
           and entry.user_id = $4
       ) as exists`,
      [session.workspaceId, timeEntryId, tagId, session.userId]
    );
    if (!existing.rows[0]?.exists) throw new TagNotFoundError("Tag or time entry not found.");
  }
  return { timeEntryId, tagId, attached: true };
}

export async function detachTagFromTimeEntry(
  timeEntryId: string,
  tagId: string,
  session: RequestSession = getDevSession()
) {
  await query(
    `delete from time_entry_tags tet
     using time_entries entry
     where tet.time_entry_id = entry.id
       and tet.workspace_id = entry.workspace_id
       and tet.workspace_id = $1
       and tet.time_entry_id = $2
       and tet.tag_id = $3
       and entry.user_id = $4`,
    [session.workspaceId, timeEntryId, tagId, session.userId]
  );
  return { timeEntryId, tagId, detached: true };
}

export async function syncTimeEntryTags(
  client: pg.PoolClient,
  timeEntryId: string,
  tagNames: string[],
  session: RequestSession
) {
  const desired = Array.from(
    new Map(tagNames.map((name) => {
      const tag = normalizeTagName(name);
      return [tag.normalizedName, tag] as const;
    })).values()
  );
  const tags: PersistedTag[] = [];

  for (const tag of desired) {
    const result = await client.query<PersistedTag>(
      `insert into tags as existing (
          workspace_id, name, normalized_name, created_by_user_id
       )
       values ($1, $2, $3, $4)
       on conflict (workspace_id, normalized_name)
       do update set normalized_name = excluded.normalized_name
       returning existing.id,
                 existing.name,
                 existing.normalized_name as "normalizedName"`,
      [session.workspaceId, tag.name, tag.normalizedName, session.userId]
    );
    if (result.rows[0]) tags.push(result.rows[0]);
  }

  const tagIds = tags.map((tag) => tag.id);
  await client.query(
    `delete from time_entry_tags tet
     using time_entries entry
     where tet.time_entry_id = entry.id
       and tet.workspace_id = entry.workspace_id
       and tet.workspace_id = $1
       and tet.time_entry_id = $2
       and entry.user_id = $3
       and not (tet.tag_id = any($4::uuid[]))`,
    [session.workspaceId, timeEntryId, session.userId, tagIds]
  );

  for (const tag of tags) {
    await client.query(
      `insert into time_entry_tags (
          workspace_id, time_entry_id, tag_id, created_by_user_id
       )
       select $1, entry.id, $4, $2
       from time_entries entry
       where entry.id = $3
         and entry.workspace_id = $1
         and entry.user_id = $2
       on conflict (time_entry_id, tag_id) do nothing`,
      [session.workspaceId, session.userId, timeEntryId, tag.id]
    );
  }

  return tags;
}
