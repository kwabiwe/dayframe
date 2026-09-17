import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {LOCATION_ENGINE_V2_CONFIG} from "@dayframe/shared";
const mocks=vi.hoisted(()=>({open:vi.fn(),fetch:vi.fn(),current:vi.fn(()=>true)}));
vi.mock("expo-sqlite",()=>({openDatabaseAsync:mocks.open}));
vi.mock("../config",()=>({DAYFRAME_API_BASE:"https://fixture.invalid"}));
vi.mock("../secure-session",()=>({SecureSessionUnavailableError:class extends Error{},invalidateMobileSessionIfCurrent:vi.fn(),isAuthenticatedSessionSnapshotCurrent:mocks.current,readOwnedAuthenticatedSessionSnapshot:async()=>({status:"authenticated",snapshot:{token:"synthetic"}})}));
vi.mock("../mobileAccount",()=>({mobileAccountOwnersEqual:(a:any,b:any)=>a?.userId===b?.userId&&a?.workspaceId===b?.workspaceId}));

const owner={userId:"91000000-0000-4000-8000-000000000001",workspaceId:"91000000-0000-4000-8000-000000000002"};
let db:DatabaseSync,store:typeof import("./store");
function adapter(){const value={execAsync:async(sql:string)=>{db.exec(sql);},getFirstAsync:async(sql:string,...args:never[])=>db.prepare(sql).get(...args)??null,getAllAsync:async(sql:string,...args:never[])=>db.prepare(sql).all(...args),runAsync:async(sql:string,...args:never[])=>db.prepare(sql).run(...args),withExclusiveTransactionAsync:async(fn:(t:unknown)=>Promise<void>)=>{db.exec("BEGIN IMMEDIATE");try{await fn(value);db.exec("COMMIT");}catch(error){db.exec("ROLLBACK");throw error;}}};return value;}
const replay=()=>({ok:true,clientAcknowledgedMode:false,replayVersion:LOCATION_ENGINE_V2_CONFIG.algorithmVersion,rolloutMode:"v2_shadow",finalisedSegmentCount:0,semanticSegmentCount:0,warnings:[]});
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();vi.stubGlobal("fetch",mocks.fetch);mocks.current.mockReturnValue(true);db=new DatabaseSync(":memory:");mocks.open.mockResolvedValue(adapter());
 store=await import("./store");await store.configureLocationAccount({...owner,deviceId:"ios-synthetic",timeZone:"Europe/London",savedPlaces:[],acceptedLearnedPlaces:[]},"v2_shadow");
 mocks.fetch.mockImplementation(async(url:string,init:RequestInit)=>{const batch=JSON.parse(init.body as string);return {ok:true,status:200,json:async()=>url.endsWith("/replay")?replay():{ok:true,acknowledgedEvidenceIds:batch.evidence.map((e:{clientEvidenceId:string})=>e.clientEvidenceId),replayVersion:LOCATION_ENGINE_V2_CONFIG.algorithmVersion,rolloutMode:"v2_shadow",warnings:[]}};});
});
afterEach(()=>{db.close();vi.unstubAllGlobals();});
async function seed(n=1){await store.persistLocationEvidence(Array.from({length:n},(_,i)=>({clientEvidenceId:`evidence-${i}`,deviceId:"ios-synthetic",algorithmVersion:LOCATION_ENGINE_V2_CONFIG.algorithmVersion,kind:"significant_change" as const,occurredAt:new Date(Date.now()-60_000+i*1000).toISOString(),receivedAt:new Date().toISOString(),timeZone:"Europe/London",latitude:51.5,longitude:-0.1,horizontalAccuracyMeters:10,metadata:{}})));await store.prepareLocationUploadBatch(owner);}
describe("Location real SQLite drain results",()=>{
 it("does not attribute legacy unscoped replay errors to the active owner",async()=>{
  db.exec("insert into location_store_metadata(key,value,updated_at) values('last_server_replay_error','old account failure','2026-08-01'),('last_upload_error','older failure','2026-08-01')");
  expect(await store.getLocationStoreDiagnostics()).toMatchObject({lastServerReplayError:null,lastUploadError:null});
  await seed();await store.syncLocationEvidence({forceReplay:true});
  expect(await store.getLocationStoreDiagnostics()).toMatchObject({lastServerReplayStatus:"success",pendingEvidenceCount:0});
 });
 it("manual upload override tries retained backoff once while ordinary sync waits",async()=>{
  await seed();db.exec("update location_upload_outbox set next_attempt_at='2099-01-01T00:00:00Z'");
  await store.syncLocationEvidence();expect(mocks.fetch.mock.calls.filter(([url])=>url.endsWith("/evidence"))).toHaveLength(0);
  await store.syncLocationEvidence({forceUploadRetry:true} as never);
  expect(mocks.fetch.mock.calls.filter(([url])=>url.endsWith("/evidence"))).toHaveLength(1);
 });
 it("does not report completion just because replay succeeded while uploads wait",async()=>{
  await seed();db.exec("update location_upload_outbox set next_attempt_at='2099-01-01T00:00:00Z'");
  const result=await store.syncLocationEvidence({forceReplay:true});
  expect(result.synced).toBe(false);
  expect(result).toMatchObject({outcome:"backoff",remainingPendingEvidence:1});
 });
 it("settles only acknowledged evidence and never retries the same remainder in its forced pass",async()=>{
  await seed(2);
  mocks.fetch.mockImplementation(async(url:string,init:RequestInit)=>{const b=JSON.parse(init.body as string);return {ok:true,status:200,json:async()=>url.endsWith("/replay")?replay():{ok:true,acknowledgedEvidenceIds:[b.evidence[0].clientEvidenceId],replayVersion:LOCATION_ENGINE_V2_CONFIG.algorithmVersion,rolloutMode:"v2_shadow",warnings:["semantic_replay_deferred"]}};});
  const result=await store.syncLocationEvidence({forceReplay:true,forceUploadRetry:true} as never);
  expect(mocks.fetch.mock.calls.filter(([url])=>url.endsWith("/evidence"))).toHaveLength(1);
  expect(result).toMatchObject({synced:false,remainingPendingEvidence:1});
  expect(db.prepare("select count(*) as n from location_evidence_journal where upload_state='acknowledged'").get()!.n).toBe(1);
 });
});

