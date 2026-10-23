import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readAnswerKey, toSeconds, type TimelineEntry } from "./answerKey";
import { parseEvidenceRows, parsePlaceRows, projectionAround } from "./evidenceRows";
import { renderReport, summary } from "./report";
import { loadEngine, replay, sharedEngine } from "./replay";
import { scoreRun } from "./score";
import type { QualitySegment } from "./segments";

const USAGE = `Location quality harness (location v4 §13). Private inputs and outputs must live outside the repository.

Replay main's engine over private evidence rows and score it:
  npm run score -w @dayframe/location-quality -- --answer-key <Timeline.json> \\
    --rows <evidence.psv> --places <places.psv> --from <ISO> --to <ISO> [--at <ISO>]

Score a saved run instead:     --segments <segments.json>
Replay another checkout:       --engine <checkout>/packages/shared/src/location
Write the run or the scores:   --save-segments <file.json>  --summary-json <file.json>
Also:  --detail  --time-zone Europe/London  --home-place P4  --origin-latitude <deg>
       --drop-motion  --drop-places P2,P5  --received-until <ISO>`;

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** npm runs workspace scripts in the package folder; relative paths mean the folder the command was typed in. */
const CALLER_DIRECTORY = process.env.INIT_CWD ?? process.cwd();

/** Private inputs and outputs never live inside the repository, so they cannot be committed by accident. */
export function assertOutsideRepository(file: string, root = REPOSITORY_ROOT): string {
  const resolved = path.resolve(CALLER_DIRECTORY, file);
  const relative = path.relative(path.resolve(root), resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error(`Refusing ${resolved}: private location inputs and outputs must live outside the repository.`);
  }
  return resolved;
}

async function main() {
  const { values } = parseArgs({
    options: {
      "answer-key": { type: "string" },
      rows: { type: "string" },
      places: { type: "string" },
      segments: { type: "string" },
      engine: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      at: { type: "string" },
      "time-zone": { type: "string", default: "Europe/London" },
      "home-place": { type: "string" },
      // A synthetic mid-latitude. Rows are relative metres, so distances survive any origin to within
      // a metre; 45° reproduces the design baseline exactly.
      "origin-latitude": { type: "string", default: "45" },
      "drop-motion": { type: "boolean", default: false },
      "drop-places": { type: "string" },
      "received-until": { type: "string" },
      "save-segments": { type: "string" },
      "summary-json": { type: "string" },
      detail: { type: "boolean", default: false },
      help: { type: "boolean", default: false }
    }
  });
  if (values.help || !values["answer-key"] || !values.from || !values.to || (!values.segments && !(values.rows && values.places))) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 2);
  }
  const timeZone = values["time-zone"]!;
  const from = toSeconds(values.from);
  const to = toSeconds(values.to);
  if (!(to > from)) throw new Error("--to must be after --from.");
  // Check every private path before reading or writing any of them.
  for (const name of ["answer-key", "rows", "places", "segments", "save-segments", "summary-json"] as const) {
    if (values[name]) assertOutsideRepository(values[name]);
  }

  let segments: QualitySegment[];
  let homePlace = values["home-place"] ?? null;
  if (values.segments) {
    segments = JSON.parse(fs.readFileSync(assertOutsideRepository(values.segments), "utf8"));
  } else {
    const engine = values.engine ? await loadEngine(values.engine) : sharedEngine;
    const projection = projectionAround(Number(values["origin-latitude"]));
    const dropped = new Set((values["drop-places"] ?? "").split(",").filter(Boolean));
    const places = parsePlaceRows(fs.readFileSync(assertOutsideRepository(values.places!), "utf8"), projection)
      .filter((place) => !dropped.has(place.label));
    homePlace ??= places.find((place) => place.role === "home")?.label ?? null;
    const evidence = parseEvidenceRows(fs.readFileSync(assertOutsideRepository(values.rows!), "utf8"), projection, {
      algorithmVersion: engine.config.algorithmVersion,
      dropMotion: values["drop-motion"],
      receivedUntil: values["received-until"] ? Date.parse(values["received-until"]) : undefined
    });
    segments = replay(engine, evidence, places, values.at ?? values.to);
  }
  if (values["save-segments"]) {
    fs.writeFileSync(assertOutsideRepository(values["save-segments"]), `${JSON.stringify(segments, null, 1)}\n`);
  }

  const entries = JSON.parse(fs.readFileSync(assertOutsideRepository(values["answer-key"]), "utf8")) as TimelineEntry[];
  const report = scoreRun(readAnswerKey(entries, from, to), segments, { from, to, homePlace, timeZone });
  process.stdout.write(renderReport(report, timeZone, { detail: values.detail }));
  if (values["summary-json"]) {
    fs.writeFileSync(assertOutsideRepository(values["summary-json"]), `${JSON.stringify(summary(report), null, 2)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
