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
  expect(log).toHaveBeenCalledWith("location_sync",expect.objectContaining({outcome:"authentication_rejected",code:"session_expired",reason:"authentication_required"}));
  const acquisition=locationRequestDiagnostics("evidence",Date.now());
  acquisition.finish(new Response(null,{status:503}),new SyncOperationError("connection_unavailable","acquire","location_evidence"),{error:"Busy"});
  expect(log.mock.calls[1][1]).toMatchObject({phase:"acquire"});
  expect(log.mock.calls[1][1]).not.toHaveProperty("locationStage");
 });
});