describe("Location reliability diagnostics on real SQLite",()=>{
 const failure=()=>new Response(JSON.stringify({code:"location_processing_busy",reason:"operation_timeout",phase:"effect",locationStage:"lineage",sqlState:"57014",retryAfterMs:5000,rawPayload:{latitude:51,token:"secret"}}),{status:503,headers:{"X-Dayframe-Request-Id":"01234567-89ab-4cde-8123-456789abcdef","X-Dayframe-Duration-Ms":"7000"}});
 it("keeps replay failure visible with an empty upload queue; upload success only clears upload",async()=>{
  await seed();mocks.fetch.mockResolvedValue(failure());await store.syncLocationEvidence({forceReplay:true});
  let diagnostics=await store.getLocationStoreDiagnostics();
  expect(diagnostics.uploadAttempt).toMatchObject({outcome:"failed",details:{httpStatus:503,locationStage:"lineage",durationMs:7000}});
  mocks.fetch.mockImplementation(async(url:string,init:RequestInit)=>url.endsWith("/replay")?failure():new Response(JSON.stringify({ok:true,acknowledgedEvidenceIds:JSON.parse(init.body as string).evidence.map((e:{clientEvidenceId:string})=>e.clientEvidenceId)})));
  await store.syncLocationEvidence({forceUploadRetry:true,forceReplay:true});
  diagnostics=await store.getLocationStoreDiagnostics();
  expect(diagnostics).toMatchObject({pendingEvidenceCount:0,uploadAttempt:{outcome:"success"},replayAttempt:{outcome:"failed",details:{endpoint:"replay",httpStatus:503,requestId:"01234567-89ab-4cde-8123-456789abcdef"}}});
  expect(JSON.stringify(diagnostics)).not.toContain("secret");
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify(replay())));
  await store.syncLocationEvidence({forceReplay:true});
  expect(await store.getLocationStoreDiagnostics()).toMatchObject({uploadAttempt:{outcome:"success"},replayAttempt:{outcome:"success"},lastServerReplayError:null});
 });
 it("does not persist auth, cancellation or stale responses as endpoint failures",async()=>{
  await seed();mocks.fetch.mockResolvedValue(new Response("{}",{status:401}));
  await store.syncLocationEvidence({forceReplay:true});
  expect((await store.getLocationStoreDiagnostics()).uploadAttempt).toBeNull();
  mocks.fetch.mockImplementation(async()=>{mocks.current.mockReturnValue(false);return failure();});
  await store.syncLocationEvidence({forceUploadRetry:true});mocks.current.mockReturnValue(true);
  expect((await store.getLocationStoreDiagnostics()).uploadAttempt).toBeNull();
  const abort=new AbortController();mocks.fetch.mockImplementation(async()=>{abort.abort();return failure();});
  await store.syncLocationEvidence({forceUploadRetry:true,signal:abort.signal});
  expect((await store.getLocationStoreDiagnostics()).uploadAttempt).toBeNull();
 });
 it("ignores another backend's or legacy diagnostics and clears records at logout",async()=>{
  await seed();mocks.fetch.mockResolvedValue(failure());await store.syncLocationEvidence();
  const key=`sync_diagnostics:${owner.workspaceId}:${owner.userId}`;
  const value=JSON.parse(db.prepare("select value from location_store_metadata where key=?").get(key)!.value as string);
  value.diagnosticBinding.backend="https://another.invalid";
  db.prepare("update location_store_metadata set value=? where key=?").run(JSON.stringify(value),key);
  expect((await store.getLocationStoreDiagnostics()).uploadAttempt).toBeNull();
  await store.clearActiveLocationAccountData();
  expect(db.prepare("select value from location_store_metadata where key=?").get(key)).toBeUndefined();
 });
 it("diagnostic persistence failure does not redeliver acknowledged evidence or poison the queue",async()=>{
  await seed();db.exec(`create trigger fail_diagnostics before insert on location_store_metadata when NEW.key like 'sync_diagnostics:%' begin select raise(FAIL,'synthetic diagnostic failure'); end`);
  const first=await store.syncLocationEvidence({forceReplay:true});
  expect(first.remainingPendingEvidence).toBe(0);
  db.exec("drop trigger fail_diagnostics");await store.syncLocationEvidence({forceReplay:true});
  expect(mocks.fetch.mock.calls.filter(([url])=>url.endsWith("/evidence"))).toHaveLength(1);
  expect((await store.getLocationStoreDiagnostics()).replayAttempt?.outcome).toBe("success");
 });
 it.each(["null", "[]", "\"legacy text\"", "{bad"])("ignores malformed diagnostic metadata (%s)",async(raw)=>{
  const key=`sync_diagnostics:${owner.workspaceId}:${owner.userId}`;
  db.prepare("insert into location_store_metadata(key,value,updated_at) values(?,?,?)").run(key,raw,new Date().toISOString());
  expect((await store.getLocationStoreDiagnostics()).uploadAttempt).toBeNull();
  await store.syncLocationEvidence({forceReplay:true});
  expect((await store.getLocationStoreDiagnostics()).replayAttempt?.outcome).toBe("success");
 });
 it("retains last success across an endpoint failure and clears it on owner replacement",async()=>{
  await store.syncLocationEvidence({forceReplay:true});
  const success=(await store.getLocationStoreDiagnostics()).replayAttempt!;
  expect(success.lastSuccessAt).toBe(success.completedAt);
  mocks.fetch.mockResolvedValue(failure());await store.syncLocationEvidence({forceReplay:true});
  expect((await store.getLocationStoreDiagnostics()).replayAttempt).toMatchObject({outcome:"failed",lastSuccessAt:success.completedAt});
  await store.configureLocationAccount({...owner,userId:"another-owner",deviceId:"ios-synthetic",timeZone:"Europe/London",savedPlaces:[],acceptedLearnedPlaces:[]});
  expect((await store.getLocationStoreDiagnostics()).replayAttempt).toBeNull();
 });
 it("preserves request identity and the existing backoff despite a shorter diagnostic retry hint",async()=>{
  await seed();const before=db.prepare("select client_batch_id,body_json from location_upload_outbox").get();
  mocks.fetch.mockResolvedValue(failure());await store.syncLocationEvidence();
  const after=db.prepare("select client_batch_id,body_json,next_attempt_at from location_upload_outbox").get()!;
  expect(after).toMatchObject(before!);expect(Date.parse(after.next_attempt_at as string)-Date.now()).toBeGreaterThan(20_000);
 });
 it("seven batches settle across finite maximum-five passes without changing IDs",async()=>{
  for(let i=0;i<7;i++){
   const count=i===6?41:44;
   await store.persistLocationEvidence(Array.from({length:count},(_,j)=>({clientEvidenceId:`backlog-${i}-${j}`,deviceId:"ios-synthetic",algorithmVersion:LOCATION_ENGINE_V2_CONFIG.algorithmVersion,kind:"provider_status" as const,occurredAt:new Date().toISOString(),receivedAt:new Date().toISOString(),timeZone:"Europe/London",metadata:{}})));
   await store.prepareLocationUploadBatch(owner, {excludeBatchIds: db.prepare("select client_batch_id from location_upload_outbox").all().map(row=>row.client_batch_id as string)});
  }
  const identities=db.prepare("select client_batch_id,body_json from location_upload_outbox order by client_batch_id").all();
  const first=await store.syncLocationEvidence({forceReplay:true});expect(first.remainingPendingEvidence).toBeGreaterThan(0);
  expect(mocks.fetch.mock.calls.filter(([url])=>url.endsWith("/evidence"))).toHaveLength(5);
  const second=await store.syncLocationEvidence({forceReplay:true});expect(second.remainingPendingEvidence).toBe(0);
  expect(db.prepare("select client_batch_id,body_json from location_upload_outbox order by client_batch_id").all()).toEqual(identities);
  expect((await store.getLocationStoreDiagnostics()).acknowledgedEvidenceCount).toBe(305);
 });
});

