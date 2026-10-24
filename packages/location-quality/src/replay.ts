import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  LOCATION_ENGINE_V2_CONFIG,
  runLocationEngine,
  type LocationEngineConfig,
  type LocationEngineInput,
  type LocationEngineOutput,
  type LocationEvidence,
  type SavedPlaceForMatching
} from "@dayframe/shared";
import { placeLabelFromId } from "./evidenceRows";
import { toQualitySegments, type QualitySegment } from "./segments";

export type LocationEngine = {
  run: (input: LocationEngineInput) => LocationEngineOutput;
  config: LocationEngineConfig;
};

export const sharedEngine: LocationEngine = { run: runLocationEngine, config: LOCATION_ENGINE_V2_CONFIG };

/**
 * Loads the engine from another checkout's `packages/shared/src/location` (a branch, or `git archive`
 * of an older commit), so two engines can be scored on the same evidence.
 */
export async function loadEngine(locationDir: string): Promise<LocationEngine> {
  const base = path.resolve(locationDir);
  const segmenter = await import(pathToFileURL(path.join(base, "segmenter.ts")).href);
  const config = await import(pathToFileURL(path.join(base, "config.ts")).href);
  return { run: segmenter.runLocationEngine, config: config.LOCATION_ENGINE_V2_CONFIG };
}

/**
 * One full replay from an empty state, as if every row arrived before `processingAt`. Exported rows
 * hold positions as metres from a hidden origin, so they are nowhere near real stations: the bundled
 * station list is switched off (an older engine without the switch ignores it).
 */
export function replay(engine: LocationEngine, evidence: LocationEvidence[], savedPlaces: SavedPlaceForMatching[], processingAt: string,
  broadReadingTimes: readonly number[] = []): QualitySegment[] {
  const output = engine.run({
    evidence,
    // Times of readings the server kept as too broad, as replay passes them (an older engine ignores it).
    broadReadingTimes,
    savedPlaces,
    acceptedLearnedPlaces: [],
    config: { ...engine.config, tripStationsEnabled: false },
    processingAt,
    priorState: { algorithmVersion: engine.config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null }
  });
  return toQualitySegments(output.segmentUpserts, placeLabelFromId);
}
