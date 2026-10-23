import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readAnswerKey, toSeconds, type TimelineEntry } from "./answerKey";
import { parseBroadReadingTimes, parseEvidenceRows, parsePlaceRows, projectionAround } from "./evidenceRows";
import { renderReport, summary } from "./report";
import { loadEngine, replay, sharedEngine } from "./replay";
import { scoreRun } from "./score";
import { sanitizeQualitySegments, type QualitySegment } from "./segments";
import { HarnessError } from "./errors";

const USAGE = `Location quality harness (location v4 §13). Private inputs and outputs must live outside the repository.

Replay main's engine over private evidence rows and score it:
  npm --silent run score:location -- --answer-key <Timeline.json> \\
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
  if (depth > 40) throw new HarnessError("Too many symbolic links in a private path.");
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
      // Nothing below a missing folder can be a link, but a ".." after it would climb back to
      // where one could be: refuse rather than guess.
      const rest = parts.slice(index);
      if (rest.includes("..")) throw new HarnessError("A private path may not use \"..\" after a folder that does not exist.");
      return path.join(current, ...rest);
    }
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(next);
      current = realPathOf(path.isAbsolute(target) ? target : `${current}${path.sep}${target}`, depth + 1);
    } else {
      // The name as the file system stores it, so a differently cased path to the same folder on a
      // case-insensitive volume compares equal.
      current = fs.realpathSync.native(next);
    }
  }
  return current;
}

/**
 * Private inputs and outputs never live inside the repository, so they cannot be committed by
 * accident. The check is by path component on where the path really leads, and the caller reads or
 * writes that resolved path, so what is checked is what is used.
 */
export function assertOutsideRepository(file: string, role = "private file", root = REPOSITORY_ROOT): string {
  const absolute = path.isAbsolute(file) ? file : `${process.env.INIT_CWD ?? process.cwd()}${path.sep}${file}`;
  const real = realPathOf(absolute);
  const repository = realPathOf(path.resolve(root));
  // Case-insensitive volumes (macOS, Windows) compare without case as well.
  const fold = (value: string) => (process.platform === "darwin" || process.platform === "win32" ? value.toLowerCase() : value);
  const relative = path.relative(fold(repository), fold(real));
  const inside = relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  // Messages name the role, never the path: a private file's name can itself be private.
  if (inside) throw new HarnessError(`Refusing the ${role}: private location inputs and outputs must live outside the repository.`);
  return real;
}

/** Reads a private file; a failure names its role, never its path or contents. */
export function readPrivateText(file: string, role: string): string {
  const real = assertOutsideRepository(file, role);
  try {
    return fs.readFileSync(real, "utf8");
  } catch {
    throw new HarnessError(`Could not read the ${role}.`);
  }
}

function writePrivateText(file: string, role: string, text: string) {
  const real = assertOutsideRepository(file, role);
  try {
    fs.writeFileSync(real, text);
  } catch {
    throw new HarnessError(`Could not write the ${role}.`);
  }
}

/** Reads private JSON; a parse failure never quotes the file. */
export function readPrivateJson(file: string, role: string): unknown {
  const text = readPrivateText(file, role);
  try {
    return JSON.parse(text);
  } catch {
    throw new HarnessError(`Could not read the ${role}: it is not valid JSON.`);
  }
}

const ROLES = {
  "answer-key": "answer key",
  rows: "evidence rows",
  places: "place rows",
  segments: "saved run",
  "save-segments": "saved run output",
  "summary-json": "summary output"
} as const;

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
  if (!(to > from)) throw new HarnessError("--to must be after --from.");
  // Check every private path before reading or writing any of them.
  for (const name of Object.keys(ROLES) as Array<keyof typeof ROLES>) {
    if (values[name]) assertOutsideRepository(values[name], `${ROLES[name]} (--${name})`);
  }

  let segments: QualitySegment[];
  let homePlace = values["home-place"] ?? null;
  if (values.segments) {
    segments = sanitizeQualitySegments(readPrivateJson(values.segments, ROLES.segments));
  } else {
    const engine = values.engine ? await loadEngine(callerPath(values.engine)) : sharedEngine;
    const originLatitude = Number(values["origin-latitude"]);
    if (!Number.isFinite(originLatitude) || Math.abs(originLatitude) >= 90) throw new HarnessError("--origin-latitude must be a latitude in degrees.");
    const projection = projectionAround(originLatitude);
    const dropped = new Set((values["drop-places"] ?? "").split(",").filter(Boolean));
    const places = parsePlaceRows(readPrivateText(values.places!, ROLES.places), projection)
      .filter((place) => !dropped.has(place.label));
    homePlace ??= places.find((place) => place.role === "home")?.label ?? null;
    const rowText = readPrivateText(values.rows!, ROLES.rows);
    const rowOptions = {
      algorithmVersion: engine.config.algorithmVersion,
      dropMotion: values["drop-motion"],
      receivedUntil: values["received-until"] ? Date.parse(values["received-until"]) : undefined
    };
    const evidence = parseEvidenceRows(rowText, projection, rowOptions);
    const broadReadingTimes = parseBroadReadingTimes(rowText, { ...rowOptions, minimumAccuracyMeters: engine.config.maxAcceptedHorizontalAccuracyMeters,
      maximumAccuracyMeters: (engine.config as { tripUnseenObservedAccuracyMeters?: number }).tripUnseenObservedAccuracyMeters ?? 500 });
    // The same allowlist as a saved run, so a replay can never carry more than one would.
    segments = sanitizeQualitySegments(replay(engine, evidence, places, values.at ?? values.to, broadReadingTimes));
  }
  if (values["save-segments"]) {
    writePrivateText(values["save-segments"], ROLES["save-segments"], `${JSON.stringify(segments, null, 1)}\n`);
  }

  const entries = readPrivateJson(values["answer-key"], ROLES["answer-key"]);
  if (!Array.isArray(entries)) throw new HarnessError("The answer key must be a Timeline.json array.");
  const report = scoreRun(readAnswerKey(entries as TimelineEntry[], from, to), segments, { from, to, homePlace, timeZone });
  process.stdout.write(renderReport(report, timeZone, { detail: values.detail }));
  if (values["summary-json"]) {
    writePrivateText(values["summary-json"], ROLES["summary-json"], `${JSON.stringify(summary(report), null, 2)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    // Only the harness's own messages are printed; anything else (a file system or engine error
    // could name a private path or quote input) is reported by its kind.
    console.error(error instanceof HarnessError ? error.message : `The harness stopped on an unexpected ${error instanceof Error ? error.name : "error"}.`);
    process.exit(1);
  });
}