describe("complete saved-place snapshot replay", () => {
 it.each([
  ["corroborated Visit", {}],
  ["arrival-conflict fallback", { includeVisit: false }]
 ] as const)("keeps the %s local replay in parity with the shared engine", async (_label, options) => {
  const { runLocationEngine } = await import("@dayframe/shared");
  const { savedPlaceArrivalBoundaryFixture } = await import("../../../../../packages/shared/src/location/savedPlaceArrivalBoundaryFixture");
  const fixture = savedPlaceArrivalBoundaryFixture(options);
  await store.configureLocationAccount({
   ...owner,
   deviceId: fixture.evidence[0].deviceId,
   timeZone: "Europe/London",
   savedPlaces: fixture.savedPlaces,
   acceptedLearnedPlaces: []
  }, "v2_review");
  await store.persistLocationEvidence(fixture.evidence);
  await store.prepareLocationUploadBatch(owner);
  const journal = db.prepare("select * from location_evidence_journal order by client_evidence_id").all();
  const uploads = db.prepare("select * from location_upload_outbox order by client_batch_id").all();

  await store.processPendingLocationEvidence(fixture.processingAt);

  const current = db
   .prepare("select segment_json from location_segment_snapshot where account_key=(select account_key from location_account_context)")
   .all()
   .map((row) => JSON.parse(row.segment_json as string));
  current.sort((left, right) =>
   Date.parse(left.startedAt) - Date.parse(right.startedAt) || left.kind.localeCompare(right.kind)
  );
  expect(current).toEqual(runLocationEngine(fixture).segmentUpserts);
  expect(db.prepare("select * from location_evidence_journal order by client_evidence_id").all()).toEqual(journal);
  expect(db.prepare("select * from location_upload_outbox order by client_batch_id").all()).toEqual(uploads);
  expect(db.prepare("select count(*) as n from location_segment_snapshot where account_key='other-account'").get()!.n).toBe(0);
 });

 it("replaces obsolete account snapshots with identical shared output, including empty output", async () => {
  const { incident, place } = await import("../../../../../packages/shared/src/location/savedPlaceQualityFixture");
  const { runLocationEngine } = await import("@dayframe/shared");
  const fixture = incident();
  await store.configureLocationAccount({ ...owner, deviceId: fixture.evidence[0].deviceId, timeZone: "Europe/London", savedPlaces: [place], acceptedLearnedPlaces: [] }, "v2_shadow");
  await store.persistLocationEvidence(fixture.evidence);
  const key = db.prepare("select account_key from location_account_context").get()!.account_key as string;
  db.prepare("insert into location_segment_snapshot values(?,?,?,?)").run(key,"obsolete","{}",fixture.processingAt);
  db.prepare("insert into location_segment_snapshot values(?,?,?,?)").run("other-account","other","{}",fixture.processingAt);
  const journal = db.prepare("select * from location_evidence_journal order by client_evidence_id").all();
  const uploads = db.prepare("select * from location_upload_outbox order by client_batch_id").all();
  await store.processPendingLocationEvidence(fixture.processingAt);
  const current = db.prepare("select segment_json from location_segment_snapshot where account_key=?").all(key).map(r=>JSON.parse(r.segment_json as string));
  expect(current).toEqual(runLocationEngine(fixture).segmentUpserts);
  expect(db.prepare("select * from location_evidence_journal order by client_evidence_id").all()).toEqual(journal);
  expect(db.prepare("select * from location_upload_outbox order by client_batch_id").all()).toEqual(uploads);
  expect(db.prepare("select count(*) n from location_segment_snapshot where account_key='other-account'").get()!.n).toBe(1);
  // A synthetic empty complete journal is different from a partial upload response.
  db.prepare("delete from location_evidence_journal where account_key=?").run(key);
  await store.processPendingLocationEvidence(fixture.processingAt);
  expect(db.prepare("select count(*) n from location_segment_snapshot where account_key=?").get(key)!.n).toBe(0);
  expect(db.prepare("select count(*) n from location_segment_snapshot where account_key='other-account'").get()!.n).toBe(1);
 });
 it("rolls back pruning and state when replacement fails", async () => {
  await seed();
  const key = db.prepare("select account_key from location_account_context").get()!.account_key as string;
  db.prepare("insert into location_segment_snapshot values(?,?,?,?)").run(key,"obsolete","{}",new Date().toISOString());
  const before = db.prepare("select * from location_segment_snapshot").all();
  const state = db.prepare("select * from location_engine_state").all();
  db.exec("create trigger fail_replay before insert on location_store_metadata when NEW.key = 'last_engine_state' begin select raise(FAIL,'synthetic replay failure'); end");
  await expect(store.processPendingLocationEvidence()).rejects.toThrow();
  expect(db.prepare("select * from location_segment_snapshot").all()).toEqual(before);
  expect(db.prepare("select * from location_engine_state").all()).toEqual(state);
 });
});
