#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  ANALYSIS_SCHEMA_VERSION,
  DEFAULT_BACKGROUND_ROI,
  DEFAULT_SHEET_ROI,
  DEFAULT_VISUAL_THRESHOLDS,
  analyzeCalibratedVisualFrame,
  analyzeEvidenceProvenance,
  analyzePixelRegion,
  analyzeTelemetry,
  applyTemporalVisualContinuity,
  evaluateThresholds,
  frameIsInPresentationInterval,
  parseNdjson,
  parseNormalizedRoi,
  toCsv,
  visualCalibrationForFrame
} from "./sheet-recording-analysis.mjs";

const HELP = `Dayframe iOS sheet recording analyzer

Usage:
  npm run qa:sheet-recording -w @dayframe/mobile -- \\
    <simulator-recording.mov> --output <ignored-directory> [options]

Required:
  <video>                         Simulator .mov/.mp4 recording (or --video <path>)
  --output <directory>            New or empty output directory. If it is inside
                                  the Git worktree, it must be ignored.

Options:
  --events <telemetry.ndjson>     Optional development-harness geometry/events.
  --background-roi x,y,w,h        Normalized landmark region (default 0.05,0.03,0.9,0.28).
  --sheet-roi x,y,w,h             Normalized sheet region (default 0.03,0.4,0.94,0.57).
  --event-time-origin-ms <epoch>  Subtract this from absolute NDJSON timestamps.
  --committed-exit-ms <elapsed>   Legacy diagnostic committed-exit video time. This
                                  cannot satisfy strict exit-finished completeness.
  --sample-width <pixels>         Downsample width for pixel metrics (default 192).
  --analysis-concurrency <count>  Concurrent image analyses (default 4, maximum 16).
  --require-complete              Exit 2 when telemetry, lifecycle-frame coverage,
                                  or native-run provenance is incomplete.
  --help                          Show this help.

NDJSON contract (one object per line):
  - Timing: videoTimeMs, elapsedMs, timeMs, frameIndex, or absolute timestampMs.
  - Geometry: sheetRect/baseSheetRect/descriptionRect (x,y,width,height), including
    the same keys under geometry, measurement, measurements, rects, or state.geometry.
    Stable native checkpoints should also include screenAppRect, screenSheetRect,
    screenDescriptionRect, and screenOverlayRect. These calibrate a broad sheet-top
    edge (and Suggestions edge) that a populated dashboard underlay cannot satisfy.
  - Stable samples: settled:true, or sheetPhase:"presented" with stable keyboard/gesture.
  - Keyboard compensation: keyboardLift/keyboardInset is added to y. An explicit
    keyboardCompensation number is also added to y; an object may add x/y/width/height.
    geometryCoordinateSpace:"sheet_local" disables window-space compensation and
    compares live sheetRect samples only within equivalent stable keyboard layouts.
  - Expected transitions: expectedGeometryChange:true or eligibleForJumpCheck:false.
    Generic expectedTransition:true terminates the current stable visual window;
    exitStarted:true begins moving paired-landmark tracking instead. An
    expectedOverlayExit:true marker terminates only the Suggestions window.
  - Scope: runId plus presentationId keeps relaunched tests and reused IDs isolated.
  - Evidence provenance: clean runner_started source revision/fingerprint, a fresh
    successful build, runner-owned Metro, invocation/test run-ID pairing, successful
    runner completion, and matching source_verification_finished metadata.
  - Lifecycle: sheet_open_started/openStarted begins entrance tracking. A matching
    sheet_exit_finished with exitFinished/committedExit ends the presentation;
    multi-presentation recordings are checked through the complete exit animation.
    A semantic sheet_exit_committed marker alone remains incomplete evidence.
  - Guardrails: staleCallback/duplicateMutation booleans or cumulative ...Count values.
    Mutation start/finish event types plus operationToken are also checked for overlap/reuse.

Outputs:
  report.json, ffprobe.json, frames.csv, geometry-measurements.csv,
  geometry-deltas.csv, thresholds.csv, and frames/frame-XXXXXXXX.png.

Every decoded source frame is extracted with its original VFR timestamp; the recording
is never resampled to Simulator's nominal stream rate. Near-uniform detection uses
spatial variance, percentile range, and edges. Mean brightness is reported but never
used as a blank criterion, so a populated dark-theme frame is not blank merely for
being dark. report.json binds the exact video and NDJSON bytes with SHA-256 hashes.

Exit codes:
  0 = no evaluated threshold failed (status may be "incomplete" without NDJSON)
  1 = input/tool error or evaluated threshold failure
  2 = incomplete and --require-complete was supplied
`;

