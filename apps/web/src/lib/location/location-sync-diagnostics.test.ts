import {describe,it,expect,vi,afterEach} from "vitest";
import {locationRequestDiagnostics,observeLocationStage} from "./location-sync-diagnostics";
import {SyncOperationError} from "../sync-transaction";
describe("request-local Location observation",()=>{
 afterEach(()=>vi.restoreAllMocks());
 it("keeps concurrent requests independent and completion records bounded",async()=>{
  const log=vi.spyOn(console,"info").mockImplementation(()=>{});
  const a=locationRequestDiagnostics("evidence",Date.now());const b=locationRequestDiagnostics("replay",Date.now());
  a.onLocationStage("bulk_evidence_write");b.onLocationStage("lineage");
  const responseA=a.finish(new Response(null,{status:503}),{syncPhase:"effect"},{error:"Busy",code:"location_processing_busy"});
  const responseB=b.finish(new Response(null,{status:503}),new SyncOperationError("operation_deadline","commit","location_evidence"),{error:"Busy"});
  a.finish(new Response(null));
  expect(log).toHaveBeenCalledTimes(2);
  expect((await responseA.json()).locationStage).toBe("bulk_evidence_write");
  expect(await responseB.json()).toMatchObject({phase:"commit"});
  expect(responseA.headers.get("X-Dayframe-Request-Id")).not.toBe(responseB.headers.get("X-Dayframe-Request-Id"));
 });
 it("does not turn observation/log failure into operation failure",()=>{
  vi.spyOn(console,"info").mockImplementation(()=>{throw new Error("log unavailable");});
  expect(()=>observeLocationStage({onLocationStage:()=>{throw new Error("observer unavailable");}},"engine")).not.toThrow();
  expect(locationRequestDiagnostics("replay",Date.now()).finish(new Response("success")).status).toBe(200);
 });
 it("classifies acquisition and auth failures without attributing them to last service work",()=>{
  const log=vi.spyOn(console,"info").mockImplementation(()=>{});
  const observer=locationRequestDiagnostics("replay",Date.now());
  observer.finish(new Response(null,{status:401}),{code:"session_expired"});
  expect(log).toHaveBeenCalledWith("location_sync",expect.any(String));
  expect(JSON.parse(log.mock.calls[0]![1] as string)).toMatchObject({outcome:"authentication_rejected",code:"session_expired",reason:"authentication_required"});
  const acquisition=locationRequestDiagnostics("evidence",Date.now());
  acquisition.finish(new Response(null,{status:503}),new SyncOperationError("connection_unavailable","acquire","location_evidence"),{error:"Busy"});
  const acquisitionRecord=JSON.parse(log.mock.calls[1]![1] as string);
  expect(acquisitionRecord).toMatchObject({phase:"acquire"});
  expect(acquisitionRecord).not.toHaveProperty("locationStage");
 });
 it("records bounded completed and active timings without sensitive fields",()=>{
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-17T10:00:00.000Z"));
  const log=vi.spyOn(console,"info").mockImplementation(()=>{});
  const observer=locationRequestDiagnostics("replay",Date.now());
  observer.onLocationTiming({stage:"request_auth",state:"started",remainingMs:7000});
  vi.advanceTimersByTime(12);
  observer.onLocationTiming({stage:"request_auth",state:"completed",remainingMs:6988});
  observer.onLocationTiming({stage:"lineage_insertion",state:"started",remainingMs:500});
  observer.onLocationCount("evidenceRows",1033);
  observer.onLocationCount("lineageLinksPrepared",250);
  observer.onLocationCount("lineageChunksStarted",1);
  observer.onLocationCount("lineageChunksCompleted",0);
  (observer.onLocationCount as (name:string,value:number)=>void)("workspaceId",42);
  vi.advanceTimersByTime(20);
  observer.finish(new Response(null,{status:503}),new SyncOperationError("operation_deadline","effect","location_evidence"),{error:"Busy"});
  const retainedPayload=log.mock.calls[0]![1] as string;
  expect(retainedPayload).not.toContain("[Object]");
  const record=JSON.parse(retainedPayload) as {timing:{stages:Record<string,unknown>;counts:Record<string,number>}};
  expect(record.timing).toEqual({
   stages:{
    request_auth:{elapsedMs:12,completed:true,remainingMsAtStart:7000,remainingMsAfter:6988},
    lineage_insertion:{elapsedMs:20,completed:false,remainingMsAtStart:500}
   },
   counts:{evidenceRows:1033,lineageLinksPrepared:250,lineageChunksStarted:1,lineageChunksCompleted:0}
  });
  expect(JSON.stringify(record)).not.toMatch(/workspace|user|coordinate|secret/i);
  vi.useRealTimers();
 });
 it("freezes a failure snapshot before late work can report completion",()=>{
  const log=vi.spyOn(console,"info").mockImplementation(()=>{});
  const observer=locationRequestDiagnostics("replay",Date.now());
  observer.onLocationTiming({stage:"lineage_insertion",state:"started",remainingMs:100});
  observer.finish(new Response(null,{status:503}),new SyncOperationError("operation_deadline","effect","location_evidence"),{error:"Busy"});
  observer.onLocationTiming({stage:"lineage_insertion",state:"completed",remainingMs:0});
  const record=JSON.parse(log.mock.calls[0]![1] as string) as {timing:{stages:{lineage_insertion:{completed:boolean}}}};
  expect(record.timing.stages.lineage_insertion.completed).toBe(false);
 });
});
