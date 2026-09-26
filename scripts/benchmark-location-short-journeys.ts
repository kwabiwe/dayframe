import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { runLocationEngine, LOCATION_ENGINE_V2_CONFIG as config, locationAcceptanceFixture } from "@dayframe/shared";
import { deriveCommutes } from "../packages/shared/src/location/commute";
import { shortJourneysFixture } from "../packages/shared/test/fixtures/shortJourneys";
import { baselineB, baselineC } from "../packages/shared/test/fixtures/eveningBaseline";
import { replayScalabilityHistory, REPLAY_SCALABILITY_CLOCK, REPLAY_SCALABILITY_PLACE_A, REPLAY_SCALABILITY_PLACE_B } from "./fixtures/location-replay-scalability";

async function main() {
  const baseRoot=process.argv.find(a=>a.startsWith('--base-root='))?.slice('--base-root='.length);
  assert(baseRoot,'Supply an archive of the verified base with --base-root=...');
  const {runLocationEngine:baseEngine}=await import(pathToFileURL(resolve(baseRoot,'packages/shared/src/location/segmenter.ts')).href);
  const {deriveCommutes:baseDerive}=await import(pathToFileURL(resolve(baseRoot,'packages/shared/src/location/commute.ts')).href);
  const template=shortJourneysFixture();
  const ids={placeAId:'10000000-0000-4000-8000-000000000021',placeBId:'10000000-0000-4000-8000-000000000022'};
  const input={...template,evidence:replayScalabilityHistory(ids),processingAt:REPLAY_SCALABILITY_CLOCK,
    savedPlaces:[{...REPLAY_SCALABILITY_PLACE_A,id:ids.placeAId},{...REPLAY_SCALABILITY_PLACE_B,id:ids.placeBId}]};
  // Complete outputs, not counts: ordinary behaviour and B/C remain byte-equivalent.
  for(const fixture of [input,locationAcceptanceFixture(),{...template,...baselineB},{...template,...baselineC}]) {
    assert.deepEqual(runLocationEngine(fixture),baseEngine(fixture));
  }
  const median=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
  function measure(base:()=>unknown, candidate:()=>unknown) {
    base(); candidate();
    const before:number[]=[],after:number[]=[];
    for(let i=0;i<15;i++) {
      for(const [fn,values] of (i%2?[[candidate,after],[base,before]]:[[base,before],[candidate,after]]) as [()=>unknown,number[]][]) {
        const start=performance.now();fn();values.push(performance.now()-start);
      }
    }
    return {baseMedianMs:median(before),candidateMedianMs:median(after),baseMaxMs:Math.max(...before),candidateMaxMs:Math.max(...after)};
  }
  console.log(JSON.stringify({workload:'retained seven-day full engine',evidence:input.evidence.length,...measure(()=>baseEngine(input),()=>runLocationEngine(input))}));
  // Repeated A episodes create many newly examined short pairs amid retained evidence.
  const dense={...template,evidence:Array.from({length:56},(_,i)=>template.evidence.map(e=>({...e,clientEvidenceId:`${i}-${e.clientEvidenceId}`,
    occurredAt:new Date(Date.parse(e.occurredAt)+i*7_200_000).toISOString(),sourceTimestamp:new Date(Date.parse(e.occurredAt)+i*7_200_000).toISOString(),
    endedAt:e.endedAt?new Date(Date.parse(e.endedAt)+i*7_200_000).toISOString():null}))).flat(),processingAt:'2026-01-17T00:00:00.000Z'};
  const derived=runLocationEngine(dense);
  const stays=derived.segmentUpserts.filter(s=>s.kind==='stay');
  const before=baseDerive(stays,derived.acceptedEvidence,config,dense.processingAt);
  const after=deriveCommutes(stays,derived.acceptedEvidence,config,dense.processingAt);
  assert.equal(after.length-before.length,112);
  console.log(JSON.stringify({workload:'112 newly eligible short pairs, derivation only',evidence:dense.evidence.length,stays:stays.length,...measure(
    ()=>baseDerive(stays,derived.acceptedEvidence,config,dense.processingAt),()=>deriveCommutes(stays,derived.acceptedEvidence,config,dense.processingAt))}));
  console.log('PASS complete base/head ordinary, B and C outputs identical; additional work measured without hosted claims.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