const FRAME_COLUMNS = [
  { key: "frameIndex" },
  { key: "file" },
  { key: "timestampMs" },
  { key: "sourceTimestampMs" },
  { key: "durationMs" },
  { key: "keyFrame" },
  { key: "pictureType" },
  { key: "width" },
  { key: "height" },
  { key: "fullNearUniform" },
  { key: "backgroundLandmarkPresent" },
  { key: "sheetPresent" },
  { key: "calibratedSheetExpected" },
  { key: "calibratedSheetEvaluated" },
  { key: "calibratedSheetPresent" },
  { key: "calibratedOverlayExpected" },
  { key: "calibratedOverlayEvaluated" },
  { key: "calibratedOverlayPresent" },
  { key: "visualCalibrationIntervalIndex" },
  { key: "visualSheetSegmentIndex" },
  { key: "visualOverlaySegmentIndex" },
  { key: "visualPhase" },
  { key: "visualKeyboardState" },
  { key: "visualKeyboardInset" },
  { key: "visualSheetTop" },
  { key: "visualDescriptionTop" },
  { key: "visualOverlayTop" },
  { key: "visualPointPerAnalysisPixel" },
  { key: "transitionTrackedTop" },
  { key: "transitionCandidateCount" },
  { key: "sheetBoundaryCoverage" },
  { key: "sheetBoundaryMeanColourDifference" },
  { key: "descriptionBoundaryCoverage" },
  { key: "descriptionBoundaryMeanColourDifference" },
  { key: "overlayBoundaryCoverage" },
  { key: "overlayBoundaryMeanColourDifference" },
  { key: "missingBothLandmarks" },
  { key: "beforeCommittedExit" },
  { key: "fullMeanLuma" },
  { key: "fullLumaStdDev" },
  { key: "fullRgbStdDev" },
  { key: "fullLumaRange" },
  { key: "fullEdgeRatio" },
  { key: "backgroundLumaStdDev" },
  { key: "backgroundLumaRange" },
  { key: "backgroundEdgeRatio" },
  { key: "sheetLumaStdDev" },
  { key: "sheetLumaRange" },
  { key: "sheetEdgeRatio" }
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  const invocationDirectory = process.env.INIT_CWD ? resolve(process.env.INIT_CWD) : process.cwd();
  const videoPath = resolve(invocationDirectory, options.video);
  const outputDirectory = resolve(invocationDirectory, options.output);
  const eventsPath = options.events ? resolve(invocationDirectory, options.events) : null;
  await requireFile(videoPath, "Video");
  if (eventsPath) await requireFile(eventsPath, "NDJSON telemetry");
  const videoInput = await hashFileInput(videoPath);
  const eventsBytes = eventsPath ? await readFile(eventsPath) : null;
  const eventsInput = eventsPath ? hashBufferInput(eventsPath, eventsBytes) : null;
  await prepareOutputDirectory(outputDirectory);

  const ffmpegVersion = commandVersion("ffmpeg");
  const ffprobeVersion = commandVersion("ffprobe");
  const sharpModule = await import("sharp");
  const sharp = sharpModule.default;
  const framesDirectory = join(outputDirectory, "frames");
  await mkdir(framesDirectory, { recursive: true });

  console.log(`Probing native video frames: ${videoPath}`);
  const streamProbe = runJsonCommand("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_streams",
    "-show_format",
    "-of", "json",
    videoPath
  ]);
  const frameProbe = runJsonCommand("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_frames",
    "-show_entries",
    "frame=best_effort_timestamp_time,pts_time,pkt_dts_time,pkt_duration_time,duration_time,key_frame,pict_type,width,height",
    "-of", "json",
    videoPath
  ]);
  const videoStream = streamProbe.streams?.find((stream) => stream.codec_type === "video") ?? streamProbe.streams?.[0];
  if (!videoStream) throw new Error("ffprobe found no video stream.");
  const probedFrames = frameProbe.frames ?? [];
  if (probedFrames.length === 0) throw new Error("ffprobe found no decoded video frames.");
  await writeJson(join(outputDirectory, "ffprobe.json"), {
    frames: probedFrames,
    format: streamProbe.format ?? null,
    streams: streamProbe.streams ?? []
  });

  console.log(`Extracting ${probedFrames.length} decoded source frames without cadence resampling.`);
  runCommand("ffmpeg", [
    "-v", "error",
    "-nostdin",
    "-n",
    "-i", videoPath,
    "-map", "0:v:0",
    "-fps_mode", "passthrough",
    "-enc_time_base", "demux",
    "-start_number", "0",
    join(framesDirectory, "frame-%08d.png")
  ]);

  const extractedFiles = (await readdir(framesDirectory))
    .filter((name) => /^frame-\d{8}\.png$/.test(name))
    .sort();
  if (extractedFiles.length === 0) throw new Error("ffmpeg did not extract any PNG frames.");

  const warnings = [];
  if (extractedFiles.length !== probedFrames.length) {
    warnings.push(
      `ffprobe reported ${probedFrames.length} decoded frames but ffmpeg extracted ${extractedFiles.length}.`
    );
  }

  const frameMetadata = createFrameMetadata(extractedFiles, probedFrames, videoStream);
  const frameTimestampsMs = frameMetadata.map((frame) => frame.timestampMs);
  let telemetry = null;
  let records = [];
  if (eventsPath) {
    records = parseNdjson(eventsBytes.toString("utf8"), eventsPath);
    telemetry = analyzeTelemetry(records, {
      committedExitMs: options.committedExitMs,
      eventTimeOriginMs: options.eventTimeOriginMs,
      frameTimestampsMs
    });
  } else if (Number.isFinite(options.committedExitMs)) {
    telemetry = analyzeTelemetry([], {
      committedExitMs: options.committedExitMs,
      frameTimestampsMs
    });
  }
  console.log(`Analyzing ${frameMetadata.length} frames at ${options.sampleWidth}px sample width.`);
  let analyzedFrameCount = 0;
  const frames = await mapConcurrent(
    frameMetadata,
    options.analysisConcurrency,
    async (frame) => {
      const image = await sharp(join(framesDirectory, frame.file))
        .rotate()
        .resize({ fit: "inside", width: options.sampleWidth, withoutEnlargement: true })
        .removeAlpha()
        .toColourspace("srgb")
        .raw()
        .toBuffer({ resolveWithObject: true });
      const full = analyzePixelRegion(
        image.data,
        image.info.width,
        image.info.height,
        image.info.channels,
        { x: 0, y: 0, width: 1, height: 1 },
        DEFAULT_VISUAL_THRESHOLDS
      );
      const background = analyzePixelRegion(
        image.data,
        image.info.width,
        image.info.height,
        image.info.channels,
        options.backgroundRoi,
        DEFAULT_VISUAL_THRESHOLDS
      );
      const sheet = analyzePixelRegion(
        image.data,
        image.info.width,
        image.info.height,
        image.info.channels,
        options.sheetRoi,
        DEFAULT_VISUAL_THRESHOLDS
      );
      const visualCalibration = visualCalibrationForFrame(frame, telemetry?.visualCalibration);
      const calibrated = visualCalibration
        ? analyzeCalibratedVisualFrame(
          image.data,
          image.info.width,
          image.info.height,
          image.info.channels,
          visualCalibration
        )
        : analyzeCalibratedVisualFrame(
          image.data,
          image.info.width,
          image.info.height,
          image.info.channels,
          null
        );
      analyzedFrameCount += 1;
      if (analyzedFrameCount % 100 === 0 || analyzedFrameCount === frameMetadata.length) {
        console.log(`Analyzed ${analyzedFrameCount}/${frameMetadata.length} frames.`);
      }
      return {
        ...frame,
        analysisHeight: image.info.height,
        analysisWidth: image.info.width,
        background,
        backgroundLandmarkPresent: background.landmarkPresent,
        ...calibrated,
        full,
        fullNearUniform: full.nearUniform,
        missingBothLandmarks: !background.landmarkPresent && !sheet.landmarkPresent,
        sheet,
        sheetPresent: sheet.landmarkPresent,
        visualCalibrationIntervalIndex: visualCalibration?.intervalIndex ?? null,
        visualOverlaySegmentIndex: visualCalibration?.overlaySegmentIndex ?? null,
        visualPresentationId: visualCalibration?.presentationId ?? null,
        visualPhase: visualCalibration?.visualPhase ?? null,
        visualKeyboardInset: visualCalibration?.keyboardLayout?.inset ?? null,
        visualKeyboardState: visualCalibration?.keyboardLayout?.stableState ?? null,
        visualRunId: visualCalibration?.runId ?? null,
        visualScreenHeight: visualCalibration?.screenAppRect?.height ?? null,
        visualSheetSegmentIndex: visualCalibration?.sheetSegmentIndex ?? null
      };
    }
  );
  applyTemporalVisualContinuity(frames);
  const currentSource = eventsPath ? computeCurrentSourceProvenance() : null;
  const evidenceProvenance = eventsPath
    ? analyzeEvidenceProvenance(records, { currentSource })
    : null;

  const committedExitTimeMs = telemetry?.committedExit?.timeMs;
  const presentationIntervals = telemetry?.presentationIntervals ?? [];
  for (const frame of frames) {
    frame.beforeCommittedExit = presentationIntervals.length > 0
      ? presentationIntervals.some((interval) => frameIsInPresentationInterval(frame, interval))
      : !Number.isFinite(committedExitTimeMs) || frame.timestampMs < committedExitTimeMs;
  }
  const thresholdTelemetry = eventsPath ? telemetry : null;
  const evaluation = evaluateThresholds({
    evidenceProvenance,
    frames,
    requireProvenance: options.requireComplete,
    telemetry: thresholdTelemetry ? {
      ...thresholdTelemetry,
      committedExit: telemetry?.committedExit ?? null
    } : telemetry?.committedExit ? {
      committedExit: telemetry.committedExit,
      counters: null,
      geometryDeltas: [],
      recordCount: 0
    } : null
  });

  if (!eventsPath && telemetry?.committedExit) {
    for (const threshold of evaluation.thresholds) {
      if (threshold.id === "stale_callback_count" || threshold.id === "duplicate_mutation_count") {
        threshold.evaluated = false;
        threshold.observed = null;
        threshold.passed = null;
      }
    }
    recalculateOverall(evaluation);
  }

  const nearUniformFrameIndexes = frames.filter((frame) => frame.fullNearUniform).map((frame) => frame.frameIndex);
  const adjacentVisualThreshold = evaluation.thresholds.find((threshold) =>
    threshold.id === "unexplained_adjacent_jump"
  );
  const missingBothFrameIndexes = frames
    .filter((frame) => frame.beforeCommittedExit && frame.missingBothLandmarks)
    .map((frame) => frame.frameIndex);
  const durationMs = finiteNumber(videoStream.duration) !== null
    ? Number(videoStream.duration) * 1000
    : frames.at(-1).timestampMs + (frames.at(-1).durationMs ?? 0);
  const report = {
    analysis: {
      backgroundRoi: options.backgroundRoi,
      brightnessPolicy: "Mean luminance is informational only and is never a blank/missing-content criterion.",
      sampleWidth: options.sampleWidth,
      sheetRoi: options.sheetRoi,
      visualThresholds: DEFAULT_VISUAL_THRESHOLDS
    },
    artifacts: {
      ffprobeJson: "ffprobe.json",
      frameDirectory: "frames",
      framesCsv: "frames.csv",
      geometryDeltasCsv: "geometry-deltas.csv",
      geometryMeasurementsCsv: "geometry-measurements.csv",
      thresholdsCsv: "thresholds.csv"
    },
    frames: frames.map(compactFrameReport),
    generatedAt: new Date().toISOString(),
    input: {
      events: eventsInput,
      outputDirectory,
      video: videoInput
    },
    overall: evaluation.overall,
    provenance: evidenceProvenance,
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    summary: {
      decodedFrameCount: probedFrames.length,
      durationMs,
      extractedFrameCount: extractedFiles.length,
      missingBothFrameCountBeforeCommittedExit: missingBothFrameIndexes.length,
      missingBothFrameIndexes,
      nearUniformFrameCount: nearUniformFrameIndexes.length,
      nearUniformFrameIndexes,
      visualEvaluatedFramePairCount: adjacentVisualThreshold?.details?.evaluatedFramePairCount ?? 0,
      visualExcludedFramePairCount: adjacentVisualThreshold?.details?.excludedFramePairCount ?? 0
    },
    telemetry: telemetry ? {
      committedExit: telemetry.committedExit,
      committedExits: telemetry.committedExits,
      counters: eventsPath ? telemetry.counters : null,
      coveredPresentationCount: telemetry.presentationIntervals.length,
      geometryDeltaCount: telemetry.geometryDeltas.length,
      geometryMeasurementCount: telemetry.measurements.length,
      presentationIntervals: telemetry.presentationIntervals,
      recordCount: eventsPath ? telemetry.recordCount : 0,
      timing: telemetry.timing,
      visualCalibration: telemetry.visualCalibration
    } : null,
    thresholds: evaluation.thresholds,
    tools: {
      ffmpeg: ffmpegVersion,
      ffprobe: ffprobeVersion,
      sharp: sharp.versions.sharp
    },
    video: {
      averageFrameRate: videoStream.avg_frame_rate ?? null,
      codec: videoStream.codec_name ?? null,
      durationMs,
      height: Number(videoStream.height),
      nativeRateDefinition: "all decoded source frames with original best-effort timestamps; no fps filter/resampling",
      nominalFrameRate: videoStream.r_frame_rate ?? null,
      timeBase: videoStream.time_base ?? null,
      variableFrameRate: hasVariableFrameTiming(frames),
      width: Number(videoStream.width)
    },
    warnings
  };

  const finalVideoInput = await hashFileInput(videoPath);
  if (finalVideoInput.sha256 !== videoInput.sha256 || finalVideoInput.byteLength !== videoInput.byteLength) {
    throw new Error("Video input changed while analysis was running; refusing an unbound report.");
  }
  if (eventsPath) {
    const finalEventsInput = await hashFileInput(eventsPath);
    if (finalEventsInput.sha256 !== eventsInput.sha256 || finalEventsInput.byteLength !== eventsInput.byteLength) {
      throw new Error("NDJSON input changed while analysis was running; refusing an unbound report.");
    }
    const finalAnalyzerSource = computeCurrentSourceProvenance();
    if (
      !finalAnalyzerSource ||
      finalAnalyzerSource.revision !== currentSource?.revision ||
      finalAnalyzerSource.fingerprint !== currentSource?.fingerprint ||
      finalAnalyzerSource.dirty !== currentSource?.dirty
    ) {
      throw new Error("Analyzer source changed while analysis was running; refusing an unbound report.");
    }
  }

  await writeJson(join(outputDirectory, "report.json"), report);
  await writeFile(join(outputDirectory, "frames.csv"), toCsv(
    frames.map(flattenFrameForCsv),
    FRAME_COLUMNS
  ));
  await writeFile(join(outputDirectory, "geometry-measurements.csv"), geometryMeasurementsCsv(telemetry?.measurements ?? []));
  await writeFile(join(outputDirectory, "geometry-deltas.csv"), geometryDeltasCsv(telemetry?.geometryDeltas ?? []));
  await writeFile(join(outputDirectory, "thresholds.csv"), thresholdsCsv(evaluation.thresholds));

  console.log(`Analysis status: ${evaluation.overall.status.toUpperCase()}`);
  for (const threshold of evaluation.thresholds) {
    const status = threshold.evaluated ? (threshold.passed ? "PASS" : "FAIL") : "NOT_EVALUATED";
    console.log(`${status} ${threshold.id}: observed=${threshold.observed ?? "n/a"} limit<=${threshold.limit}`);
  }
  console.log(`Machine-readable report: ${join(outputDirectory, "report.json")}`);

  if (evaluation.overall.status === "fail") process.exitCode = 1;
  else if (options.requireComplete && evaluation.overall.status === "incomplete") process.exitCode = 2;
}

