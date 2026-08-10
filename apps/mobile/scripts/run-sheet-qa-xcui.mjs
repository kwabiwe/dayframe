#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDedicatedMetroPortAvailable,
  probeMetroStatus,
  verifyBuildManifest,
  verifySourceProvenanceUnchanged
} from "./sheet-qa-runner-provenance.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const mobileDirectory = resolve(scriptDirectory, "..");
const repositoryDirectory = resolve(mobileDirectory, "../..");
const workspacePath = resolve(mobileDirectory, "ios/Dayframe.xcworkspace");
const scheme = "DayframeSheetQA";
const defaultUDID = "8D9C36E2-D7BA-43EE-89B0-2BE56CBD7459";
const validFlows = new Set([
  "smoke",
  "blank",
  "existing-blank",
  "existing",
  "completed",
  "add",
  "review",
  "journeys",
  "keyboard",
  "tags",
  "swipe",
  "gestures",
  "failures",
  "stress",
  "delete-undo",
  "delete-expiry",
  "delete-canonical",
  "delete-invalidation",
  "deletion",
  "all"
]);
const startedAtMs = Date.now();
let outputPath;
let capturedXCTestRecords = 0;
const capturedXCTestPayloads = [];
let metroProcess = null;
let originalReduceMotion = null;
let originalHardwareKeyboard = null;

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  process.stdout.write(helpText()
    .replace("gestures, stress", "gestures, failures, stress")
    .replace(
      "  --no-build                 Reuse an existing build-for-testing product\n",
      "  --allow-dirty              Permit a dirty tree for diagnostics; final evidence must omit this\n" +
        "  --no-build                 Reuse an existing build-for-testing product\n"
    )
    .replace("  --no-metro                 Do not start or wait for Metro\n", ""));
  process.exit(0);
}

validateOptions(options);
outputPath = resolve(process.cwd(), options.output);
const derivedDataPath = resolve(process.cwd(), options.derivedData);
const appBundlePath = join(derivedDataPath, "Build", "Products", "Debug-iphonesimulator", "Dayframe.app");
const buildManifestPath = join(derivedDataPath, ".dayframe-sheet-qa-build.json");
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, "");
const sourceProvenance = await computeSourceProvenance();

record("runner_started", {
  allowDirty: options.allowDirty,
  derivedData: derivedDataPath,
  flow: options.flow,
  iterations: options.iterations,
  metroPort: options.metroPort,
  noBuild: options.noBuild,
  noMetro: options.noMetro,
  output: outputPath,
  reduceMotion: options.reduceMotion,
  sourceDirty: sourceProvenance.dirty,
  sourceFingerprint: sourceProvenance.fingerprint,
  sourceRevision: sourceProvenance.revision,
  udid: options.udid
});

