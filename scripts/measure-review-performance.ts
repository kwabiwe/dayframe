import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeTimeIntervals } from "@dayframe/shared";
import { prepareReviewOverlapCounts, reviewPeerEntries } from "../apps/mobile/src/lib/reviewPresentation";
import { REVIEW_PERFORMANCE_PROFILES, SYNTHETIC_REVIEW_NOW, syntheticReviewBootstrap, syntheticReviewEvidence } from "./fixtures/review-performance";

const percentile = (samples: number[], fraction: number) => [...samples].sort((a,b) => a-b)[Math.min(samples.length-1, Math.floor(samples.length*fraction))];
const measure = (fn: () => void, n=20) => {
  fn(); const values: number[] = [];
  for(let i=0;i<n;i++) { const t=performance.now(); fn(); values.push(performance.now()-t); }
  return { medianMs: +percentile(values, .5).toFixed(3), p95Ms: +percentile(values, .95).toFixed(3) };
};
// A unique temporary local file is the only persistence target. No external
// endpoint, credentials, account data or production connection is accepted.
const directory=mkdtempSync(join(tmpdir(), 'dayframe-review-performance-'));
const db=new DatabaseSync(join(directory, 'fixture.db'));
try {
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE synthetic_cache (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL); CREATE TABLE synthetic_evidence (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL);');
  const insert=db.prepare('INSERT INTO synthetic_cache VALUES (?, ?)');
  const measurements=REVIEW_PERFORMANCE_PROFILES.map(count=>{
    const data=syntheticReviewBootstrap(count);
    const evidence=syntheticReviewEvidence(data);
    db.exec('DELETE FROM synthetic_cache; DELETE FROM synthetic_evidence; BEGIN IMMEDIATE;');
    for(const item of data.reviewItems) insert.run(item.id, JSON.stringify(item));
    for(const item of evidence) db.prepare('INSERT INTO synthetic_evidence VALUES (?, ?)').run(item.reviewItemId, JSON.stringify(item));
    db.exec('COMMIT;');
    const legacy=measure(()=>{
      for(const item of data.reviewItems) analyzeTimeIntervals([...reviewPeerEntries(data), {id:item.id,startedAt:item.suggestedStartedAt!,stoppedAt:item.suggestedStoppedAt!}],{now:SYNTHETIC_REVIEW_NOW});
    });
    const prepared=measure(()=>prepareReviewOverlapCounts(data.reviewItems,reviewPeerEntries(data),SYNTHETIC_REVIEW_NOW));
    const cacheHydration=measure(()=>{db.prepare('SELECT snapshot FROM synthetic_cache').all().map(x=>JSON.parse(String(x.snapshot)));});
    const evidenceCacheHydration=measure(()=>{db.prepare('SELECT snapshot FROM synthetic_evidence').all().map(x=>JSON.parse(String(x.snapshot)));});
    return {reviewItems:count,uniquePeerEntries:250,payloadBytes:Buffer.byteLength(JSON.stringify(data.reviewItems)),evidencePayloadBytes:Buffer.byteLength(JSON.stringify(evidence)),evidenceSamples:evidence.map(item=>item.segment.evidenceCount),legacy,prepared,cacheHydration,evidenceCacheHydration};
  });
  console.log(JSON.stringify({environment:`local Node ${process.version} ${process.platform}/${process.arch}`,samplesPerProfile:20,scope:'Desktop JS preparation and synthetic on-disk SQLite read/parse only. Native mount, first card, Back transition, POI/map and physical-iPhone timings NOT RUN.',measurements},null,2));
} finally {db.close();rmSync(directory,{recursive:true,force:true});}