function parseArgs(args) {
  const options = {
    analysisConcurrency: 4,
    backgroundRoi: DEFAULT_BACKGROUND_ROI,
    committedExitMs: null,
    eventTimeOriginMs: null,
    events: null,
    help: false,
    output: null,
    requireComplete: false,
    sampleWidth: 192,
    sheetRoi: DEFAULT_SHEET_ROI,
    video: null
  };
  const valueOptions = new Set([
    "--video",
    "--output",
    "--events",
    "--background-roi",
    "--sheet-roi",
    "--event-time-origin-ms",
    "--committed-exit-ms",
    "--sample-width",
    "--analysis-concurrency"
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--require-complete") {
      options.requireComplete = true;
      continue;
    }
    if (argument.startsWith("--")) {
      if (!valueOptions.has(argument)) throw new Error(`Unknown option: ${argument}`);
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === "--video") options.video = value;
      else if (argument === "--output") options.output = value;
      else if (argument === "--events") options.events = value;
      else if (argument === "--background-roi") options.backgroundRoi = parseNormalizedRoi(value, "Background ROI");
      else if (argument === "--sheet-roi") options.sheetRoi = parseNormalizedRoi(value, "Sheet ROI");
      else if (argument === "--event-time-origin-ms") options.eventTimeOriginMs = numericOption(value, argument);
      else if (argument === "--committed-exit-ms") options.committedExitMs = numericOption(value, argument, { minimum: 0 });
      else if (argument === "--sample-width") options.sampleWidth = integerOption(value, argument, { maximum: 1024, minimum: 32 });
      else if (argument === "--analysis-concurrency") options.analysisConcurrency = integerOption(value, argument, { maximum: 16, minimum: 1 });
      continue;
    }
    if (options.video) throw new Error(`Unexpected positional argument: ${argument}`);
    options.video = argument;
  }

  if (options.help) return options;
  if (!options.video) throw new Error(`A Simulator recording is required.\n\n${HELP}`);
  if (!options.output) throw new Error(`--output is required.\n\n${HELP}`);
  return options;
}

