import { describe, expect, it } from "vitest";
import { deriveCommutes, qualifyCommuteCandidate, summariseCommuteEvidence } from "../src/location/commute";
import { runLocationEngine } from "../src/location/segmenter";
import { assessAutomaticLocation } from "../src/location/automaticPolicy";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import type { ClassifiedEvidence, StaySegment } from "../src/location/types";
import { baselineB, baselineC } from "./fixtures/eveningBaseline";
import { shortAt, shortJourneysFixture } from "./fixtures/shortJourneys";

function pair(duration = 84_496) {
  const input = shortJourneysFixture(true);
  const output = runLocationEngine(input);
  const stays = output.segmentUpserts.filter((s): s is StaySegment => s.kind === "stay").slice(0,2);
  stays[1] = {...stays[1], startedAt: shortAt(600_000+duration)};
  const route = output.acceptedEvidence.filter(e=>e.evidence.clientEvidenceId.startsWith("out-"));
  return {stays,route};
}
const derive = (stays: StaySegment[], route: ClassifiedEvidence[]) => deriveCommutes(stays, route, config, shortAt(3_000_000));

describe("strong-evidence short journeys", () => {
  it.each([false,true])("retains A bounds, linkage, IDs and confidence (saved destination %s)", (saved) => {
    const input = shortJourneysFixture(saved);
    const result = runLocationEngine(input);
    const stays = result.segmentUpserts.filter(s=>s.kind==='stay');
    const commutes = result.segmentUpserts.filter(s=>s.kind==='commute');
    expect(stays).toHaveLength(3);
    expect(commutes).toHaveLength(2);
    expect(commutes.map(s=>Date.parse(s.stoppedAt)-Date.parse(s.startedAt))).toEqual([84_496,81_000]);
    expect(commutes.map(s=>s.evidenceIds)).toEqual([["out-0","out-1","out-2"],["back-0","back-1","back-2"]]);
    for (let i=0;i<2;i++) {
      const c=commutes[i];
      expect(c.fromStaySegmentId).toBe(stays[i].clientSegmentId);
      expect(c.toStaySegmentId).toBe(stays[i+1].clientSegmentId);
      expect(c.startedAt).toBe(stays[i].stoppedAt);
      expect(c.stoppedAt).toBe(stays[i+1].startedAt);
      expect(c.startLowerBoundAt).toBe(c.startedAt);
      expect(c.startUpperBoundAt).toBe(c.startedAt);
      expect(c.stopLowerBoundAt).toBe(c.stoppedAt);
      expect(c.stopUpperBoundAt).toBe(c.stoppedAt);
      expect(c.confidence).toBe(saved?'medium_high':'low');
      expect(assessAutomaticLocation('v2_review',c)).toMatchObject({action:'review',reason:'review_mode'});
      expect(assessAutomaticLocation('v2_enabled',c)).toMatchObject({action:'review',reason:'short_journey_review_only'});
    }
    if (!saved) expect(commutes.map(s=>s.clientSegmentId)).toEqual(['commute_tjgxd3','commute_oil8sz']);
    expect(runLocationEngine(input)).toEqual(result);
    const duplicateInput={...input,evidence:[...input.evidence,...input.evidence]};
    expect(runLocationEngine(duplicateInput).segmentUpserts).toEqual(result.segmentUpserts);
  });
  it("records duration as the former first failure independently of displacement qualification",()=>{
    const {stays,route}=pair();
    const summary=summariseCommuteEvidence({config,from:stays[0],to:stays[1],routeEvidence:route,startedAtMs:600_000+Date.parse(shortAt(0)),stoppedAtMs:Date.parse(stays[1].startedAt)});
    expect(qualifyCommuteCandidate(summary,config)).toMatchObject({qualifies:true,reason:'significant_endpoint_displacement'});
    expect(summary.straightLineDistanceMeters).toBeGreaterThan(960);
  });
  it.each([0,-1,NaN,config.commuteMaximumDurationMs+1])("rejects invalid duration %s",duration=>{
    const {stays,route}=pair(); stays[1].startedAt=Number.isFinite(duration)?shortAt(600_000+duration):'invalid';
    expect(derive(stays,route)).toEqual([]);
  });
  it.each([179_999,180_000,180_001,config.commuteMaximumDurationMs])("preserves duration path %s",duration=>{
    const {stays,route}=pair(duration);
    expect(derive(stays,route)).toHaveLength(1);
    expect(derive(stays,route.slice(0,2))).toHaveLength(duration<180_000?0:1);
  });
  it.each([65,65.001,null,NaN,-1])("enforces accuracy %s",accuracy=>{
    const {stays,route}=pair();route[2].evidence.horizontalAccuracyMeters=accuracy;
    expect(derive(stays,route)).toHaveLength(accuracy===65?1:0);
  });
  it.each([2.799,2.8,120,120.001,NaN,Infinity])("enforces supplied speed %s",speed=>{
    const {stays,route}=pair();route[2].evidence.speedMetersPerSecond=speed;
    expect(derive(stays,route)).toHaveLength(speed>=2.8&&speed<=120?1:0);
  });
  it("requires three independent observations, not duplicate identities, receipts, mirrors or jitter",()=>{
    for(const variant of ['id','time','point','mirror'] as const){
      const {stays,route}=pair();const copy=structuredClone(route[1]);copy.evidence.clientEvidenceId='copy';
      copy.evidence.receivedAt=shortAt(4_000_000);
      if(variant==='id')copy.evidence.clientEvidenceId=route[1].evidence.clientEvidenceId;
      if(variant==='time')copy.evidence.latitude=0.006;
      if(variant==='point') {copy.evidence.occurredAt=shortAt(650_000);copy.evidence.sourceTimestamp=shortAt(650_000);}
      if(variant==='mirror') {copy.evidence.kind='significant_change';copy.evidence.occurredAt=shortAt(640_001);copy.evidence.sourceTimestamp=null;}
      expect(derive(stays,[...route.slice(0,2),copy]),variant).toEqual([]);
    }
  });
  it("does not use simulated, unknown-provenance, invalid, broad, or non-point sources",()=>{
    const patches=[{isSimulated:true},{isSimulated:null},{isSimulated:undefined},{latitude:NaN},{longitude:181},
      {horizontalAccuracyMeters:100},{kind:'visit' as const},{kind:'geofence_enter' as const},
      {occurredAt:'invalid'},{sourceTimestamp:'invalid'},{sourceTimestamp:shortAt(600_000)},{sourceTimestamp:shortAt(684_496)}];
    for(const patch of patches){const {stays,route}=pair();Object.assign(route[2].evidence,patch);expect(derive(stays,route),JSON.stringify(patch)).toEqual([]);}
  });
  it("vetoes implausible implied speed even with plausible supplied speed and significant-change kind",()=>{
    const {stays,route}=pair();route[2].evidence.kind='significant_change';route[2].impliedSpeedMetersPerSecond=121;
    expect(derive(stays,route)).toEqual([]);
  });
  it("uses implied speed only with an accurate non-simulated same-device predecessor",()=>{
    const input=shortJourneysFixture(true);
    input.evidence.forEach(e=>{if(e.clientEvidenceId.startsWith('out-'))e.speedMetersPerSecond=null;});
    expect(runLocationEngine(input).segmentUpserts.filter(s=>s.kind==='commute')).toHaveLength(2);
    input.evidence.find(e=>e.clientEvidenceId==='out-0')!.isSimulated=true;
    expect(runLocationEngine(input).segmentUpserts.filter(s=>s.kind==='commute')).toHaveLength(1);
  });
  it.each([799.99,800,800.01])("keeps displacement threshold %s",metres=>{
    const {stays,route}=pair();stays[1].centreLatitude=(metres/6_371_008.8)*180/Math.PI;
    expect(derive(stays,route)).toHaveLength(metres<800?0:1);
  });
  it("rejects co-located, same-identity endpoints and a lone jump",()=>{
    const {stays,route}=pair();expect(derive(stays,route.slice(0,1))).toEqual([]);
    stays[1].placeId=stays[0].placeId;expect(derive(stays,route)).toEqual([]);
    stays[1].placeId='other';stays[1].centreLatitude=0;expect(derive(stays,route)).toEqual([]);
  });
  it("keeps uncertainty, finalisation and disabled visit suggestions independent",()=>{
    const {stays,route}=pair();stays[0].continuityStatus='uncertain_gap';
    expect(derive(stays,route)[0].confidence).toBe('medium');
    expect(deriveCommutes(stays,route,config,shortAt(700_000))[0].status).toBe('closed');
    expect(deriveCommutes(stays,route,config,shortAt(1_284_496))[0].status).toBe('finalised');
    expect(deriveCommutes(stays,route,config,shortAt(3_000_000),{inferredBoundaryStayIds:new Set([stays[0].clientSegmentId])})[0].confidence).toBe('low');
    const input=shortJourneysFixture();expect(input.savedPlaces[0].loggingEnabled).toBe(false);
    expect(runLocationEngine(input).segmentUpserts.filter(s=>s.kind==='commute')).toHaveLength(2);
    expect(runLocationEngine(shortJourneysFixture(true)).segmentUpserts).not.toEqual(runLocationEngine(input).segmentUpserts);
  });
  it("does not join across a retained intermediate Home or infer a stop from traffic pauses",()=>{
    const input=shortJourneysFixture();
    const duplicate=input.evidence.map(e=>({...e,clientEvidenceId:`second-${e.clientEvidenceId}`,occurredAt:shortAt(Date.parse(e.occurredAt)-Date.parse(shortAt(0))+1_965_496),sourceTimestamp:shortAt(Date.parse(e.occurredAt)-Date.parse(shortAt(0))+1_965_496),endedAt:e.endedAt?shortAt(Date.parse(e.endedAt)-Date.parse(shortAt(0))+1_965_496):null}));
    input.evidence.push(...duplicate);input.processingAt=shortAt(6_000_000);
    const result=runLocationEngine(input);expect(result.segmentUpserts.filter(s=>s.kind==='commute')).toHaveLength(4);
    const {stays,route}=pair(180_000);route[1].evidence.speedMetersPerSecond=0;
    expect(derive(stays,route)).toHaveLength(1);
  });
});

// These are deliberately recorded failures, not acceptance of stop/matching behaviour.
describe("separate B/C baseline failures remain outside A", () => {
  it("B still omits the short remote stays and emits the long same-place journey", () => {
    const output=runLocationEngine({...shortJourneysFixture(),...baselineB});
    const commutes=output.segmentUpserts.filter(s=>s.kind==='commute');
    expect(commutes).toHaveLength(1);
    expect(commutes[0].qualificationReason).toBe('same_place_meaningful_round_trip');
    expect(Date.parse(commutes[0].stoppedAt)-Date.parse(commutes[0].startedAt)).toBe(2_392_602);
    expect(output.segmentUpserts.some(s=>s.kind==='stay'&&s.placeId===baselineB.savedPlaces[1].id)).toBe(false);
  });
  it("C still chooses the single eligible saved area, not proof of venue attendance", () => {
    const output=runLocationEngine({...shortJourneysFixture(),...baselineC});
    expect(output.segmentUpserts.some(s=>s.kind==='stay'&&s.placeId===baselineC.savedPlaces[0].id)).toBe(true);
    expect(baselineC.savedPlaces).toHaveLength(1);
  });
});
