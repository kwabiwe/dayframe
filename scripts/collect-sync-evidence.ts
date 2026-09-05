import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { pool } from "../apps/web/src/lib/db";
import { withSyncTransaction } from "../apps/web/src/lib/sync-transaction";

const Input = z.object({
  workspaceId: z.string().uuid(), userId: z.string().uuid(),
  clientMutationId: z.string().uuid(), reviewItemId: z.string().uuid(),
  from: z.string().datetime(), to: z.string().datetime(),
  deviceId: z.string().min(1).max(160).optional()
}).strict().refine(value => Date.parse(value.to) > Date.parse(value.from) &&
  Date.parse(value.to) - Date.parse(value.from) <= 14 * 86_400_000, "Evidence window must be at most 14 days.");

/** Explicit private export, never a repair. Pass an owner verified from the
 * affected authenticated app; no lookup by email or broad user enumeration. */
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Set the authorised DATABASE_URL explicitly.");
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error("Usage: collect-sync-evidence.ts INPUT.json OUTPUT.json");
  const destination = resolve(outputPath);
  if (!destination.includes("/.codex-dayframe-qa/")) throw new Error("Keep sensitive output under the ignored .codex-dayframe-qa directory.");
  const input = Input.parse(JSON.parse(await readFile(inputPath, "utf8")));
  const database = new URL(process.env.DATABASE_URL);
  const settings = await pool.query({
    text: `select current_user, current_database(), current_setting('server_version_num') as version,
      current_setting('statement_timeout') as statement_timeout, current_setting('lock_timeout') as lock_timeout,
      current_setting('idle_in_transaction_session_timeout') as idle_timeout,
      current_setting('transaction_timeout',true) as transaction_timeout`, query_timeout: 3_000
  });
  const data = await withSyncTransaction("private_evidence_export", async ({ client }) => {
    const scope = [input.workspaceId, input.userId];
    const receipt = await client.query(`select client_mutation_id,review_item_id,action_key,request_hash,result_json,created_at
      from review_mutation_receipts where workspace_id=$1 and user_id=$2 and client_mutation_id=$3`, [...scope,input.clientMutationId]);
    const review = await client.query(`select ri.*,ae.event_type,ae.client_event_id,ae.raw_payload,to_jsonb(ae)->>'resolved_time_entry_id' as resolved_time_entry_id
      from review_items ri left join activity_events ae on ae.id=ri.event_id and ae.workspace_id=ri.workspace_id and ae.user_id=ri.user_id
      where ri.workspace_id=$1 and ri.user_id=$2 and ri.id=$3`, [...scope,input.reviewItemId]);
    const source = review.rows[0];
    const linkedEntries = source ? await client.query(`select id,source,review_status,description,category_id,place_id,
      started_at,stopped_at,user_edited_at,created_from_event_id from time_entries
      where workspace_id=$1 and user_id=$2 and (created_from_event_id=$3 or id=$4)`,
      [...scope,source.event_id,source.resolved_time_entry_id]) : {rows:[]};
    const sleep = await client.query(`select id,client_event_id,occurred_at,review_status,raw_payload,to_jsonb(activity_events)->>'resolved_time_entry_id' as resolved_time_entry_id
      from activity_events where workspace_id=$1 and user_id=$2 and event_type='health_sleep_import'
      and occurred_at >= $3 and occurred_at < $4 order by occurred_at,id limit 5001`, [...scope,input.from,input.to]);
    const samples = await client.query(`select external_sample_id,provider,source_name,sleep_stage,started_at,stopped_at
      from health_sleep_segments where workspace_id=$1 and user_id=$2 and started_at < $4 and stopped_at > $3
      order by started_at,id limit 5001`, [...scope,input.from,input.to]);
    const evidence = input.deviceId ? await client.query(`select client_evidence_id,client_batch_id,evidence_type,occurred_at,
      accepted,rejection_reason,received_at from location_evidence where workspace_id=$1 and user_id=$2 and device_id=$3
      and occurred_at >= $4 and occurred_at < $5 order by occurred_at,id limit 5001`, [...scope,input.deviceId,input.from,input.to]) : {rows:[]};
    const commutes = await client.query(`select id,status,started_at,stopped_at,created_from_event_id,metadata
      from commute_segments where workspace_id=$1 and user_id=$2 and started_at < $4 and stopped_at > $3
      order by started_at,id limit 5001`, [...scope,input.from,input.to]);
    return {receipt:receipt.rows,review:review.rows,linkedEntries:linkedEntries.rows,
      sleepEvents:sleep.rows,sleepSamples:samples.rows,locationEvidence:evidence.rows,commutes:commutes.rows,
      truncated:[sleep,samples,evidence,commutes].some(result=>result.rows.length>5000)};
  }, {readOnly:true});
  await mkdir(dirname(destination), {recursive:true,mode:0o700});
  await writeFile(destination,JSON.stringify({observedAt:new Date().toISOString(),
    database:{host:database.hostname,port:database.port,database:database.pathname},settings:settings.rows,...data},null,2),{mode:0o600});
  console.log(`Private read-only evidence written to ${destination}.`);
}
main().catch(error=>{ console.error("Evidence collection failed", {name:error.name,code:error.code});process.exitCode=1; })
  .finally(()=>pool.end());