async function prepareOutputDirectory(outputDirectory) {
  const gitRoot = gitWorktreeRoot();
  if (gitRoot && isInsideDirectory(outputDirectory, gitRoot)) {
    if (outputDirectory === gitRoot) throw new Error("The output directory cannot be the Git worktree root.");
    const ignored = spawnSync("git", ["check-ignore", "--quiet", "--no-index", "--", outputDirectory], {
      cwd: gitRoot,
      encoding: "utf8"
    });
    if (ignored.status !== 0) {
      throw new Error(
        `Output directory is inside the worktree but is not ignored: ${outputDirectory}\n` +
        "Choose an ignored path such as .codex-dayframe-qa/mobile-sheet-redesign/<run>."
      );
    }
  }

  if (existsSync(outputDirectory)) {
    const outputStat = await stat(outputDirectory);
    if (!outputStat.isDirectory()) throw new Error(`Output path is not a directory: ${outputDirectory}`);
    const contents = await readdir(outputDirectory);
    if (contents.length > 0) {
      throw new Error(`Output directory must be new or empty; refusing to overwrite ${outputDirectory}.`);
    }
  } else {
    await mkdir(outputDirectory, { recursive: true });
  }
}

function gitWorktreeRoot() {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return result.status === 0 ? resolve(result.stdout.trim()) : null;
}

