import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {LOCATION_ENGINE_V2_CONFIG} from "@dayframe/shared";
const mocks=vi.hoisted(()=>({open:vi.fn(),fetch:vi.fn(),current:vi.fn(()=>true)}));
vi.mock("expo-sqlite",()=>({openDatabaseAsync:mocks.open}));
vi.mock("../config",()=>({DAYFRAME_API_BASE:"https://fixture.invalid"}));
vi.mock("../secure-session",()=>({SecureSessionUnavailableError:class extends Error{},invalidateMobileSessionIfCurrent:vi.fn(),isAuthenticatedSessionSnapshotCurrent:mocks.current,readOwnedAuthenticatedSessionSnapshot:async()=>({status:"authenticated",snapshot:{token:"synthetic"}})}));
vi.mock("../mobileAccount",()=>({mobileAccountOwnersEqual:(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)}));

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
