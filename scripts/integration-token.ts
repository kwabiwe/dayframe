import crypto from "node:crypto";
import pg from "pg";

/**
 * Manage integration tokens (docs/integration-api.md › Tokens). Only the SHA-256 hash is stored; `create`
 * prints the token once. Run against the database in DATABASE_URL:
 *
 *   npm run integration-token -- list <workspace-id>
 *   npm run integration-token -- create <workspace-id> "<name>" time:read,location:read
 *   npm run integration-token -- scopes <token-id> time:read,review:read
 *   npm run integration-token -- revoke <token-id>
 */
const KNOWN_SCOPES = ["time:read", "location:read", "review:read", "events:read", "events:write", "exports:read"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function scopes(value: string | undefined) {
  const list = [...new Set((value ?? "").split(",").map((scope) => scope.trim()).filter(Boolean))].sort();
  const unknown = list.filter((scope) => !KNOWN_SCOPES.includes(scope));
  if (!list.length || unknown.length) throw new Error(`Scopes must be a comma-separated subset of ${KNOWN_SCOPES.join(", ")}.`);
  return list;
}

function uuid(value: string | undefined, label: string) {
  if (!value || !UUID.test(value)) throw new Error(`Provide the ${label} as a UUID.`);
  return value;
}

async function main() {
  const [command, first, second, third] = process.argv.slice(2);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (command === "list") {
      const result = await client.query(
        `select id, name, scopes, created_at, last_used_at, revoked_at from integration_tokens
          where workspace_id = $1 order by created_at`, [uuid(first, "workspace id")]);
      console.table(result.rows);
    } else if (command === "create") {
      const name = second?.trim();
      if (!name) throw new Error("Provide a token name.");
      const token = `dfi_${crypto.randomBytes(32).toString("base64url")}`;
      const hash = crypto.createHash("sha256").update(token, "utf8").digest("hex");
      const result = await client.query<{ id: string }>(
        `insert into integration_tokens (workspace_id, name, token_hash, scopes) values ($1, $2, $3, $4) returning id`,
        [uuid(first, "workspace id"), name, hash, scopes(third)]);
      console.log(`Created token ${result.rows[0].id}. Store it now; it is not shown again:\n${token}`);
    } else if (command === "scopes") {
      const result = await client.query(
        `update integration_tokens set scopes = $2 where id = $1 and revoked_at is null returning id, name, scopes`,
        [uuid(first, "token id"), scopes(second)]);
      if (!result.rowCount) throw new Error("No active token with that id.");
      console.table(result.rows);
    } else if (command === "revoke") {
      const result = await client.query(
        `update integration_tokens set revoked_at = now() where id = $1 and revoked_at is null returning id, name, revoked_at`,
        [uuid(first, "token id")]);
      if (!result.rowCount) throw new Error("No active token with that id.");
      console.table(result.rows);
    } else {
      throw new Error("Use list, create, scopes or revoke.");
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