function computeCurrentSourceProvenance() {
  const repositoryDirectory = gitWorktreeRoot();
  if (!repositoryDirectory) return null;
  const runGit = (args) => spawnSync("git", args, {
    cwd: repositoryDirectory,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024
  });
  const revisionResult = runGit(["rev-parse", "HEAD"]);
  const statusResult = runGit(["status", "--porcelain=v1"]);
  const diffResult = runGit(["diff", "--binary", "HEAD"]);
  const untrackedResult = runGit(["ls-files", "--others", "--exclude-standard", "-z"]);
  if ([revisionResult, statusResult, diffResult, untrackedResult].some((result) => result.status !== 0)) {
    return null;
  }
  const revision = revisionResult.stdout.trim();
  const untrackedPaths = untrackedResult.stdout.split("\0").filter(Boolean).sort();
  const hash = createHash("sha256");
  hash.update(revision);
  hash.update("\0tracked-diff\0");
  hash.update(diffResult.stdout);
  for (const path of untrackedPaths) {
    hash.update("\0untracked-path\0");
    hash.update(path);
    hash.update("\0untracked-content\0");
    hash.update(readFileSync(resolve(repositoryDirectory, path)));
  }
  return {
    dirty: statusResult.stdout.trim().length > 0,
    fingerprint: hash.digest("hex"),
    revision
  };
}