let exitCode = 0;
try {
  if (sourceProvenance.dirty && !options.allowDirty) {
    throw new Error(
      "Native evidence requires a clean source tree. Commit the intended source first, or use --allow-dirty only for diagnostic runs."
    );
  }
  originalHardwareKeyboard = await readHostDefault(
    "com.apple.iphonesimulator",
    "ConnectHardwareKeyboard"
  );
  await runChecked("defaults", [
    "write",
    "com.apple.iphonesimulator",
    "ConnectHardwareKeyboard",
    "-bool",
    "false"
  ]);
  // Simulator consumes this host preference during process/device startup.
  // Setting it after boot can leave a hardware keyboard attached: TextInput
  // focuses successfully while UIKit reports a zero-height software keyboard.
  await restartSimulatorForHardwareKeyboard(options.udid);
  originalReduceMotion = await readReduceMotion(options.udid);
  let xctestrunPath;
  if (!options.noBuild) {
    await runChecked("xcodebuild", [
      "-quiet",
      "-workspace", workspacePath,
      "-scheme", scheme,
      "-configuration", "Debug",
      "-destination", `platform=iOS Simulator,id=${options.udid}`,
      "-derivedDataPath", derivedDataPath,
      "build-for-testing",
      "CODE_SIGNING_ALLOWED=NO",
      "COMPILER_INDEX_STORE_ENABLE=NO",
      "ONLY_ACTIVE_ARCH=YES"
    ]);
    xctestrunPath = findXCTestRun(derivedDataPath);
    statSync(appBundlePath);
    const buildManifest = {
      appBundlePath,
      builtAtMs: Date.now(),
      schemaVersion: 1,
      scheme,
      sourceDirty: sourceProvenance.dirty,
      sourceFingerprint: sourceProvenance.fingerprint,
      sourceRevision: sourceProvenance.revision,
      workspacePath,
      xctestrunPath
    };
    writeFileSync(buildManifestPath, `${JSON.stringify(buildManifest, null, 2)}\n`);
    record("build_for_testing_finished", {
      appBundlePath,
      buildManifestPath,
      sourceFingerprint: sourceProvenance.fingerprint,
      success: true,
      xctestrunPath
    });
  } else {
    xctestrunPath = findXCTestRun(derivedDataPath);
    const buildManifest = JSON.parse(readFileSync(buildManifestPath, "utf8"));
    statSync(appBundlePath);
    verifyBuildManifest(buildManifest, {
      appBundlePath,
      scheme,
      sourceFingerprint: sourceProvenance.fingerprint,
      sourceRevision: sourceProvenance.revision,
      workspacePath,
      xctestrunPath
    });
    record("build_for_testing_reused", {
      appBundlePath,
      buildManifestPath,
      sourceFingerprint: sourceProvenance.fingerprint,
      verified: true,
      xctestrunPath
    });
  }
  record("xctestrun_ready", { path: xctestrunPath });

  if (!options.noMetro) {
    metroProcess = await ensureMetro(options.metroPort);
  } else {
    record("metro_skipped", { port: options.metroPort, verified: false });
  }

  const invocations = invocationPlan(options);
  for (let index = 0; index < invocations.length; index += 1) {
    const invocation = invocations[index];
    await setReduceMotion(options.udid, invocation.reduceMotion);
    const beforeCount = capturedXCTestRecords;
    const beforePayloadCount = capturedXCTestPayloads.length;
    const runID = `${Date.now()}-${index + 1}-${invocation.flow}-${invocation.reduceMotion ? "reduce" : "normal"}`;
    await patchXCTestRunEnvironment(xctestrunPath, {
      DAYFRAME_SHEET_QA_EXPECT_REDUCE_MOTION: invocation.reduceMotion ? "1" : "0",
      DAYFRAME_SHEET_QA_FLOW: invocation.flow,
      DAYFRAME_SHEET_QA_ITERATIONS: String(invocation.iterations),
      DAYFRAME_SHEET_QA_METRO_PORT: String(options.metroPort),
      DAYFRAME_SHEET_QA_RUN_ID: runID
    });
    record("invocation_started", {
      flow: invocation.flow,
      invocation: index + 1,
      iterations: invocation.iterations,
      reduceMotion: invocation.reduceMotion,
      runId: runID
    });
    const result = await runProcess("xcodebuild", [
      "test-without-building",
      "-xctestrun", xctestrunPath,
      "-destination", `platform=iOS Simulator,id=${options.udid}`,
      "-only-testing:DayframeSheetQATests/DayframeSheetQATests/testConfiguredFlow",
    ], { captureNDJSON: true });
    const emitted = capturedXCTestRecords - beforeCount;
    const invocationPayloads = capturedXCTestPayloads.slice(beforePayloadCount);
    const telemetryError = invocationTelemetryError(invocationPayloads, invocation, runID);
    record("invocation_finished", {
      emittedRecords: emitted,
      exitCode: result.code,
      flow: invocation.flow,
      invocation: index + 1,
      iterations: invocation.iterations,
      reduceMotion: invocation.reduceMotion,
      success: result.code === 0 && emitted > 0 && telemetryError === null,
      telemetryVerified: telemetryError === null
    });
    if (telemetryError) throw new Error(telemetryError);
    if (result.code !== 0) {
      throw new Error(`XCUITest invocation ${index + 1} (${invocation.flow}) exited ${result.code}.`);
    }
    if (emitted === 0) {
      throw new Error(`XCUITest invocation ${index + 1} (${invocation.flow}) emitted no prefixed NDJSON records.`);
    }
  }
  const finalSourceProvenance = await computeSourceProvenance();
  verifySourceProvenanceUnchanged(sourceProvenance, finalSourceProvenance);
  record("source_verification_finished", {
    matchesStart: true,
    sourceDirty: finalSourceProvenance.dirty,
    sourceFingerprint: finalSourceProvenance.fingerprint,
    sourceRevision: finalSourceProvenance.revision,
    success: true
  });
  record("runner_finished", {
    sourceDirty: finalSourceProvenance.dirty,
    sourceFingerprint: finalSourceProvenance.fingerprint,
    sourceRevision: finalSourceProvenance.revision,
    success: true,
    xcuiRecordCount: capturedXCTestRecords
  });
} catch (error) {
  exitCode = 1;
  record("runner_finished", {
    message: error instanceof Error ? error.message : String(error),
    success: false,
    xcuiRecordCount: capturedXCTestRecords
  });
} finally {
  if (metroProcess) {
    metroProcess.kill("SIGTERM");
  }
  if (originalReduceMotion !== null) {
    await setReduceMotion(options.udid, originalReduceMotion, { quiet: true });
  }
  await restoreHostDefault(
    "com.apple.iphonesimulator",
    "ConnectHardwareKeyboard",
    originalHardwareKeyboard
  );
  if (originalHardwareKeyboard !== null) {
    await restartSimulatorForHardwareKeyboard(options.udid, { quiet: true });
  }
}

