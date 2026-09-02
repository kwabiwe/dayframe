import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const target = process.env.DATABASE_URL;
assert(target, "DATABASE_URL is required.");
const url = new URL(target);
assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.endsWith("_test"),
  "Validation setup requires a disposable local *_test database.");
const profile = process.argv[2];
assert(profile === "base" || profile === "ordered", "Choose base or ordered schema.");
const client = new pg.Client({ connectionString: target });
async function run() {
  await client.connect();
  try {
    const tables = await client.query("select 1 from pg_tables where schemaname = 'public' and tablename <> 'spatial_ref_sys' limit 1");
    assert(tables.rowCount === 0, "Refusing to initialise a non-empty database; create a new disposable *_test database.");
    const directory = resolve("packages/db/migrations");
    const files = profile === "base" ? ["001_init.sql"] : readdirSync(directory).filter(name => name.endsWith(".sql")).sort();
    for (const file of files) await client.query(readFileSync(resolve(directory, file), "utf8"));
    console.log(`Disposable ${profile} schema applied (${files.length} migrations, no account data seeded).`);
  } finally { await client.end(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