async function hashFileInput(path) {
  const hash = createHash("sha256");
  let byteLength = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    byteLength += chunk.length;
  }
  return { byteLength, path, sha256: hash.digest("hex") };
}

function hashBufferInput(path, buffer) {
  return {
    byteLength: buffer.length,
    path,
    sha256: createHash("sha256").update(buffer).digest("hex")
  };
}

function isInsideDirectory(candidate, parent) {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === "" || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== "..");
}

async function requireFile(path, label) {
  await access(path);
  const value = await stat(path);
  if (!value.isFile()) throw new Error(`${label} path is not a file: ${path}`);
}

function commandVersion(command) {
  const result = spawnSync(command, ["-version"], { encoding: "utf8" });
  if (result.error?.code === "ENOENT") throw new Error(`${command} is required but was not found on PATH.`);
  if (result.status !== 0) throw new Error(`${command} -version failed: ${result.stderr.trim()}`);
  return result.stdout.split(/\r?\n/, 1)[0].trim();
}

function runJsonCommand(command, args) {
  const output = runCommand(command, args, { capture: true });
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`${command} returned invalid JSON: ${error.message}`);
  }
}

function runCommand(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: capture ? "utf8" : undefined,
    maxBuffer: 512 * 1024 * 1024,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
  });
  if (result.error?.code === "ENOENT") throw new Error(`${command} is required but was not found on PATH.`);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? result.stderr.trim() : `exit ${result.status}`;
    throw new Error(`${command} failed: ${detail}`);
  }
  return capture ? result.stdout : "";
}

function createFrameMetadata(files, probedFrames, videoStream) {
  const sourceTimestamps = files.map((_, index) => frameTimestampSeconds(probedFrames[index]));
  const firstTimestamp = sourceTimestamps.find((value) => value !== null) ?? 0;
  const streamDurationSeconds = finiteNumber(videoStream.duration);
  return files.map((file, frameIndex) => {
    const probe = probedFrames[frameIndex] ?? {};
    const sourceSeconds = sourceTimestamps[frameIndex];
    const nextSeconds = sourceTimestamps[frameIndex + 1];
    const explicitDuration = finiteNumber(probe.pkt_duration_time ?? probe.duration_time);
    const derivedDuration = sourceSeconds !== null && nextSeconds !== null
      ? Math.max(0, nextSeconds - sourceSeconds)
      : sourceSeconds !== null && streamDurationSeconds !== null
        ? Math.max(0, streamDurationSeconds - sourceSeconds)
        : null;
    const duration = explicitDuration ?? derivedDuration;
    return {
      durationMs: duration === null ? null : roundMetric(duration * 1000),
      file,
      frameIndex,
      height: Number(probe.height ?? videoStream.height),
      keyFrame: Number(probe.key_frame) === 1,
      pictureType: probe.pict_type ?? null,
      sourceTimestampMs: sourceSeconds === null ? null : roundMetric(sourceSeconds * 1000),
      timestampMs: sourceSeconds === null ? frameIndex : roundMetric((sourceSeconds - firstTimestamp) * 1000),
      width: Number(probe.width ?? videoStream.width)
    };
  });
}