process.stderr.write(`Dayframe sheet QA NDJSON: ${outputPath}\n`);
process.exit(exitCode);

function parseArguments(argumentsList) {
  const environment = process.env;
  const result = {
    allowDirty: false,
    derivedData: environment.DAYFRAME_SHEET_QA_DERIVED_DATA
      ?? "/tmp/dayframe-sheet-qa-derived",
    flow: environment.DAYFRAME_SHEET_QA_FLOW ?? "smoke",
    help: false,
    iterations: environment.DAYFRAME_SHEET_QA_ITERATIONS
      ? Number(environment.DAYFRAME_SHEET_QA_ITERATIONS)
      : null,
    metroPort: Number(environment.DAYFRAME_SHEET_QA_METRO_PORT ?? "8081"),
    noBuild: false,
    noMetro: false,
    output: environment.DAYFRAME_SHEET_QA_OUTPUT
      ?? `/tmp/dayframe-sheet-qa-${Date.now()}.ndjson`,
    reduceMotion: environment.DAYFRAME_SHEET_QA_REDUCE_MOTION ?? null,
    udid: environment.DAYFRAME_SHEET_QA_UDID ?? defaultUDID
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help" || argument === "-h") {
      result.help = true;
      continue;
    }
    if (argument === "--no-build") {
      result.noBuild = true;
      continue;
    }
    if (argument === "--allow-dirty") {
      result.allowDirty = true;
      continue;
    }
    if (argument === "--no-metro") {
      result.noMetro = true;
      continue;
    }
    const valueOptions = {
      "--derived-data": "derivedData",
      "--flow": "flow",
      "--iterations": "iterations",
      "--metro-port": "metroPort",
      "--output": "output",
      "--reduce-motion": "reduceMotion",
      "--udid": "udid"
    };
    const key = valueOptions[argument];
    if (!key) throw new Error(`Unknown argument: ${argument}`);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
    index += 1;
    result[key] = key === "iterations" || key === "metroPort" ? Number(value) : value;
  }

  if (result.reduceMotion === null) {
    result.reduceMotion = result.flow === "stress" || result.flow === "all" ? "both" : "off";
  }
  if (result.iterations === null) {
    result.iterations = defaultIterations(result.flow);
  }
  return result;
}

