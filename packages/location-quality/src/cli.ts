import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readAnswerKey, toSeconds, type TimelineEntry } from "./answerKey";
import { parseEvidenceRows, parsePlaceRows, projectionAround } from "./evidenceRows";
import { renderReport, summary } from "./report";
import { loadEngine, replay, sharedEngine } from "./replay";
import { scoreRun } from "./score";
import { sanitizeQualitySegments, type QualitySegment } from "./segments";

const USAGE = `Location quality harness (location v4 §13). Private inputs and outputs must live outside the repository.

Replay main's engine over private evidence rows and score it:
  npm run score -w @dayframe/location-quality -- --answer-key <Timeline.json> \\
    --rows <evidence.psv> --places <places.psv> --from <ISO> --to <ISO> [--at <ISO>]

Replay needs --origin-latitude <deg>: the latitude the private rows were exported around.
Score a saved run instead:     --segments <segments.json> [--home-place P4]
Replay another checkout:       --engine <checkout>/packages/shared/src/location
Write the run or the scores:   --save-segments <file.json>  --summary-json <file.json>
Also:  --detail  --time-zone Europe/London  --home-place P4
       --drop-motion  --drop-places P2,P5  --received-until <ISO>`;

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** npm runs workspace scripts in the package folder; relative paths mean the folder the command was typed in. */
export const callerPath = (file: string) => path.resolve(process.env.INIT_CWD ?? process.cwd(), file);

/**
 * Where a path really leads, resolved one component at a time in filesystem order, as the system
 * does when it opens or creates the file: a symlink is followed before any `..` after it, and a
 * dangling link leads to its target. A missing component ends the walk (nothing below it can be a
 * link), so an output not written yet resolves through its nearest existing parent.
 */
export function realPathOf(absolute: string, depth = 0): string {
  if (depth > 40) throw new Error("Too many symbolic links in a private path.");
  const parts = absolute.split(path.sep).filter((part) => part !== "" && part !== ".");
  let current = path.parse(absolute).root || path.sep;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === "..") {
      current = path.dirname(current);
      continue;
    }
    const next = path.join(current, part);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(next);
    } catch {
      return path.join(current, ...parts.slice(index));
    }
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(next);
      current = realPathOf(path.isAbsolute(target) ? target : `${current}${path.sep}${target}`, depth + 1);
    } else {
      current = next;
    }
  }
  return current;
}

/**
 * Private inputs and outputs never live inside the repository, so they cannot be committed by
 * accident. The check is by path component on where the path really leads, and the caller reads or
 * writes that resolved path, so what is checked is what is used.
 */
export function assertOutsideRepository(file: string, root = REPOSITORY_ROOT): string {
  const absolute = path.isAbsolute(file) ? file : `${process.env.INIT_CWD ?? process.cwd()}${path.sep}${file}`;
  const real = realPathOf(absolute);
  const relative = path.relative(realPathOf(path.resolve(root)), real);
  const inside = relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  if (inside) throw new Error(`Refusing ${callerPath(file)}: private location inputs and outputs must live outside the repository.`);
  return real;
}

/** Reads private JSON; a parse failure never quotes the file. */
export function readPrivateJson(file: string, what: string): unknown {
  const text = fs.readFileSync(assertOutsideRepository(file), "utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Could not read ${what}: it is not valid JSON.`);
  }
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
      // The latitude the private rows were exported around. Rows are relative metres, but the
      // projection still moves distances by a few metres, so a replay must use the export's own value.
      "origin-latitude": { type: "string" },
      "drop-motion": { type: "boolean", default: false },
      "drop-places": { type: "string" },
      "received-until": { type: "string" },
      "save-segments": { type: "string" },
      "summary-json": { type: "string" },
      detail: { type: "boolean", default: false },
      help: { type: "boolean", default: false }
    }
  });
  const replaying = !values.segments;
  if (values.help || !values["answer-key"] || !values.from || !values.to
    || (replaying && !(values.rows && values.places && values["origin-latitude"]))) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 2);
  }
  const timeZone = values["time-zone"]!;
  const from = toSeconds(values.from, "--from");
  const to = toSeconds(values.to, "--to");
  if (!(to > from)) throw new Error("--to must be after --from.");
  // Check every private path before reading or writing any of them.
  for (const name of ["answer-key", "rows", "places", "segments", "save-segments", "summary-json"] as const) {
    if (values[name]) assertOutsideRepository(values[name]);
  }

  let segments: QualitySegment[];
  let homePlace = values["home-place"] ?? null;
  if (values.segments) {
    segments = sanitizeQualitySegments(readPrivateJson(values.segments, "the saved run"));
  } else {
    const engine = values.engine ? await loadEngine(callerPath(values.engine)) : sharedEngine;
    const originLatitude = Number(values["origin-latitude"]);
    if (!Number.isFinite(originLatitude) || Math.abs(originLatitude) >= 90) throw new Error("--origin-latitude must be a latitude in degrees.");
    const projection = projectionAround(originLatitude);
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

  const entries = readPrivateJson(values["answer-key"], "the answer key");
  if (!Array.isArray(entries)) throw new Error("The answer key must be a Timeline.json array.");
  const report = scoreRun(readAnswerKey(entries as TimelineEntry[], from, to), segments, { from, to, homePlace, timeZone });
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
