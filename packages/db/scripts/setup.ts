import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL ?? "postgres://dayframe:dayframe@localhost:54322/dayframe";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

async function run() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    for (const file of ["migrations/001_init.sql", "seed.sql"]) {
      const sql = readFileSync(resolve(root, file), "utf8");
      console.log(`Applying ${file}`);
      await client.query(sql);
    }
    console.log("Dayframe database is ready.");
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