function validateOptions(value) {
  if (!validFlows.has(value.flow)) {
    throw new Error(`Unknown flow ${value.flow}. Use --help for the supported flows.`);
  }
  if (!["off", "on", "both"].includes(value.reduceMotion)) {
    throw new Error("--reduce-motion must be off, on, or both.");
  }
  if (!Number.isInteger(value.iterations) || value.iterations < 1 || value.iterations > 100) {
    throw new Error("--iterations must be an integer from 1 through 100.");
  }
  if (!Number.isInteger(value.metroPort) || value.metroPort < 1 || value.metroPort > 65_535) {
    throw new Error("--metro-port must be a valid TCP port.");
  }
  if (!value.udid.trim()) throw new Error("--udid cannot be empty.");
  if (value.noMetro) {
    throw new Error(
      "--no-metro is not supported for provenance-bound QA. Use an unused dedicated Metro port."
    );
  }
}

function defaultIterations(flow) {
  if (flow === "stress") return 30;
  if (flow === "deletion" || flow.startsWith("delete-")) return 10;
  if (flow === "all") return 30;
  return 1;
}

function invocationPlan(value) {
  const motions = value.reduceMotion === "both"
    ? [false, true]
    : [value.reduceMotion === "on"];
  if (value.flow !== "all") {
    return motions.map((reduceMotion) => ({
      flow: value.flow,
      iterations: value.iterations,
      reduceMotion
    }));
  }

  const repeatedIterations = value.iterations;
  const deletionIterations = value.iterations === 30 ? 10 : value.iterations;
  return motions.flatMap((reduceMotion) => [
    { flow: "journeys", iterations: 1, reduceMotion },
    { flow: "gestures", iterations: 1, reduceMotion },
    { flow: "failures", iterations: 1, reduceMotion },
    { flow: "stress", iterations: repeatedIterations, reduceMotion },
    { flow: "deletion", iterations: deletionIterations, reduceMotion }
  ]);
}