function frameTimestampSeconds(frame) {
  return finiteNumber(
    frame?.best_effort_timestamp_time ??
    frame?.pts_time ??
    frame?.pkt_dts_time
  );
}

async function mapConcurrent(values, concurrency, callback) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await callback(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function compactFrameReport(frame) {
  return {
    background: compactRegion(frame.background),
    backgroundLandmarkPresent: frame.backgroundLandmarkPresent,
    beforeCommittedExit: frame.beforeCommittedExit,
    calibratedOverlayEvaluated: frame.calibratedOverlayEvaluated,
    calibratedOverlayExpected: frame.calibratedOverlayExpected,
    calibratedOverlayPresent: frame.calibratedOverlayPresent,
    calibratedSheetEvaluated: frame.calibratedSheetEvaluated,
    calibratedSheetExpected: frame.calibratedSheetExpected,
    calibratedSheetPresent: frame.calibratedSheetPresent,
    description: frame.description ? compactRegion(frame.description) : null,
    descriptionBoundary: compactBoundary(frame.descriptionBoundary),
    durationMs: frame.durationMs,
    file: join("frames", frame.file),
    frameIndex: frame.frameIndex,
    full: compactRegion(frame.full),
    fullNearUniform: frame.fullNearUniform,
    missingBothLandmarks: frame.missingBothLandmarks,
    overlayBoundary: compactBoundary(frame.overlayBoundary),
    sheet: compactRegion(frame.sheet),
    sheetBoundary: compactBoundary(frame.sheetBoundary),
    sheetPresent: frame.sheetPresent,
    sourceTimestampMs: frame.sourceTimestampMs,
    timestampMs: frame.timestampMs,
    visualCalibrationIntervalIndex: frame.visualCalibrationIntervalIndex,
    visualOverlaySegmentIndex: frame.visualOverlaySegmentIndex,
    visualPresentationId: frame.visualPresentationId,
    visualPhase: frame.visualPhase,
    visualAnchorTrack: frame.visualAnchorTrack,
    visualKeyboardInset: frame.visualKeyboardInset,
    visualKeyboardState: frame.visualKeyboardState,
    visualPointPerAnalysisPixel: frame.visualPointPerAnalysisPixel,
    visualRunId: frame.visualRunId,
    visualSheetSegmentIndex: frame.visualSheetSegmentIndex,
    transitionCandidateCount: frame.transitionCandidateCount ?? null,
    transitionDirection: frame.transitionDirection ?? null,
    transitionTrackedTop: frame.transitionTrackedTop ?? null
  };
}

function compactRegion(region) {
  return {
    bounds: region.bounds,
    edgeRatio: roundMetric(region.edgeRatio),
    landmarkPresent: region.landmarkPresent,
    lumaP05: region.lumaP05,
    lumaP95: region.lumaP95,
    lumaRange: roundMetric(region.lumaRange),
    lumaStdDev: roundMetric(region.lumaStdDev),
    meanLuma: roundMetric(region.meanLuma),
    nearUniform: region.nearUniform,
    rgbStdDev: roundMetric(region.rgbStdDev)
  };
}

function compactBoundary(boundary) {
  if (!boundary) return null;
  return {
    afterMeanRgb: boundary.afterMeanRgb?.map(roundMetric) ?? null,
    beforeMeanRgb: boundary.beforeMeanRgb?.map(roundMetric) ?? null,
    bounds: boundary.bounds ?? null,
    broadContrastCoverage: roundMetric(boundary.broadContrastCoverage),
    edge: boundary.edge,
    evaluated: boundary.evaluated,
    expectedY: boundary.expectedY ?? null,
    landmarkPresent: boundary.landmarkPresent,
    meanColourDifference: roundMetric(boundary.meanColourDifference),
    sampleY: boundary.sampleY,
    score: roundMetric(boundary.score)
  };
}

function flattenFrameForCsv(frame) {
  return {
    ...frame,
    backgroundEdgeRatio: roundMetric(frame.background.edgeRatio),
    backgroundLumaRange: roundMetric(frame.background.lumaRange),
    backgroundLumaStdDev: roundMetric(frame.background.lumaStdDev),
    descriptionBoundaryCoverage: roundMetric(frame.descriptionBoundary?.broadContrastCoverage),
    descriptionBoundaryMeanColourDifference: roundMetric(frame.descriptionBoundary?.meanColourDifference),
    fullEdgeRatio: roundMetric(frame.full.edgeRatio),
    fullLumaRange: roundMetric(frame.full.lumaRange),
    fullLumaStdDev: roundMetric(frame.full.lumaStdDev),
    fullMeanLuma: roundMetric(frame.full.meanLuma),
    fullRgbStdDev: roundMetric(frame.full.rgbStdDev),
    overlayBoundaryCoverage: roundMetric(frame.overlayBoundary?.broadContrastCoverage),
    overlayBoundaryMeanColourDifference: roundMetric(frame.overlayBoundary?.meanColourDifference),
    sheetEdgeRatio: roundMetric(frame.sheet.edgeRatio),
    sheetBoundaryCoverage: roundMetric(frame.sheetBoundary?.broadContrastCoverage),
    sheetBoundaryMeanColourDifference: roundMetric(frame.sheetBoundary?.meanColourDifference),
    transitionTrackedTop: roundMetric(frame.transitionTrackedTop),
    visualDescriptionTop: roundMetric(frame.visualAnchorTrack?.descriptionTop),
    visualOverlayTop: roundMetric(frame.visualAnchorTrack?.overlayTop),
    visualPointPerAnalysisPixel: roundMetric(frame.visualPointPerAnalysisPixel),
    visualSheetTop: roundMetric(frame.visualAnchorTrack?.sheetTop),
    sheetLumaRange: roundMetric(frame.sheet.lumaRange),
    sheetLumaStdDev: roundMetric(frame.sheet.lumaStdDev)
  };
}

function geometryMeasurementsCsv(measurements) {
  return toCsv(measurements, [
    { key: "sequence" },
    { key: "line" },
    { key: "videoTimeMs" },
    { key: "frameIndex" },
    { key: "runId" },
    { key: "presentationId" },
    { key: "rectName" },
    { key: "coordinateSpace" },
    { key: "phase" },
    { key: "settled" },
    { key: "eligibleForJumpCheck" },
    { header: "keyboardPhase", value: (row) => row.keyboardLayout.phase },
    { header: "keyboardState", value: (row) => row.keyboardLayout.stableState },
    { header: "keyboardInset", value: (row) => row.keyboardLayout.inset },
    { header: "overlayBottomBoundary", value: (row) => row.keyboardLayout.overlayBottomBoundary },
    ...["x", "y", "width", "height"].map((key) => ({ header: key, value: (row) => row.rect[key] })),
    ...["x", "y", "width", "height"].map((key) => ({ header: `keyboardCompensation_${key}`, value: (row) => row.keyboardCompensation[key] })),
    ...["x", "y", "width", "height"].map((key) => ({ header: `corrected_${key}`, value: (row) => row.correctedRect[key] }))
  ]);
}

function geometryDeltasCsv(deltas) {
  return toCsv(deltas, [
    { key: "runId" },
    { key: "presentationId" },
    { key: "rectName" },
    { key: "coordinateSpace" },
    { key: "previousLine" },
    { key: "currentLine" },
    { key: "previousTimeMs" },
    { key: "currentTimeMs" },
    { key: "previousFrameIndex" },
    { key: "currentFrameIndex" },
    { key: "phase" },
    { key: "settledPair" },
    { key: "equivalentLayout" },
    { key: "eligibleForJumpCheck" },
    ...["x", "y", "width", "height"].map((key) => ({ header: `rawDelta_${key}`, value: (row) => row.rawDelta[key] })),
    { key: "rawMaxDelta" },
    ...["x", "y", "width", "height"].map((key) => ({ header: `compensatedDelta_${key}`, value: (row) => row.compensatedDelta[key] })),
    { key: "compensatedMaxDelta" }
  ]);
}

function thresholdsCsv(thresholds) {
  return toCsv(thresholds, [
    { key: "id" },
    { key: "description" },
    { key: "evaluated" },
    { key: "passed" },
    { key: "operator" },
    { key: "limit" },
    { key: "observed" },
    { key: "unit" },
    { key: "sampleCount" },
    { key: "details" }
  ]);
}

function hasVariableFrameTiming(frames) {
  const durations = frames
    .slice(0, -1)
    .map((frame) => frame.durationMs)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (durations.length < 2) return false;
  return Math.max(...durations) - Math.min(...durations) > 0.25;
}

function recalculateOverall(evaluation) {
  const failed = evaluation.thresholds.filter((threshold) => threshold.evaluated && threshold.passed === false);
  const incomplete = evaluation.thresholds.filter((threshold) => !threshold.evaluated);
  evaluation.overall = {
    failedThresholdIds: failed.map((threshold) => threshold.id),
    incompleteThresholdIds: incomplete.map((threshold) => threshold.id),
    passed: failed.length === 0 && incomplete.length === 0,
    status: failed.length > 0 ? "fail" : incomplete.length > 0 ? "incomplete" : "pass"
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function numericOption(value, option, { minimum = Number.NEGATIVE_INFINITY } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) throw new Error(`${option} requires a number >= ${minimum}.`);
  return parsed;
}

function integerOption(value, option, { maximum, minimum }) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${option} requires an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMetric(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : null;
}

main().catch((error) => {
  console.error(`Sheet recording analysis failed: ${error.message}`);
  process.exitCode = 1;
});
