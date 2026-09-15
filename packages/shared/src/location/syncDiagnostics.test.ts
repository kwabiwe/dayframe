import {describe,expect,it} from "vitest";
import {parseLocationSyncAttempt,parseLocationSyncDiagnostics} from "./syncDiagnostics";
describe("safe Location diagnostics",()=>{
  it("constructs a closed, bounded response and never retains private fields",()=>{
    const result=parseLocationSyncDiagnostics({code:"SQL with coordinates",reason:"secret",phase:"private",requestId:"token",
      sqlState:"55P03\n",retryAfterMs:Infinity,durationMs:-1,latitude:51,rawPayload:{token:"private"},error:"secret"},"evidence",503);
    expect(result).toEqual({endpoint:"evidence",httpStatus:503,code:"location_sync_failed",reason:"unknown",phase:"unknown"});
  });
  it.each([null,undefined,[],"HTML",42])("degrades malformed input safely (%s)",(value)=>{
    expect(parseLocationSyncDiagnostics(value,"replay",null).httpStatus).toBeNull();
    expect(parseLocationSyncAttempt(value,"replay")).toBeNull();
  });
  it("keeps known classifications and rejects misleading transaction substages",()=>{
    const safe={code:"location_processing_busy",reason:"lock_unavailable",phase:"owner_lock",locationStage:"lineage",
      sqlState:"55P03",requestId:"01234567-89ab-4cde-8123-456789abcdef",retryAfterMs:5000,durationMs:1500};
    expect(parseLocationSyncDiagnostics(safe,"replay",503)).toEqual({...safe,locationStage:undefined,endpoint:"replay",httpStatus:503});
    expect(parseLocationSyncDiagnostics({...safe,phase:"effect"},"replay",503).locationStage).toBe("lineage");
  });
  it("revalidates persisted attempts, discarding extra keys and wrong endpoint",()=>{
    const input={outcome:"failed",attemptedAt:"2026-09-14T00:00:00.000Z",completedAt:"2026-09-14T00:00:01.000Z",clientElapsedMs:1000,
      private:"secret",details:{endpoint:"replay",httpStatus:503,raw:"secret"}};
    expect(parseLocationSyncAttempt(input,"evidence")).toBeNull();
    expect(JSON.stringify(parseLocationSyncAttempt(input,"replay"))).not.toContain("secret");
  });
});