function findXCTestRun(derivedData) {
  const productsDirectory = join(derivedData, "Build", "Products");
  let candidates;
  try {
    candidates = readdirSync(productsDirectory)
      .filter((name) => name.startsWith(`${scheme}_`) && name.endsWith(".xctestrun"))
      .map((name) => {
        const path = join(productsDirectory, name);
        return { modifiedAt: statSync(path).mtimeMs, path };
      })
      .sort((left, right) => right.modifiedAt - left.modifiedAt);
  } catch (error) {
    throw new Error(
      `Could not inspect xctestrun products in ${productsDirectory}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (candidates.length === 0) {
    throw new Error(
      `No ${scheme} .xctestrun file exists in ${productsDirectory}; run without --no-build first.`
    );
  }
  return candidates[0].path;
}

async function patchXCTestRunEnvironment(xctestrunPath, environment) {
  for (const [key, value] of Object.entries(environment)) {
    const plistPath = `:DayframeSheetQATests:EnvironmentVariables:${key}`;
    const existing = await runProcess(
      "/usr/libexec/PlistBuddy",
      ["-c", `Print ${plistPath}`, xctestrunPath],
      { quiet: true }
    );
    const operation = existing.code === 0
      ? `Set ${plistPath} ${value}`
      : `Add ${plistPath} string ${value}`;
    await runChecked(
      "/usr/libexec/PlistBuddy",
      ["-c", operation, xctestrunPath],
      { quiet: true }
    );
    const verified = await runChecked(
      "/usr/libexec/PlistBuddy",
      ["-c", `Print ${plistPath}`, xctestrunPath],
      { quiet: true }
    );
    if (verified.stdout.trim() !== value) {
      throw new Error(`Failed to inject ${key} into ${xctestrunPath}.`);
    }
  }
  record("xctestrun_environment_injected", {
    expectedReduceMotion: environment.DAYFRAME_SHEET_QA_EXPECT_REDUCE_MOTION,
    flow: environment.DAYFRAME_SHEET_QA_FLOW,
    iterations: Number(environment.DAYFRAME_SHEET_QA_ITERATIONS),
    runId: environment.DAYFRAME_SHEET_QA_RUN_ID
  });
}

function invocationTelemetryError(payloads, invocation, runID) {
  const started = payloads.find((payload) => payload?.event === "test_started");
  if (!started) return `XCUITest ${invocation.flow} emitted no test_started telemetry.`;
  const mismatches = [];
  if (started.flow !== invocation.flow) {
    mismatches.push(`flow=${JSON.stringify(started.flow)} (expected ${JSON.stringify(invocation.flow)})`);
  }
  if (started.reduceMotion !== invocation.reduceMotion) {
    mismatches.push(`reduceMotion=${JSON.stringify(started.reduceMotion)} (expected ${invocation.reduceMotion})`);
  }
  if (started.runId !== runID) {
    mismatches.push(`runId=${JSON.stringify(started.runId)} (expected ${JSON.stringify(runID)})`);
  }
  if (started.details?.iterations !== invocation.iterations) {
    mismatches.push(
      `iterations=${JSON.stringify(started.details?.iterations)} (expected ${invocation.iterations})`
    );
  }
  return mismatches.length === 0
    ? null
    : `XCUITest invocation configuration mismatch: ${mismatches.join(", ")}.`;
}

async function ensureSimulatorBooted(udid) {
  const list = await runProcess("xcrun", ["simctl", "list", "devices", "--json"], { quiet: true });
  if (list.code !== 0) throw new Error("Could not list Simulator devices.");
  const parsed = JSON.parse(list.stdout);
  const device = Object.values(parsed.devices).flat().find((candidate) => candidate.udid === udid);
  if (!device) throw new Error(`Simulator ${udid} was not found.`);
  if (!device.isAvailable) throw new Error(`Simulator ${udid} is unavailable.`);
  if (device.state !== "Booted") {
    await runChecked("xcrun", ["simctl", "boot", udid]);
  }
  await runChecked("xcrun", ["simctl", "bootstatus", udid, "-b"]);
}

async function restartSimulatorForHardwareKeyboard(udid, { quiet = false } = {}) {
  await runAllowFailure("xcrun", ["simctl", "shutdown", udid], { quiet: true });
  await runAllowFailure("killall", ["Simulator"], { quiet: true });
  await ensureSimulatorBooted(udid);
  if (!quiet) record("simulator_restarted_for_keyboard_preference", { udid });
}

async function ensureMetro(port) {
  assertDedicatedMetroPortAvailable({ port, ready: await probeMetroStatus(port) });
  const child = spawn(
    "npm",
    ["run", "start", "--", "--port", String(port)],
    {
      cwd: mobileDirectory,
      env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  child.stdout.on("data", (chunk) => process.stderr.write(`[metro] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[metro] ${chunk}`));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Metro exited ${child.exitCode} before becoming ready.`);
    }
    if (await probeMetroStatus(port)) {
      record("metro_ready", {
        existing: false,
        ownedProcess: true,
        pid: child.pid ?? null,
        port,
        projectRoot: mobileDirectory
      });
      return child;
    }
    await delay(250);
  }
  child.kill("SIGTERM");
  throw new Error(`Metro did not become ready on port ${port} within 60 seconds.`);
}

async function computeSourceProvenance() {
  const [revisionResult, statusResult, diffResult, untrackedResult] = await Promise.all([
    runProcess("git", ["rev-parse", "HEAD"], { quiet: true }),
    runProcess("git", ["status", "--porcelain=v1"], { quiet: true }),
    runProcess("git", ["diff", "--binary", "HEAD"], { quiet: true }),
    runProcess("git", ["ls-files", "--others", "--exclude-standard", "-z"], { quiet: true })
  ]);
  if ([revisionResult, statusResult, diffResult, untrackedResult].some((result) => result.code !== 0)) {
    throw new Error("Could not compute the source provenance for native QA.");
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

async function readReduceMotion(udid) {
  const result = await runProcess("xcrun", [
    "simctl", "spawn", udid,
    "defaults", "read", "com.apple.Accessibility", "ReduceMotionEnabled"
  ], { quiet: true });
  if (result.code !== 0) return false;
  return ["1", "true", "yes"].includes(result.stdout.trim().toLowerCase());
}

async function setReduceMotion(udid, enabled, { quiet = false } = {}) {
  await ensureSimulatorBooted(udid);
  const current = await readReduceMotion(udid);
  if (current === enabled) return;
  await runChecked("xcrun", [
    "simctl", "spawn", udid,
    "defaults", "write", "com.apple.Accessibility", "ReduceMotionEnabled",
    "-bool", enabled ? "true" : "false"
  ], { quiet });
  await runAllowFailure("xcrun", ["simctl", "terminate", udid, "com.layereight.dayframe"], { quiet: true });
  await runAllowFailure("xcrun", ["simctl", "spawn", udid, "killall", "SpringBoard"], { quiet: true });
  await runChecked("xcrun", ["simctl", "bootstatus", udid, "-b"], { quiet });
  if (!quiet) record("reduce_motion_changed", { enabled });
}

async function readHostDefault(domain, key) {
  const result = await runProcess("defaults", ["read", domain, key], { quiet: true });
  return result.code === 0 ? { exists: true, value: result.stdout.trim() } : { exists: false };
}

async function restoreHostDefault(domain, key, original) {
  if (!original) return;
  if (!original.exists) {
    await runAllowFailure("defaults", ["delete", domain, key], { quiet: true });
    return;
  }
  if (["0", "1", "false", "true", "no", "yes"].includes(original.value.toLowerCase())) {
    const enabled = ["1", "true", "yes"].includes(original.value.toLowerCase());
    await runAllowFailure("defaults", ["write", domain, key, "-bool", enabled ? "true" : "false"], { quiet: true });
    return;
  }
  await runAllowFailure("defaults", ["write", domain, key, original.value], { quiet: true });
}

async function runChecked(command, argumentsList, options = {}) {
  const result = await runProcess(command, argumentsList, options);
  if (result.code !== 0) {
    throw new Error(`${command} ${argumentsList.join(" ")} exited ${result.code}.`);
  }
  return result;
}

async function runAllowFailure(command, argumentsList, options = {}) {
  return runProcess(command, argumentsList, options);
}

function runProcess(command, argumentsList, { captureNDJSON = false, quiet = false } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, argumentsList, {
      cwd: repositoryDirectory,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const lineBuffers = { stdout: "", stderr: "" };
    const consume = (name, chunk) => {
      const text = chunk.toString();
      if (name === "stdout") stdout += text;
      else stderr += text;
      if (!quiet) (name === "stdout" ? process.stdout : process.stderr).write(text);
      if (!captureNDJSON) return;
      lineBuffers[name] += text;
      const lines = lineBuffers[name].split(/\r?\n/);
      lineBuffers[name] = lines.pop() ?? "";
      for (const line of lines) captureNDJSONLine(line);
    };
    child.stdout.on("data", (chunk) => consume("stdout", chunk));
    child.stderr.on("data", (chunk) => consume("stderr", chunk));
    child.on("error", rejectPromise);
    child.on("close", (code, signal) => {
      if (captureNDJSON) {
        if (lineBuffers.stdout) captureNDJSONLine(lineBuffers.stdout);
        if (lineBuffers.stderr) captureNDJSONLine(lineBuffers.stderr);
      }
      resolvePromise({ code: code ?? (signal ? 1 : 0), signal, stderr, stdout });
    });
  });
}

function captureNDJSONLine(line) {
  const marker = "DAYFRAME_SHEET_QA_NDJSON:";
  const markerIndex = line.indexOf(marker);
  if (markerIndex < 0) return;
  const raw = line.slice(markerIndex + marker.length)
    .replace(/\u001b\[[0-9;]*m/g, "")
    .trim();
  try {
    const parsed = JSON.parse(raw);
    appendFileSync(outputPath, `${JSON.stringify(parsed)}\n`);
    capturedXCTestRecords += 1;
    capturedXCTestPayloads.push(parsed);
  } catch (error) {
    record("ndjson_parse_failed", {
      message: error instanceof Error ? error.message : String(error),
      raw
    });
  }
}

function record(event, details = {}) {
  const timestampMs = Date.now();
  const payload = {
    elapsedMs: timestampMs - startedAtMs,
    event,
    timestamp: new Date(timestampMs).toISOString(),
    timestampMs,
    ...details
  };
  if (outputPath) appendFileSync(outputPath, `${JSON.stringify(payload)}\n`);
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function helpText() {
  return `Dayframe native Simulator sheet QA\n\nUsage:\n  node apps/mobile/scripts/run-sheet-qa-xcui.mjs [options]\n\nOptions:\n  --udid <UDID>              Simulator UDID (env DAYFRAME_SHEET_QA_UDID; default ${defaultUDID})\n  --flow <flow>              smoke, blank, existing-blank, existing, completed, add, review,\n                             journeys, keyboard, swipe, gestures, stress, delete-undo,\n                             delete-expiry, delete-canonical, delete-invalidation, deletion, or all\n                             (env DAYFRAME_SHEET_QA_FLOW; default smoke)\n  --iterations <count>       Repeat count, 1-100 (env DAYFRAME_SHEET_QA_ITERATIONS). Defaults:\n                             stress=30, deletion/delete-*=10, all=30 stress + 10 deletion, others=1\n  --reduce-motion <mode>     off, on, or both (env DAYFRAME_SHEET_QA_REDUCE_MOTION).\n                             Defaults to both for stress/all and off otherwise.\n  --output <path>            Caller-selected NDJSON output (env DAYFRAME_SHEET_QA_OUTPUT;\n                             default /tmp/dayframe-sheet-qa-<timestamp>.ndjson)\n  --derived-data <path>      DerivedData path (env DAYFRAME_SHEET_QA_DERIVED_DATA;\n                             default /tmp/dayframe-sheet-qa-derived)\n  --metro-port <port>        Metro port (env DAYFRAME_SHEET_QA_METRO_PORT; default 8081)\n  --no-build                 Reuse an existing build-for-testing product\n  --no-metro                 Do not start or wait for Metro\n  -h, --help                 Show this help\n\nExamples:\n  node apps/mobile/scripts/run-sheet-qa-xcui.mjs --flow smoke --output /tmp/smoke.ndjson\n  node apps/mobile/scripts/run-sheet-qa-xcui.mjs --flow stress --iterations 30 --reduce-motion both --output /tmp/stress.ndjson\n  node apps/mobile/scripts/run-sheet-qa-xcui.mjs --flow deletion --iterations 10 --reduce-motion off --output /tmp/deletion.ndjson\n  node apps/mobile/scripts/run-sheet-qa-xcui.mjs --flow all --output /tmp/full-sheet-qa.ndjson\n\nThe runner boots the Simulator, starts Metro when needed, builds once, uses test-without-building\nfor each requested motion mode, polls the in-app JSON markers, and exits nonzero on any XCTest\ninvariant failure. It restores the prior Simulator Reduce Motion and host hardware-keyboard settings.\n`;
}
