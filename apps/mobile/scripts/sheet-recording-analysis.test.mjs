import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISUAL_THRESHOLDS,
  analyzeCalibratedVisualFrame,
  analyzeEvidenceProvenance,
  analyzePixelRegion,
  analyzeTelemetry,
  applyTemporalVisualContinuity,
  calculateFrameVisualDeltas,
  evaluateThresholds,
  parseNdjson,
  parseNormalizedRoi,
  screenRectToNormalizedRect,
  visualCalibrationForFrame
} from "./sheet-recording-analysis.mjs";

describe("sheet recording visual analysis", () => {
  it("flags a solid dark region as uniform without using darkness as the criterion", () => {
    const pixels = rgbImage(8, 8, () => [9, 12, 18]);
    const metrics = analyzePixelRegion(
      pixels,
      8,
      8,
      3,
      { x: 0, y: 0, width: 1, height: 1 },
      DEFAULT_VISUAL_THRESHOLDS
    );

    expect(metrics.meanLuma).toBeLessThan(20);
    expect(metrics.nearUniform).toBe(true);
    expect(metrics.landmarkPresent).toBe(false);
  });

  it("recognises populated dark-theme contrast as content", () => {
    const pixels = rgbImage(12, 12, (x, y) =>
      x === y || x + y === 11 ? [92, 96, 105] : [9, 12, 18]
    );
    const metrics = analyzePixelRegion(
      pixels,
      12,
      12,
      3,
      { x: 0, y: 0, width: 1, height: 1 },
      DEFAULT_VISUAL_THRESHOLDS
    );

    expect(metrics.meanLuma).toBeLessThan(35);
    expect(metrics.nearUniform).toBe(false);
    expect(metrics.landmarkPresent).toBe(true);
  });

  it("treats a spatially uniform saturated colour as uniform", () => {
    const metrics = analyzePixelRegion(
      rgbImage(5, 5, () => [180, 10, 10]),
      5,
      5,
      3,
      { x: 0, y: 0, width: 1, height: 1 },
      DEFAULT_VISUAL_THRESHOLDS
    );

    expect(metrics.rgbStdDev).toBe(0);
    expect(metrics.nearUniform).toBe(true);
  });
});

describe("sheet recording telemetry analysis", () => {
  it("calculates adjacent rect deltas after additive keyboard compensation", () => {
    const records = parseNdjson([
      JSON.stringify({
        elapsedMs: 0,
        presentationId: 7,
        settled: true,
        sheetRect: { x: 10, y: 500, width: 350, height: 600 }
      }),
      JSON.stringify({
        elapsedMs: 10,
        keyboardLift: 200,
        presentationId: 7,
        settled: true,
        sheetRect: { x: 10.5, y: 300, width: 350, height: 600 }
      }),
      JSON.stringify({
        elapsedMs: 20,
        keyboardLift: 200,
        presentationId: 7,
        settled: false,
        sheetRect: { x: 10.5, y: 303, width: 350, height: 600 }
      })
    ].join("\n"));
    const telemetry = analyzeTelemetry(records, { frameTimestampsMs: [0, 10, 20] });

    expect(telemetry.geometryDeltas).toHaveLength(2);
    expect(telemetry.geometryDeltas[0].rawDelta.y).toBe(200);
    expect(telemetry.geometryDeltas[0].compensatedDelta).toEqual({
      x: 0.5,
      y: 0,
      width: 0,
      height: 0
    });
    expect(telemetry.geometryDeltas[0].settledPair).toBe(true);
    expect(telemetry.geometryDeltas[1].compensatedMaxDelta).toBe(3);

    const evaluation = evaluateThresholds({
      frames: [populatedFrame(0, 0)],
      telemetry
    });
    expect(threshold(evaluation, "settled_geometry_delta").passed).toBe(true);
    expect(threshold(evaluation, "unexplained_adjacent_jump").passed).toBe(false);
  });

  it("keeps sheet-local keyboard-visible samples unadjusted and compares live sheet geometry", () => {
    const telemetry = analyzeTelemetry(parseNdjson([
      JSON.stringify({
        elapsedMs: 0,
        geometryCoordinateSpace: "sheet_local",
        keyboardInset: 335,
        keyboardPhase: "visible",
        overlayBottomBoundary: 418,
        presentationId: 7,
        settled: true,
        sheetRect: { x: 0, y: 0, width: 358, height: 418 }
      }),
      JSON.stringify({
        elapsedMs: 10,
        geometryCoordinateSpace: "sheet_local",
        keyboardInset: 335,
        keyboardPhase: "visible",
        overlayBottomBoundary: 418,
        presentationId: 7,
        settled: true,
        sheetRect: { x: 0.5, y: 0, width: 358, height: 418 }
      })
    ].join("\n")));

    expect(telemetry.measurements[0].keyboardCompensation).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0
    });
    expect(telemetry.geometryDeltas[0].equivalentLayout).toBe(true);
    expect(telemetry.geometryDeltas[0].compensatedMaxDelta).toBe(0.5);
    const evaluation = evaluateThresholds({ frames: [populatedFrame(0, 0)], telemetry });
    expect(threshold(evaluation, "settled_geometry_delta").passed).toBe(true);
  });

  it("excludes a legitimate sheet-local hidden-to-visible keyboard transition", () => {
    const telemetry = analyzeTelemetry(parseNdjson([
      JSON.stringify({
        elapsedMs: 0,
        geometryCoordinateSpace: "sheet_local",
        keyboardInset: 0,
        keyboardPhase: "hidden",
        overlayBottomBoundary: 487,
        presentationId: 7,
        settled: true,
        sheetRect: { x: 0, y: 0, width: 358, height: 487 }
      }),
      JSON.stringify({
        elapsedMs: 10,
        geometryCoordinateSpace: "sheet_local",
        keyboardInset: 335,
        keyboardPhase: "visible",
        overlayBottomBoundary: 418,
        presentationId: 7,
        settled: true,
        sheetRect: { x: 0, y: 0, width: 358, height: 418 }
      })
    ].join("\n")));

    expect(telemetry.geometryDeltas[0].equivalentLayout).toBe(false);
    expect(telemetry.geometryDeltas[0].settledPair).toBe(false);
    expect(telemetry.geometryDeltas[0].eligibleForJumpCheck).toBe(false);
    const evaluation = evaluateThresholds({ frames: [populatedFrame(0, 0)], telemetry });
    expect(threshold(evaluation, "settled_geometry_delta").evaluated).toBe(false);
    expect(threshold(evaluation, "unexplained_adjacent_jump").evaluated).toBe(false);
  });

  it("does not let immutable base geometry alone satisfy the live-sheet invariance gate", () => {
    const telemetry = analyzeTelemetry(parseNdjson([
      '{"elapsedMs":0,"presentationId":7,"settled":true,"baseSheetRect":{"x":0,"y":0,"width":358,"height":487}}',
      '{"elapsedMs":10,"presentationId":7,"settled":true,"baseSheetRect":{"x":0,"y":0,"width":358,"height":487}}'
    ].join("\n")));
    const evaluation = evaluateThresholds({ frames: [populatedFrame(0, 0)], telemetry });

    expect(threshold(evaluation, "settled_geometry_delta").evaluated).toBe(false);
    expect(evaluation.overall.status).toBe("incomplete");
  });

  it("excludes explicitly expected geometry transitions from the jump gate", () => {
    const telemetry = analyzeTelemetry(parseNdjson([
      JSON.stringify({
        elapsedMs: 0,
        eligibleForJumpCheck: true,
        presentationId: 1,
        sheetRect: { x: 0, y: 500, width: 320, height: 500 }
      }),
      JSON.stringify({
        elapsedMs: 10,
        expectedGeometryChange: true,
        presentationId: 1,
        sheetRect: { x: 0, y: 200, width: 320, height: 500 }
      })
    ].join("\n")));

    const evaluation = evaluateThresholds({ frames: [populatedFrame(0, 0)], telemetry });
    expect(threshold(evaluation, "unexplained_adjacent_jump").evaluated).toBe(false);
  });

  it("accepts direct accessibility-harness state snapshots as settled geometry", () => {
    const telemetry = analyzeTelemetry(parseNdjson([
      JSON.stringify({
        elapsedMs: 100,
        presentationId: 12,
        sheetPhase: "presented",
        keyboardPhase: "hidden",
        baseSheetRect: { x: 16, y: 180, width: 358, height: 620 },
        descriptionRect: { x: 32, y: 360, width: 326, height: 48 },
        staleCallbackCount: 0
      }),
      JSON.stringify({
        elapsedMs: 200,
        presentationId: 12,
        sheetPhase: "presented",
        keyboardPhase: "visible",
        keyboardInset: 280,
        baseSheetRect: { x: 16, y: -100, width: 358, height: 620 },
        descriptionRect: { x: 32, y: 80, width: 326, height: 48 },
        staleCallbackCount: 0
      })
    ].join("\n")));

    expect(telemetry.measurements).toHaveLength(4);
    expect(telemetry.measurements.every((measurement) => measurement.settled)).toBe(true);
    expect(telemetry.geometryDeltas.every((delta) => delta.compensatedMaxDelta === 0)).toBe(true);
  });

  it("normalises nested XCUITest state snapshots and guardrail counters", () => {
    const telemetry = analyzeTelemetry(parseNdjson(JSON.stringify({
      elapsedMs: 100,
      state: {
        presentationId: 12,
        sheetPhase: "presented",
        keyboardPhase: "visible",
        keyboardInset: 280,
        baseSheetRect: { x: 16, y: -100, width: 358, height: 620 },
        descriptionRect: { x: 32, y: 80, width: 326, height: 48 },
        staleCallbackCount: 2,
        duplicateMutationCount: 1,
        mutationAttemptCount: 3,
        mutationFinishedCount: 2,
        mutationRejectedCount: 1,
        mutationStartedCount: 2
      }
    })));

    expect(telemetry.measurements.map((measurement) => measurement.rectName)).toEqual([
      "baseSheetRect",
      "descriptionRect"
    ]);
    expect(telemetry.measurements.every((measurement) => measurement.settled)).toBe(true);
    expect(telemetry.counters.staleCallbackCount).toBe(2);
    expect(telemetry.counters.duplicateMutationCount).toBe(1);
    expect(telemetry.counters.duplicateMutationEvidencePresent).toBe(true);
  });

  it("counts explicit stale callbacks and overlapping/reused mutations", () => {
    const telemetry = analyzeTelemetry(parseNdjson([
      '{"elapsedMs":0,"type":"mutation_started","presentationId":4,"operationToken":1}',
      '{"elapsedMs":1,"type":"mutation_started","presentationId":4,"operationToken":2}',
      '{"elapsedMs":2,"type":"mutation_finished","presentationId":4,"operationToken":2}',
      '{"elapsedMs":3,"type":"presented_callback","staleCallback":true}',
      '{"elapsedMs":4,"type":"sheet_exit_committed","committedExit":true}'
    ].join("\n")));

    expect(telemetry.counters.duplicateMutationCount).toBe(1);
    expect(telemetry.counters.duplicateMutationLines).toEqual([2]);
    expect(telemetry.counters.staleCallbackCount).toBe(1);
    expect(telemetry.counters.staleCallbackLines).toEqual([4]);
    expect(telemetry.committedExit?.timeMs).toBe(4);

    const evaluation = evaluateThresholds({ frames: [populatedFrame(0, 0)], telemetry });
    expect(threshold(evaluation, "stale_callback_count").passed).toBe(false);
    expect(threshold(evaluation, "duplicate_mutation_count").passed).toBe(false);
  });

  it("marks missing cumulative guardrail evidence incomplete instead of assuming zero", () => {
    const telemetry = analyzeTelemetry(parseNdjson(JSON.stringify({
      elapsedMs: 0,
      event: "checkpoint",
      sheetPhase: "presented"
    })));
    const evaluation = evaluateThresholds({ frames: [populatedFrame(0, 0)], telemetry });

    expect(threshold(evaluation, "stale_callback_count")).toMatchObject({
      evaluated: false,
      observed: null,
      passed: null
    });
    expect(threshold(evaluation, "duplicate_mutation_count")).toMatchObject({
      evaluated: false,
      observed: null,
      passed: null
    });
    expect(evaluation.overall.status).toBe("incomplete");
  });

  it("requires production mutation lifecycle counters beside a declared duplicate zero", () => {
    const telemetry = analyzeTelemetry(parseNdjson(JSON.stringify({
      duplicateMutationCount: 0,
      elapsedMs: 0,
      staleCallbackCount: 0
    })));
    const evaluation = evaluateThresholds({ frames: [populatedFrame(0, 0)], telemetry });

    expect(threshold(evaluation, "stale_callback_count").passed).toBe(true);
    expect(threshold(evaluation, "duplicate_mutation_count").evaluated).toBe(false);
    expect(evaluation.overall.status).toBe("incomplete");
  });

  it("fails on a nonzero cumulative duplicate count even after later zero-looking records", () => {
    const telemetry = analyzeTelemetry(parseNdjson([
      JSON.stringify({
        duplicateMutationCount: 2,
        mutationAttemptCount: 4,
        mutationFinishedCount: 2,
        mutationRejectedCount: 2,
        mutationStartedCount: 2,
        staleCallbackCount: 0
      }),
      JSON.stringify({
        duplicateMutationCount: 0,
        mutationAttemptCount: 0,
        mutationFinishedCount: 0,
        mutationRejectedCount: 0,
        mutationStartedCount: 0,
        staleCallbackCount: 0
      })
    ].join("\n")));
    const evaluation = evaluateThresholds({ frames: [populatedFrame(0, 0)], telemetry });

    expect(telemetry.counters.duplicateMutationCount).toBe(2);
    expect(threshold(evaluation, "duplicate_mutation_count").passed).toBe(false);
    expect(evaluation.overall.status).toBe("fail");
  });

  it("checks missing landmarks only before the explicit finished exit", () => {
    const telemetry = analyzeTelemetry(parseNdjson([
      '{"elapsedMs":0,"event":"sheet_open_started","openStarted":true,"presentationId":1}',
      '{"elapsedMs":0,"presentationId":1,"settled":true,"screenSheetRect":{"x":0,"y":20,"width":40,"height":60}}',
      '{"elapsedMs":5,"type":"sheet_exit_finished","exitFinished":true,"committedExit":true}'
    ].join("\n")));
    const evaluation = evaluateThresholds({
      frames: [
        { ...populatedFrame(0, 2), ...calibratedSheetFrame(0) },
        missingFrame(1, 10)
      ],
      telemetry
    });

    const continuity = threshold(evaluation, "pre_exit_content_continuity");
    expect(continuity.evaluated).toBe(true);
    expect(continuity.passed).toBe(true);
    expect(continuity.details.preExitFrameCount).toBe(1);
  });

  it("keeps a commit-only lifecycle incomplete until its matching physical exit finishes", () => {
    const lifecycleRecords = [
      '{"videoTimeMs":0,"event":"sheet_open_started","openStarted":true,"runId":"commit-before-finish","presentationId":4}',
      '{"videoTimeMs":10,"event":"checkpoint","runId":"commit-before-finish","presentationId":4,"settled":true,"screenAppRect":{"x":0,"y":0,"width":40,"height":80},"screenSheetRect":{"x":0,"y":20,"width":40,"height":60},"screenDescriptionRect":{"x":4,"y":34,"width":32,"height":8},"staleCallbackCount":0,"duplicateMutationCount":0,"mutationAttemptCount":0,"mutationStartedCount":0,"mutationRejectedCount":0,"mutationFinishedCount":0}',
      '{"videoTimeMs":20,"event":"sheet_exit_started","exitStarted":true,"runId":"commit-before-finish","presentationId":4,"state":{"screenAppRect":{"x":0,"y":0,"width":40,"height":80},"screenSheetRect":{"x":0,"y":20,"width":40,"height":60},"screenDescriptionRect":{"x":4,"y":34,"width":32,"height":8}}}',
      '{"videoTimeMs":30,"event":"sheet_exit_committed","committedExit":true,"runId":"commit-before-finish","presentationId":4}'
    ];
    const lifecycleFrames = (telemetry, timestamps) => timestamps.map((timestampMs, frameIndex) => {
      const calibration = visualCalibrationForFrame({ timestampMs }, telemetry.visualCalibration);
      const transitionTop = calibration?.visualPhase === "entrance"
        ? 40
        : calibration?.visualPhase === "exit"
          ? timestampMs
          : 20;
      return {
        ...populatedFrame(frameIndex, timestampMs),
        ...calibratedSheetFrame(
          calibration?.intervalIndex ?? 0,
          true,
          calibration?.sheetSegmentIndex ?? 0
        ),
        transitionTrackedTop: transitionTop / 80,
        visualPhase: calibration?.visualPhase ?? null,
        visualScreenHeight: 80
      };
    });

    const commitOnly = analyzeTelemetry(parseNdjson(lifecycleRecords.join("\n")));
    const commitOnlyContinuity = threshold(evaluateThresholds({
      frames: lifecycleFrames(commitOnly, [5, 15, 25]),
      telemetry: commitOnly
    }), "pre_exit_content_continuity");

    expect(commitOnly.committedExits).toMatchObject([{
      committedTimeMs: 30,
      exitFinished: false,
      timeMs: 30
    }]);
    expect(commitOnlyContinuity).toMatchObject({ evaluated: false, observed: null, passed: null });
    expect(commitOnlyContinuity.details).toMatchObject({
      committedExitCount: 1,
      finishedExitCount: 0,
      missingDecodedSheetSegmentIndexes: [],
      missingEvaluatedSheetSegmentIndexes: [],
      preExitFrameCount: 3
    });
    expect(commitOnlyContinuity.details.unfinishedCommittedExits).toHaveLength(1);

    const finished = analyzeTelemetry(parseNdjson([
      ...lifecycleRecords,
      // The exact lifecycle event is sufficient even if the redundant boolean
      // is unavailable in an older reporter payload.
      '{"videoTimeMs":50,"event":"sheet_exit_finished","runId":"commit-before-finish","presentationId":4}'
    ].join("\n")));
    const finishedContinuity = threshold(evaluateThresholds({
      frames: lifecycleFrames(finished, [5, 15, 25, 35, 45]),
      telemetry: finished
    }), "pre_exit_content_continuity");

    expect(finished.committedExits).toMatchObject([{
      committedTimeMs: 30,
      exitFinished: true,
      timeMs: 50
    }]);
    expect(finished.presentationIntervals).toMatchObject([{
      committedTimeMs: 30,
      endSource: "exit_finished",
      endTimeMs: 50,
      exitFinished: true,
      startTimeMs: 0
    }]);
    expect(finishedContinuity).toMatchObject({ evaluated: true, observed: 0, passed: true });
    expect(finishedContinuity.details).toMatchObject({
      committedExitCount: 1,
      finishedExitCount: 1,
      preExitFrameCount: 5
    });
    expect(finishedContinuity.details.sheetSegmentCoverage.at(-1)).toMatchObject({
      decodedFrameCount: 3,
      evaluatedFrameCount: 3,
      phase: "exit"
    });
  });

  it("segments every run and catches a late missing frame without cross-run geometry or mutation pairs", () => {
    const telemetry = analyzeTelemetry(parseNdjson([
      '{"videoTimeMs":0,"event":"sheet_open_started","openStarted":true,"runId":"run-a"}',
      '{"videoTimeMs":5,"runId":"run-a","presentationId":1,"settled":true,"sheetRect":{"x":0,"y":0,"width":320,"height":500},"staleCallbackCount":0,"duplicateMutationCount":0,"mutationAttemptCount":0,"mutationStartedCount":0,"mutationRejectedCount":0,"mutationFinishedCount":0}',
      '{"videoTimeMs":5,"runId":"run-a","presentationId":1,"settled":true,"screenSheetRect":{"x":0,"y":20,"width":40,"height":60}}',
      '{"videoTimeMs":6,"event":"mutation_started","runId":"run-a","presentationId":1,"operationToken":1}',
      '{"videoTimeMs":7,"event":"mutation_finished","runId":"run-a","presentationId":1,"operationToken":1}',
      '{"videoTimeMs":20,"event":"checkpoint","runId":"run-a","presentationId":1,"settled":true,"sheetRect":{"x":0.5,"y":0,"width":320,"height":500}}',
      '{"videoTimeMs":30,"event":"sheet_exit_finished","exitFinished":true,"committedExit":true,"iteration":1,"runId":"run-a","details":{"presentationId":1}}',
      '{"videoTimeMs":40,"event":"sheet_open_started","openStarted":true,"runId":"run-b"}',
      '{"videoTimeMs":45,"runId":"run-b","presentationId":1,"settled":true,"sheetRect":{"x":80,"y":90,"width":350,"height":420},"staleCallbackCount":0,"duplicateMutationCount":0,"mutationAttemptCount":0,"mutationStartedCount":0,"mutationRejectedCount":0,"mutationFinishedCount":0}',
      '{"videoTimeMs":45,"runId":"run-b","presentationId":1,"settled":true,"screenSheetRect":{"x":0,"y":25,"width":40,"height":55}}',
      '{"videoTimeMs":46,"event":"mutation_started","runId":"run-b","presentationId":1,"operationToken":1}',
      '{"videoTimeMs":47,"event":"mutation_finished","runId":"run-b","presentationId":1,"operationToken":1}',
      '{"videoTimeMs":60,"event":"checkpoint","runId":"run-b","presentationId":1,"settled":true,"sheetRect":{"x":80.5,"y":90,"width":350,"height":420}}',
      '{"videoTimeMs":80,"event":"sheet_exit_finished","exitFinished":true,"committedExit":true,"iteration":2,"runId":"run-b","details":{"presentationId":1}}'
    ].join("\n")));

    expect(telemetry.committedExits).toHaveLength(2);
    expect(telemetry.presentationIntervals).toMatchObject([
      { endTimeMs: 30, iteration: 1, presentationId: 1, runId: "run-a", startTimeMs: 0 },
      { endTimeMs: 80, iteration: 2, presentationId: 1, runId: "run-b", startTimeMs: 40 }
    ]);
    expect(telemetry.geometryDeltas).toHaveLength(2);
    expect(telemetry.geometryDeltas.map((delta) => delta.runId)).toEqual(["run-a", "run-b"]);
    expect(telemetry.geometryDeltas.every((delta) => delta.compensatedMaxDelta === 0.5)).toBe(true);
    expect(telemetry.counters.duplicateMutationCount).toBe(0);

    const evaluation = evaluateThresholds({
      frames: [
        { ...populatedFrame(0, 2), ...calibratedSheetFrame(0, true, 0) },
        { ...populatedFrame(1, 10), ...calibratedSheetFrame(0, true, 1) },
        populatedFrame(2, 35),
        { ...populatedFrame(3, 42), ...calibratedSheetFrame(1, true, 2) },
        { ...populatedFrame(4, 50), ...calibratedSheetFrame(1, true, 3) },
        { ...missingFrame(5, 70), ...calibratedSheetFrame(1, false, 3) },
        populatedFrame(6, 90)
      ],
      telemetry
    });
    const continuity = threshold(evaluation, "pre_exit_content_continuity");
    expect(continuity.passed).toBe(false);
    expect(continuity.observed).toBe(1);
    expect(continuity.details).toMatchObject({
      committedExitCount: 2,
      coveredPresentationCount: 2,
      missingFrameIndexes: [5],
      preExitFrameCount: 5
    });
  });

  it("uses an explicit recording epoch instead of a nested runner elapsed clock", () => {
    const recordingOriginMs = 1_786_132_600_000;
    const telemetry = analyzeTelemetry(parseNdjson([
      JSON.stringify({
        elapsedMs: 25,
        timestampMs: recordingOriginMs + 750,
        presentationId: 9,
        settled: true,
        sheetRect: { x: 0, y: 100, width: 320, height: 500 }
      }),
      JSON.stringify({
        elapsedMs: 50,
        timestampMs: recordingOriginMs + 900,
        committedExit: true,
        event: "sheet_exit_committed"
      })
    ].join("\n")), {
      eventTimeOriginMs: recordingOriginMs,
      frameTimestampsMs: [0, 750, 900]
    });

    expect(telemetry.measurements[0]?.videoTimeMs).toBe(750);
    expect(telemetry.committedExit?.timeMs).toBe(900);
    expect(telemetry.timing.originSource).toBe("cli");
  });

  it("keeps continuity incomplete when telemetry never calibrates a native sheet landmark", () => {
    const telemetry = analyzeTelemetry(parseNdjson([
      '{"videoTimeMs":0,"event":"sheet_open_started","openStarted":true,"runId":"missing-calibration","presentationId":1}',
      '{"videoTimeMs":1,"runId":"missing-calibration","presentationId":1,"settled":true,"sheetRect":{"x":0,"y":0,"width":320,"height":500}}',
      '{"videoTimeMs":20,"event":"sheet_exit_finished","exitFinished":true,"committedExit":true,"runId":"missing-calibration","presentationId":1}'
    ].join("\n")));
    const evaluation = evaluateThresholds({ frames: [populatedFrame(0, 10)], telemetry });
    const continuity = threshold(evaluation, "pre_exit_content_continuity");

    expect(continuity).toMatchObject({ evaluated: false, observed: null, passed: null });
    expect(continuity.details.missingTelemetryCalibrationPresentationIndexes).toEqual([0]);
    expect(evaluation.overall.status).toBe("incomplete");
  });

  it("isolates visual calibration segments when the same run and presentation IDs are reused", () => {
    const telemetry = analyzeTelemetry(parseNdjson([
      '{"videoTimeMs":0,"event":"sheet_open_started","openStarted":true,"runId":"reused"}',
      '{"videoTimeMs":5,"runId":"reused","presentationId":1,"settled":true,"screenSheetRect":{"x":0,"y":10,"width":40,"height":70}}',
      '{"videoTimeMs":20,"runId":"reused","presentationId":1,"expectedTransition":true}',
      '{"videoTimeMs":30,"event":"sheet_exit_finished","exitFinished":true,"committedExit":true,"runId":"reused","presentationId":1}',
      '{"videoTimeMs":40,"event":"sheet_open_started","openStarted":true,"runId":"reused"}',
      '{"videoTimeMs":45,"runId":"reused","state":{"presentationId":1,"sheetPhase":"presented","keyboardPhase":"hidden","screenAppRect":{"x":0,"y":0,"width":40,"height":80},"screenSheetRect":{"x":0,"y":25,"width":40,"height":55}}}',
      '{"videoTimeMs":60,"runId":"reused","presentationId":1,"expectedTransition":true}',
      '{"videoTimeMs":70,"event":"sheet_exit_finished","exitFinished":true,"committedExit":true,"runId":"reused","presentationId":1}'
    ].join("\n")));

    expect(telemetry.visualCalibration.sheetSegments).toMatchObject([
      { endTimeMs: 5, intervalIndex: 0, phase: "entrance", runId: "reused", startTimeMs: 0 },
      { endTimeMs: 20, intervalIndex: 0, phase: "stable", runId: "reused", startTimeMs: 5 },
      { endTimeMs: 45, intervalIndex: 1, phase: "entrance", runId: "reused", startTimeMs: 40 },
      { endTimeMs: 60, intervalIndex: 1, phase: "stable", runId: "reused", startTimeMs: 45 }
    ]);
    expect(visualCalibrationForFrame({ timestampMs: 10 }, telemetry.visualCalibration)).toMatchObject({
      intervalIndex: 0,
      sheetRect: { y: 10 }
    });
    expect(visualCalibrationForFrame({ timestampMs: 25 }, telemetry.visualCalibration)).toBeNull();
    expect(visualCalibrationForFrame({ timestampMs: 50 }, telemetry.visualCalibration)).toMatchObject({
      intervalIndex: 1,
      screenAppRect: { height: 80, width: 40 },
      sheetRect: { y: 25 }
    });
  });

  it("updates query-result overlay geometry within one presentation and terminates only at its exit marker", () => {
    const telemetry = analyzeTelemetry(parseNdjson([
      '{"videoTimeMs":0,"event":"sheet_open_started","openStarted":true,"runId":"query"}',
      '{"videoTimeMs":5,"runId":"query","presentationId":4,"settled":true,"screenAppRect":{"x":0,"y":0,"width":40,"height":80},"screenSheetRect":{"x":0,"y":10,"width":40,"height":70},"screenDescriptionRect":{"x":4,"y":25,"width":32,"height":8},"screenOverlayRect":{"x":4,"y":35,"width":32,"height":30}}',
      '{"videoTimeMs":15,"runId":"query","presentationId":4,"settled":true,"screenAppRect":{"x":0,"y":0,"width":40,"height":80},"screenSheetRect":{"x":0,"y":10,"width":40,"height":70},"screenDescriptionRect":{"x":4,"y":25,"width":32,"height":8},"screenOverlayRect":{"x":4,"y":35,"width":32,"height":10}}',
      '{"videoTimeMs":25,"runId":"query","presentationId":4,"expectedOverlayExit":true}',
      '{"videoTimeMs":30,"event":"sheet_exit_finished","exitFinished":true,"committedExit":true,"runId":"query","presentationId":4}'
    ].join("\n")));

    expect(telemetry.visualCalibration.overlaySegments).toMatchObject([
      { endTimeMs: 15, overlayRect: { height: 30, y: 35 }, startTimeMs: 5 },
      { endReason: "expected_overlay_exit", endTimeMs: 25, overlayRect: { height: 10, y: 35 }, startTimeMs: 15 }
    ]);
    expect(visualCalibrationForFrame({ timestampMs: 10 }, telemetry.visualCalibration)?.overlayRect.height).toBe(30);
    expect(visualCalibrationForFrame({ timestampMs: 20 }, telemetry.visualCalibration)?.overlayRect.height).toBe(10);
    expect(visualCalibrationForFrame({ timestampMs: 27 }, telemetry.visualCalibration)?.overlayRect).toBeNull();
  });

  it("tracks a generic expected keyboard/layout update through the next stable calibration", () => {
    const stable = '"runId":"keyboard","presentationId":3,"settled":true,"screenAppRect":{"x":0,"y":0,"width":40,"height":80},"screenSheetRect":{"x":0,"y":10,"width":40,"height":70},"screenDescriptionRect":{"x":4,"y":25,"width":32,"height":8}';
    const telemetry = analyzeTelemetry(parseNdjson([
      '{"videoTimeMs":0,"event":"sheet_open_started","openStarted":true,"runId":"keyboard"}',
      `{"videoTimeMs":5,${stable},"keyboardPhase":"visible"}`,
      '{"videoTimeMs":10,"event":"expected_transition_started","expectedTransition":true,"runId":"keyboard","presentationId":3,"step":"keyboard_drag_start"}',
      `{"videoTimeMs":15,${stable},"keyboardPhase":"hidden"}`,
      '{"videoTimeMs":20,"event":"sheet_exit_finished","exitFinished":true,"committedExit":true,"runId":"keyboard","presentationId":3}'
    ].join("\n")));

    expect(telemetry.visualCalibration.sheetSegments.map((segment) => segment.phase))
      .toEqual(["entrance", "stable", "expected_update", "stable"]);
    expect(visualCalibrationForFrame({ timestampMs: 12 }, telemetry.visualCalibration)).toMatchObject({
      visualPhase: "expected_update"
    });
  });
});

describe("telemetry-calibrated native frame continuity", () => {
  it.each([
    { displacement: 1.9, passed: true },
    { displacement: 2.1, passed: false },
    { displacement: 3.5, passed: false }
  ])("enforces the raw two-screen-point limit at $displacement points", ({ displacement, passed }) => {
    const frames = [
      trackedFrame(0, 10, { descriptionTop: 34, overlayTop: 44, sheetTop: 20 }),
      trackedFrame(1, 11, {
        descriptionTop: 34 + displacement,
        overlayTop: 44 + displacement,
        sheetTop: 20 + displacement
      })
    ];
    const delta = calculateFrameVisualDeltas(frames)[0];
    const adjacent = threshold(
      evaluateThresholds({ frames, telemetry: calibratedTelemetry() }),
      "unexplained_adjacent_jump"
    );

    expect(delta.quantizationAllowance).toBe(0);
    expect(delta.maximumAnchorDelta).toBeCloseTo(displacement, 8);
    expect(adjacent.observed).toBeCloseTo(displacement, 8);
    expect(adjacent.passed).toBe(passed);
  });

  it("passes smooth whole-sheet keyboard motion while evaluating relative internal anchors", () => {
    const frames = [
      trackedFrame(
        0,
        10,
        { descriptionTop: 34, overlayTop: 44, sheetTop: 20 },
        { keyboard: "visible", keyboardInset: 300 }
      ),
      trackedFrame(
        1,
        11,
        { descriptionTop: 44, overlayTop: 54, sheetTop: 30 },
        { keyboard: "dismissing", keyboardInset: 290, phase: "expected_update" }
      ),
      trackedFrame(
        2,
        12,
        { descriptionTop: 54, overlayTop: 64, sheetTop: 40 },
        { keyboard: "hidden", keyboardInset: 280 }
      )
    ];
    const deltas = calculateFrameVisualDeltas(frames);
    const adjacent = threshold(
      evaluateThresholds({ frames, telemetry: calibratedTelemetry() }),
      "unexplained_adjacent_jump"
    );

    expect(deltas).toHaveLength(2);
    expect(deltas.every((delta) => delta.comparisonMode === "relative_internal_anchors")).toBe(true);
    expect(deltas.map((delta) => delta.relativeAnchorDeltas)).toEqual([
      { descriptionFromSheet: 0, overlayFromDescription: 0 },
      { descriptionFromSheet: 0, overlayFromDescription: 0 }
    ]);
    expect(deltas.map((delta) => delta.sheetDisplacementAfterRecordedKeyboardDelta)).toEqual([0, 0]);
    expect(adjacent).toMatchObject({ evaluated: true, observed: 0, passed: true, sampleCount: 2 });
  });

  it("fails a large Description-relative jump during an expected keyboard update", () => {
    const frames = [
      trackedFrame(
        0,
        10,
        { descriptionTop: 34, overlayTop: 44, sheetTop: 20 },
        { keyboard: "visible", keyboardInset: 300 }
      ),
      trackedFrame(
        1,
        11,
        { descriptionTop: 50, overlayTop: 60, sheetTop: 30 },
        { keyboard: "dismissing", keyboardInset: 290, phase: "expected_update" }
      ),
      trackedFrame(
        2,
        12,
        { descriptionTop: 54, overlayTop: 64, sheetTop: 40 },
        { keyboard: "hidden", keyboardInset: 280 }
      )
    ];
    const deltas = calculateFrameVisualDeltas(frames);
    const adjacent = threshold(
      evaluateThresholds({ frames, telemetry: calibratedTelemetry() }),
      "unexplained_adjacent_jump"
    );

    expect(deltas[0]).toMatchObject({
      comparisonMode: "relative_internal_anchors",
      eligibleForJumpCheck: true,
      maximumAnchorDelta: 6,
      relativeAnchorDeltas: { descriptionFromSheet: 6, overlayFromDescription: 0 },
      sheetDisplacementAfterRecordedKeyboardDelta: 0
    });
    expect(adjacent).toMatchObject({ evaluated: true, observed: 6, passed: false });
  });

  it("fails a large Suggestions-relative jump during an expected keyboard update", () => {
    const frames = [
      trackedFrame(
        0,
        10,
        { descriptionTop: 34, overlayTop: 44, sheetTop: 20 },
        { keyboard: "visible", keyboardInset: 300 }
      ),
      trackedFrame(
        1,
        11,
        { descriptionTop: 44, overlayTop: 59, sheetTop: 30 },
        { keyboard: "dismissing", keyboardInset: 290, phase: "expected_update" }
      )
    ];
    const delta = calculateFrameVisualDeltas(frames)[0];
    const adjacent = threshold(
      evaluateThresholds({ frames, telemetry: calibratedTelemetry() }),
      "unexplained_adjacent_jump"
    );

    expect(delta).toMatchObject({
      maximumAnchorDelta: 5,
      relativeAnchorDeltas: { descriptionFromSheet: 0, overlayFromDescription: 5 }
    });
    expect(adjacent).toMatchObject({ evaluated: true, observed: 5, passed: false });
  });

  it("fails an injected single-frame visual-anchor jump from adjacent decoded frames", () => {
    const telemetry = transitionTelemetry();
    const frames = [
      trackedFrame(0, 22, { descriptionTop: 34, overlayTop: 44, sheetTop: 20 }),
      trackedFrame(1, 24, { descriptionTop: 44, overlayTop: 54, sheetTop: 30 }),
      trackedFrame(2, 26, { descriptionTop: 34, overlayTop: 44, sheetTop: 20 })
    ];
    const deltas = calculateFrameVisualDeltas(frames);
    const evaluation = evaluateThresholds({ frames, telemetry });
    const adjacent = threshold(evaluation, "unexplained_adjacent_jump");

    expect(deltas).toHaveLength(2);
    expect(deltas.every((delta) => delta.eligibleForJumpCheck)).toBe(true);
    expect(adjacent).toMatchObject({ evaluated: true, observed: 10, passed: false, sampleCount: 2 });
    expect(adjacent.details).toMatchObject({
      evaluatedFramePairCount: 2,
      source: "adjacent_decoded_frame_visual_anchors"
    });
  });

  it("passes smooth entrance, keyboard-layout, stable, and exit frame tracks with nonzero eligible pairs", () => {
    const telemetry = transitionTelemetry();
    const frames = [
      trackedFrame(0, 5, { descriptionTop: 64, overlayTop: null, sheetTop: 50 }, { phase: "entrance" }),
      trackedFrame(1, 10, { descriptionTop: 54, overlayTop: null, sheetTop: 40 }, { phase: "entrance" }),
      trackedFrame(2, 22, { descriptionTop: 34, overlayTop: 44, sheetTop: 20 }, { keyboard: "visible" }),
      trackedFrame(3, 24, { descriptionTop: 34.5, overlayTop: 44.5, sheetTop: 20.5 }, { keyboard: "visible" }),
      trackedFrame(4, 25, { descriptionTop: 40, overlayTop: null, sheetTop: 26 }, { keyboard: "hidden", phase: "expected_update" }),
      trackedFrame(5, 26, { descriptionTop: 34, overlayTop: null, sheetTop: 20 }, { keyboard: "hidden" }),
      trackedFrame(6, 28, { descriptionTop: 34.5, overlayTop: null, sheetTop: 20.5 }, { keyboard: "hidden" }),
      trackedFrame(7, 35, { descriptionTop: 54, overlayTop: null, sheetTop: 40 }, { phase: "exit" }),
      trackedFrame(8, 40, { descriptionTop: 64, overlayTop: null, sheetTop: 50 }, { phase: "exit" })
    ];
    const evaluation = evaluateThresholds({ frames, telemetry });
    const adjacent = threshold(evaluation, "unexplained_adjacent_jump");

    expect(adjacent).toMatchObject({ evaluated: true, observed: 0.5, passed: true, sampleCount: 4 });
    expect(adjacent.details.evaluatedFramePairCount).toBe(4);
    expect(adjacent.details.excludedFramePairReasons.expected_presentation_motion).toBeGreaterThan(0);
  });

  it("accepts legitimate leading/trailing underlay frames around a continuously tracked sheet lifecycle", () => {
    const width = 40;
    const height = 80;
    const telemetry = transitionTelemetry();
    expect(telemetry.presentationIntervals).toMatchObject([{
      endTimeMs: 50,
      presentationId: 7,
      startSource: "open_started",
      startTimeMs: 0
    }]);
    expect(telemetry.visualCalibration.sheetSegments).toMatchObject([
      { endTimeMs: 20, phase: "entrance", startTimeMs: 0 },
      { endTimeMs: 30, phase: "stable", startTimeMs: 20 },
      { endReason: "exit_finished", endTimeMs: 50, phase: "exit", startTimeMs: 30 }
    ]);

    const underlay = populatedUnderlayPixels(width, height);
    const stablePixels = movingSheetPixels(width, height, 20);
    const frames = [
      analyzedTelemetryFrame(underlay, width, height, 0, 10, telemetry),
      analyzedTelemetryFrame(stablePixels, width, height, 1, 25, telemetry),
      analyzedTelemetryFrame(underlay, width, height, 2, 40, telemetry)
    ];
    applyTemporalVisualContinuity(frames);
    const evaluation = evaluateThresholds({ frames, telemetry });

    expect(frames.map((frame) => frame.visualPhase)).toEqual(["entrance", "stable", "exit"]);
    expect(frames.map((frame) => frame.calibratedSheetPresent)).toEqual([false, true, false]);
    expect(frames[0].transitionCandidateCount).toBeGreaterThan(0);
    expect(frames[2].transitionCandidateCount).toBeGreaterThan(0);
    expect(frames[0].full.landmarkPresent).toBe(true);
    expect(frames[2].full.landmarkPresent).toBe(true);
    expect(threshold(evaluation, "pre_exit_content_continuity")).toMatchObject({
      evaluated: true,
      observed: 0,
      passed: true
    });
    expect(threshold(evaluation, "pre_exit_content_continuity").details).toMatchObject({
      allowedOuterUnderlayFrameIndexes: [0, 2],
      missingCalibratedSheetFrameIndexes: []
    });
  });

  it("fails when a tracked sheet disappears and then reappears mid-lifecycle", () => {
    const width = 40;
    const height = 80;
    const telemetry = transitionTelemetry();
    const frames = [
      analyzedTelemetryFrame(movingSheetPixels(width, height, 45), width, height, 0, 5, telemetry),
      analyzedTelemetryFrame(populatedUnderlayPixels(width, height), width, height, 1, 10, telemetry),
      analyzedTelemetryFrame(movingSheetPixels(width, height, 30), width, height, 2, 15, telemetry),
      analyzedTelemetryFrame(movingSheetPixels(width, height, 20), width, height, 3, 25, telemetry),
      analyzedTelemetryFrame(movingSheetPixels(width, height, 45), width, height, 4, 35, telemetry),
      analyzedTelemetryFrame(populatedUnderlayPixels(width, height), width, height, 5, 45, telemetry)
    ];
    applyTemporalVisualContinuity(frames);
    const continuity = threshold(
      evaluateThresholds({ frames, telemetry }),
      "pre_exit_content_continuity"
    );

    expect(frames.slice(0, 3).map((frame) => frame.calibratedSheetPresent))
      .toEqual([true, false, true]);
    expect(continuity).toMatchObject({ evaluated: true, passed: false });
    expect(continuity.details.missingCalibratedSheetFrameIndexes).toContain(1);
  });

  it("tracks a paired moving sheet landmark during both entrance and exit", () => {
    const width = 40;
    const height = 80;
    const telemetry = transitionTelemetry();
    const frames = [
      analyzedTelemetryFrame(movingSheetPixels(width, height, 45), width, height, 0, 10, telemetry),
      analyzedTelemetryFrame(movingSheetPixels(width, height, 20), width, height, 1, 25, telemetry),
      analyzedTelemetryFrame(movingSheetPixels(width, height, 45), width, height, 2, 40, telemetry)
    ];
    applyTemporalVisualContinuity(frames);
    const evaluation = evaluateThresholds({ frames, telemetry });

    expect(frames.map((frame) => frame.calibratedSheetPresent)).toEqual([true, true, true]);
    expect(frames[0].transitionTrackedTop).toBeCloseTo(45 / height, 1);
    expect(frames[2].transitionTrackedTop).toBeCloseTo(45 / height, 1);
    expect(threshold(evaluation, "pre_exit_content_continuity")).toMatchObject({
      evaluated: true,
      observed: 0,
      passed: true
    });
  });

  it("marks visual calibration incomplete when any lifecycle segment has zero decoded frames", () => {
    const telemetry = analyzeTelemetry(parseNdjson([
      '{"videoTimeMs":0,"event":"sheet_open_started","openStarted":true,"runId":"zero-frame"}',
      '{"videoTimeMs":2,"runId":"zero-frame","presentationId":9,"settled":true,"screenSheetRect":{"x":0,"y":20,"width":40,"height":60},"staleCallbackCount":0,"duplicateMutationCount":0,"mutationAttemptCount":0,"mutationStartedCount":0,"mutationRejectedCount":0,"mutationFinishedCount":0}',
      '{"videoTimeMs":5,"event":"expected_transition_started","expectedTransition":true,"runId":"zero-frame","presentationId":9}',
      '{"videoTimeMs":6,"runId":"zero-frame","presentationId":9,"settled":true,"screenSheetRect":{"x":0,"y":20,"width":40,"height":60}}',
      '{"videoTimeMs":8,"event":"sheet_exit_started","exitStarted":true,"runId":"zero-frame","presentationId":9}',
      '{"videoTimeMs":10,"event":"sheet_exit_finished","exitFinished":true,"committedExit":true,"runId":"zero-frame","presentationId":9}'
    ].join("\n")));
    const segments = telemetry.visualCalibration.sheetSegments;
    expect(segments.map((segment) => segment.phase)).toEqual([
      "entrance",
      "stable",
      "expected_update",
      "stable",
      "exit"
    ]);
    const frames = [0, 1, 3, 4].map((segmentIndex, frameIndex) => ({
      ...populatedFrame(frameIndex, [1, 3, 7, 9][frameIndex]),
      ...calibratedSheetFrame(0, true, segmentIndex),
      visualPhase: segments[segmentIndex].phase
    }));
    const continuity = threshold(
      evaluateThresholds({ frames, telemetry }),
      "pre_exit_content_continuity"
    );

    expect(continuity).toMatchObject({ evaluated: false, observed: null, passed: null });
    expect(continuity.details.missingDecodedSheetSegmentIndexes).toEqual([2]);
    expect(continuity.details.sheetSegmentCoverage[2]).toMatchObject({
      decodedFrameCount: 0,
      evaluatedFrameCount: 0,
      phase: "expected_update"
    });
  });

  it("marks an unsampled Suggestions overlay segment incomplete instead of silently skipping it", () => {
    const geometry = '"runId":"zero-overlay","presentationId":11,"settled":true,"screenSheetRect":{"x":0,"y":20,"width":40,"height":60}';
    const telemetry = analyzeTelemetry(parseNdjson([
      '{"videoTimeMs":0,"event":"sheet_open_started","openStarted":true,"runId":"zero-overlay"}',
      `{"videoTimeMs":0,${geometry},"screenOverlayRect":{"x":4,"y":40,"width":32,"height":20},"staleCallbackCount":0,"duplicateMutationCount":0,"mutationAttemptCount":0,"mutationStartedCount":0,"mutationRejectedCount":0,"mutationFinishedCount":0}`,
      `{"videoTimeMs":4,${geometry},"screenOverlayRect":{"x":4,"y":40,"width":32,"height":18}}`,
      `{"videoTimeMs":5,${geometry},"screenOverlayRect":{"x":4,"y":40,"width":32,"height":16}}`,
      '{"videoTimeMs":10,"event":"sheet_exit_finished","exitFinished":true,"committedExit":true,"runId":"zero-overlay","presentationId":11}'
    ].join("\n")));
    expect(telemetry.visualCalibration.overlaySegments).toHaveLength(3);
    const frames = [
      {
        ...populatedFrame(0, 2),
        ...calibratedSheetFrame(0, true, 0),
        calibratedOverlayEvaluated: true,
        calibratedOverlayExpected: true,
        calibratedOverlayPresent: true,
        visualOverlaySegmentIndex: 0
      },
      {
        ...populatedFrame(1, 7),
        ...calibratedSheetFrame(0, true, 2),
        calibratedOverlayEvaluated: true,
        calibratedOverlayExpected: true,
        calibratedOverlayPresent: true,
        visualOverlaySegmentIndex: 2
      }
    ];
    const continuity = threshold(
      evaluateThresholds({ frames, telemetry }),
      "pre_exit_content_continuity"
    );

    expect(continuity).toMatchObject({ evaluated: false, observed: null, passed: null });
    expect(continuity.details.missingDecodedOverlaySegmentIndexes).toEqual([1]);
    expect(continuity.details.overlaySegmentCoverage[1]).toMatchObject({
      decodedFrameCount: 0,
      evaluatedFrameCount: 0
    });
  });

  it("fails a populated dashboard underlay when the calibrated sheet boundary disappears", () => {
    const width = 40;
    const height = 80;
    const calibration = {
      descriptionRect: { x: 4, y: 34, width: 32, height: 8 },
      sheetRect: { x: 0, y: 20, width, height: 60 }
    };
    const underlay = rgbImage(width, height, (x, y) =>
      x >= 5 && x <= 8 || x >= 28 && x <= 33 || y >= 8 && y <= 11
        ? [55, 62, 75]
        : [9, 12, 18]
    );
    const fixedRegion = analyzePixelRegion(
      underlay,
      width,
      height,
      3,
      { x: 0, y: 0, width: 1, height: 1 },
      DEFAULT_VISUAL_THRESHOLDS
    );
    const visual = analyzeCalibratedVisualFrame(underlay, width, height, 3, calibration);
    const telemetry = calibratedTelemetry();
    const evaluation = evaluateThresholds({
      frames: [{
        ...populatedFrame(0, 10),
        ...visual,
        visualCalibrationIntervalIndex: 0,
        visualSheetSegmentIndex: 0
      }],
      telemetry
    });

    expect(fixedRegion.landmarkPresent).toBe(true);
    expect(visual.calibratedSheetEvaluated).toBe(true);
    expect(visual.calibratedSheetPresent).toBe(false);
    expect(threshold(evaluation, "pre_exit_content_continuity")).toMatchObject({
      evaluated: true,
      observed: 1,
      passed: false
    });
  });

  it("passes the same populated underlay when the calibrated native sheet boundary is present", () => {
    const width = 40;
    const height = 80;
    const calibration = {
      descriptionRect: { x: 4, y: 34, width: 32, height: 8 },
      sheetRect: { x: 0, y: 20, width, height: 60 }
    };
    const pixels = rgbImage(width, height, (x, y) => {
      if (y >= 20) {
        return x >= 4 && x <= 35 && y >= 34 && y <= 41 ? [52, 57, 68] : [25, 29, 38];
      }
      return x >= 5 && x <= 8 || x >= 28 && x <= 33 || y >= 8 && y <= 11
        ? [55, 62, 75]
        : [9, 12, 18];
    });
    const visual = analyzeCalibratedVisualFrame(pixels, width, height, 3, calibration);
    const evaluation = evaluateThresholds({
      frames: [{
        ...populatedFrame(0, 10),
        ...visual,
        visualCalibrationIntervalIndex: 0,
        visualSheetSegmentIndex: 0
      }],
      telemetry: calibratedTelemetry()
    });

    expect(visual.calibratedSheetPresent).toBe(true);
    expect(visual.sheetBoundary.broadContrastCoverage).toBeGreaterThan(0.9);
    expect(threshold(evaluation, "pre_exit_content_continuity")).toMatchObject({
      evaluated: true,
      observed: 0,
      passed: true
    });
  });

  it("detects a zero-opacity Suggestions loss during a same-presentation query update", () => {
    const width = 40;
    const height = 80;
    const calibration = {
      descriptionRect: { x: 4, y: 30, width: 32, height: 8 },
      overlayRect: { x: 4, y: 44, width: 32, height: 20 },
      sheetRect: { x: 0, y: 20, width, height: 60 }
    };
    const pixels = rgbImage(width, height, (x, y) => {
      if (y >= 20) {
        return x >= 4 && x <= 35 && y >= 30 && y <= 37 ? [52, 57, 68] : [25, 29, 38];
      }
      return x >= 6 && x <= 10 ? [55, 62, 75] : [9, 12, 18];
    });
    const visual = analyzeCalibratedVisualFrame(pixels, width, height, 3, calibration);
    const visiblePixels = rgbImage(width, height, (x, y) => {
      if (y >= 20) {
        if (x >= 4 && x <= 35 && y >= 44 && y < 64) return [48, 54, 66];
        return x >= 4 && x <= 35 && y >= 30 && y <= 37 ? [52, 57, 68] : [25, 29, 38];
      }
      return x >= 6 && x <= 10 ? [55, 62, 75] : [9, 12, 18];
    });
    const visible = analyzeCalibratedVisualFrame(visiblePixels, width, height, 3, calibration);
    const evaluation = evaluateThresholds({
      frames: [{
        ...populatedFrame(0, 10),
        ...visual,
        visualCalibrationIntervalIndex: 0,
        visualOverlaySegmentIndex: 0,
        visualSheetSegmentIndex: 0
      }],
      telemetry: calibratedTelemetry(true)
    });

    expect(visual.calibratedSheetPresent).toBe(true);
    expect(visual.calibratedOverlayExpected).toBe(true);
    expect(visual.calibratedOverlayEvaluated).toBe(true);
    expect(visual.calibratedOverlayPresent).toBe(false);
    expect(visible.calibratedOverlayPresent).toBe(true);
    expect(threshold(evaluation, "pre_exit_content_continuity").details)
      .toMatchObject({ missingCalibratedOverlayFrameIndexes: [0] });
    expect(threshold(evaluation, "pre_exit_content_continuity").passed).toBe(false);
  });

  it("uses only the temporally selected transition candidate for Suggestions evidence", () => {
    const telemetry = analyzeTelemetry(parseNdjson([
      '{"videoTimeMs":0,"event":"sheet_open_started","openStarted":true,"runId":"selected-overlay","presentationId":8}',
      '{"videoTimeMs":5,"event":"checkpoint","runId":"selected-overlay","presentationId":8,"settled":true,"screenAppRect":{"x":0,"y":0,"width":40,"height":80},"screenSheetRect":{"x":0,"y":20,"width":40,"height":60},"screenDescriptionRect":{"x":4,"y":34,"width":32,"height":8},"screenOverlayRect":{"x":4,"y":44,"width":32,"height":20},"staleCallbackCount":0,"duplicateMutationCount":0,"mutationAttemptCount":0,"mutationStartedCount":0,"mutationRejectedCount":0,"mutationFinishedCount":0}',
      '{"videoTimeMs":10,"event":"expected_transition_started","expectedTransition":true,"runId":"selected-overlay","presentationId":8}',
      '{"videoTimeMs":20,"event":"checkpoint","runId":"selected-overlay","presentationId":8,"settled":true,"screenAppRect":{"x":0,"y":0,"width":40,"height":80},"screenSheetRect":{"x":0,"y":20,"width":40,"height":60},"screenDescriptionRect":{"x":4,"y":34,"width":32,"height":8},"screenOverlayRect":{"x":4,"y":44,"width":32,"height":20}}',
      '{"videoTimeMs":30,"event":"sheet_exit_finished","exitFinished":true,"committedExit":true,"runId":"selected-overlay","presentationId":8}'
    ].join("\n")));
    expect(telemetry.visualCalibration.sheetSegments.map((segment) => segment.phase))
      .toEqual(["entrance", "stable", "expected_update", "stable"]);
    expect(telemetry.visualCalibration.overlaySegments.map((segment) => segment.phase ?? "overlay"))
      .toEqual(["overlay", "expected_update", "overlay"]);

    const sheetBoundary = {
      afterMeanRgb: [25, 29, 38],
      evaluated: true,
      landmarkPresent: true,
      sampleY: 20
    };
    const descriptionBoundary = {
      afterMeanRgb: [52, 57, 68],
      evaluated: true,
      landmarkPresent: true,
      sampleY: 34
    };
    const visibleOverlayBoundary = {
      afterMeanRgb: [48, 54, 66],
      evaluated: true,
      landmarkPresent: true,
      sampleY: 44
    };
    const framesForSelectedOverlay = (selectedOverlayBoundary) => {
      const entrance = {
        ...populatedFrame(0, 2),
        ...calibratedSheetFrame(0, true, 0),
        analysisHeight: 80,
        analysisWidth: 40,
        transitionTrackedTop: 0.5,
        visualPhase: "entrance",
        visualScreenHeight: 80
      };
      const stableBefore = {
        ...populatedFrame(1, 7),
        ...calibratedSheetFrame(0, true, 1),
        analysisHeight: 80,
        analysisWidth: 40,
        calibratedOverlayEvaluated: true,
        calibratedOverlayExpected: true,
        calibratedOverlayPresent: true,
        descriptionBoundary,
        overlayBoundary: visibleOverlayBoundary,
        sheetBoundary,
        visualAnchorTrack: { descriptionTop: 34, overlayTop: 44, sheetTop: 20 },
        visualOverlaySegmentIndex: 0,
        visualPhase: "stable",
        visualScreenHeight: 80
      };
      const transition = {
        ...populatedFrame(2, 15),
        _transitionCalibrationEvaluated: true,
        _transitionCandidates: [
          {
            descriptionBoundary,
            overlayBoundary: selectedOverlayBoundary,
            score: 10,
            sheetBoundary,
            top: 0.25
          },
          {
            descriptionBoundary,
            overlayBoundary: visibleOverlayBoundary,
            score: 1_000,
            sheetBoundary,
            top: 0.625
          }
        ],
        _transitionOverlayExpected: true,
        analysisHeight: 80,
        analysisWidth: 40,
        calibratedSheetExpected: true,
        transitionFinalTop: 0.25,
        visualCalibrationIntervalIndex: 0,
        visualOverlaySegmentIndex: 1,
        visualPhase: "expected_update",
        visualScreenHeight: 80,
        visualSheetSegmentIndex: 2
      };
      const stableAfter = {
        ...populatedFrame(3, 25),
        ...calibratedSheetFrame(0, true, 3),
        analysisHeight: 80,
        analysisWidth: 40,
        calibratedOverlayEvaluated: true,
        calibratedOverlayExpected: true,
        calibratedOverlayPresent: true,
        descriptionBoundary,
        overlayBoundary: visibleOverlayBoundary,
        sheetBoundary,
        visualOverlaySegmentIndex: 2,
        visualPhase: "stable",
        visualScreenHeight: 80
      };
      applyTemporalVisualContinuity([transition, stableAfter]);
      return { frames: [entrance, stableBefore, transition, stableAfter], transition };
    };

    const missingSelected = framesForSelectedOverlay(null);
    const missingContinuity = threshold(evaluateThresholds({
      frames: missingSelected.frames,
      telemetry
    }), "pre_exit_content_continuity");

    expect(missingSelected.transition).toMatchObject({
      calibratedOverlayEvaluated: false,
      calibratedOverlayExpected: true,
      calibratedOverlayPresent: null,
      overlayBoundary: null,
      transitionCandidateCount: 2,
      transitionTrackedTop: 0.25
    });
    expect(missingSelected.transition.visualAnchorTrack).toMatchObject({
      overlayTop: null,
      sheetTop: 20
    });
    expect(missingContinuity).toMatchObject({ evaluated: false, observed: null, passed: null });
    expect(missingContinuity.details).toMatchObject({
      invalidCalibratedOverlayFrameIndexes: [2],
      missingDecodedOverlaySegmentIndexes: [],
      missingEvaluatedOverlaySegmentIndexes: [1]
    });

    const visibleSelected = framesForSelectedOverlay(visibleOverlayBoundary);
    const visibleContinuity = threshold(evaluateThresholds({
      frames: visibleSelected.frames,
      telemetry
    }), "pre_exit_content_continuity");
    expect(visibleSelected.transition).toMatchObject({
      calibratedOverlayEvaluated: true,
      calibratedOverlayPresent: true,
      transitionCandidateCount: 2,
      transitionTrackedTop: 0.25
    });
    expect(visibleContinuity).toMatchObject({ evaluated: true, observed: 0, passed: true });
  });
});

describe("sheet recording CLI values", () => {
  it("accepts only normalized in-frame ROIs", () => {
    expect(parseNormalizedRoi("0.1,0.2,0.3,0.4")).toEqual({
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4
    });
    expect(() => parseNormalizedRoi("0.8,0,0.3,1")).toThrow(/fit inside/);
  });

  it("uses the native app frame when a keyboard-translated sheet no longer reaches the screen bottom", () => {
    expect(screenRectToNormalizedRect(
      { x: 0, y: 10, width: 40, height: 30 },
      { x: 0, y: 10, width: 40, height: 30 },
      40,
      80,
      { x: 0, y: 0, width: 40, height: 80 }
    )).toEqual({ x: 0, y: 0.125, width: 1, height: 0.375 });
  });
});

describe("native evidence provenance", () => {
  it("binds a clean fresh build, owned Metro, runner run ID, and final source verification", () => {
    const records = validEvidenceRecords();
    const provenance = analyzeEvidenceProvenance(records, {
      currentSource: {
        dirty: false,
        fingerprint: "a".repeat(64),
        revision: "0123456789abcdef0123456789abcdef01234567"
      }
    });
    const evidenceThreshold = threshold(evaluateThresholds({
      evidenceProvenance: provenance,
      frames: [{ ...populatedFrame(0, 10), ...calibratedSheetFrame(0) }],
      requireProvenance: true,
      telemetry: calibratedTelemetry()
    }), "evidence_provenance");

    expect(provenance).toMatchObject({
      complete: true,
      invocationRunIds: ["native-run-1"],
      issues: []
    });
    expect(evidenceThreshold).toMatchObject({ evaluated: true, observed: 0, passed: true });
  });

  it.each([
    {
      name: "missing final verification",
      mutate: (records) => records.filter((record) => record.event !== "source_verification_finished")
    },
    {
      name: "mismatched final fingerprint",
      mutate: (records) => records.map((record) =>
        record.event === "source_verification_finished"
          ? { ...record, sourceFingerprint: "b".repeat(64) }
          : record
      )
    },
    {
      name: "unowned telemetry run ID",
      mutate: (records) => records.map((record) =>
        record.event === "test_started" ? { ...record, runId: "not-the-invocation" } : record
      )
    }
  ])("makes $name incomplete", ({ mutate }) => {
    const provenance = analyzeEvidenceProvenance(mutate(validEvidenceRecords()), {
      currentSource: {
        dirty: false,
        fingerprint: "a".repeat(64),
        revision: "0123456789abcdef0123456789abcdef01234567"
      }
    });
    const evidenceThreshold = threshold(evaluateThresholds({
      evidenceProvenance: provenance,
      frames: [{ ...populatedFrame(0, 10), ...calibratedSheetFrame(0) }],
      requireProvenance: true,
      telemetry: calibratedTelemetry()
    }), "evidence_provenance");

    expect(provenance.complete).toBe(false);
    expect(provenance.issues.length).toBeGreaterThan(0);
    expect(evidenceThreshold).toMatchObject({ evaluated: false, observed: null, passed: null });
  });
});

function rgbImage(width, height, pixel) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const [red, green, blue] = pixel(x, y);
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
    }
  }
  return data;
}

function populatedFrame(frameIndex, timestampMs) {
  return {
    backgroundLandmarkPresent: true,
    frameIndex,
    missingBothLandmarks: false,
    sheetPresent: false,
    timestampMs
  };
}

function missingFrame(frameIndex, timestampMs) {
  return {
    backgroundLandmarkPresent: false,
    frameIndex,
    missingBothLandmarks: true,
    sheetPresent: false,
    timestampMs
  };
}

function calibratedSheetFrame(intervalIndex, present = true, segmentIndex = intervalIndex) {
  return {
    calibratedOverlayEvaluated: false,
    calibratedOverlayExpected: false,
    calibratedOverlayPresent: null,
    calibratedSheetEvaluated: true,
    calibratedSheetExpected: true,
    calibratedSheetPresent: present,
    visualCalibrationIntervalIndex: intervalIndex,
    visualOverlaySegmentIndex: null,
    visualSheetSegmentIndex: segmentIndex
  };
}

function calibratedTelemetry(withOverlay = false) {
  const overlay = withOverlay
    ? ',"screenOverlayRect":{"x":4,"y":44,"width":32,"height":20}'
    : "";
  return analyzeTelemetry(parseNdjson([
    '{"videoTimeMs":0,"event":"sheet_open_started","openStarted":true,"runId":"visual","presentationId":1}',
    `{"videoTimeMs":0,"runId":"visual","presentationId":1,"settled":true,"screenSheetRect":{"x":0,"y":20,"width":40,"height":60}${overlay},"staleCallbackCount":0,"duplicateMutationCount":0,"mutationAttemptCount":0,"mutationStartedCount":0,"mutationRejectedCount":0,"mutationFinishedCount":0}`,
    '{"videoTimeMs":20,"event":"sheet_exit_finished","exitFinished":true,"committedExit":true,"runId":"visual","presentationId":1}'
  ].join("\n")));
}

function transitionTelemetry() {
  return analyzeTelemetry(parseNdjson([
    '{"videoTimeMs":0,"event":"sheet_open_started","openStarted":true,"runId":"transition"}',
    '{"videoTimeMs":20,"event":"checkpoint","runId":"transition","presentationId":7,"settled":true,"screenAppRect":{"x":0,"y":0,"width":40,"height":80},"screenSheetRect":{"x":0,"y":20,"width":40,"height":60},"screenDescriptionRect":{"x":4,"y":34,"width":32,"height":8},"staleCallbackCount":0,"duplicateMutationCount":0,"mutationAttemptCount":0,"mutationStartedCount":0,"mutationRejectedCount":0,"mutationFinishedCount":0}',
    '{"videoTimeMs":30,"event":"sheet_exit_started","exitStarted":true,"expectedTransition":true,"runId":"transition","presentationId":7,"state":{"sheetPhase":"presented","keyboardPhase":"hidden","screenAppRect":{"x":0,"y":0,"width":40,"height":80},"screenSheetRect":{"x":0,"y":20,"width":40,"height":60},"screenDescriptionRect":{"x":4,"y":34,"width":32,"height":8}}}',
    '{"videoTimeMs":50,"event":"sheet_exit_finished","exitFinished":true,"committedExit":true,"runId":"transition","presentationId":7}'
  ].join("\n")));
}

function analyzedTelemetryFrame(pixels, width, height, frameIndex, timestampMs, telemetry) {
  const calibration = visualCalibrationForFrame({ timestampMs }, telemetry.visualCalibration);
  const visual = analyzeCalibratedVisualFrame(pixels, width, height, 3, calibration);
  const full = analyzePixelRegion(
    pixels,
    width,
    height,
    3,
    { x: 0, y: 0, width: 1, height: 1 },
    DEFAULT_VISUAL_THRESHOLDS
  );
  return {
    ...populatedFrame(frameIndex, timestampMs),
    ...visual,
    analysisHeight: height,
    analysisWidth: width,
    full,
    visualCalibrationIntervalIndex: calibration?.intervalIndex ?? null,
    visualKeyboardState: calibration?.keyboardLayout?.stableState ?? null,
    visualPhase: calibration?.visualPhase ?? null,
    visualScreenHeight: calibration?.screenAppRect?.height ?? null,
    visualSheetSegmentIndex: calibration?.sheetSegmentIndex ?? null
  };
}

function populatedUnderlayPixels(width, height) {
  return rgbImage(width, height, (x, y) => {
    // Deliberately place broad dashboard edges at both calibrated landmark
    // offsets. Geometry alone would false-positive; the stable sheet colour
    // signature must reject these populated-underlay candidates.
    if (y >= 34) return [112, 118, 130];
    if (y >= 20) return [72, 78, 90];
    return x >= 5 && x <= 8 || x >= 28 && x <= 33 || y >= 8 && y <= 11
      ? [55, 62, 75]
      : [9, 12, 18];
  });
}

function movingSheetPixels(width, height, top) {
  return rgbImage(width, height, (x, y) => {
    if (y >= top) {
      return x >= 4 && x <= 35 && y >= top + 14 && y < top + 22
        ? [52, 57, 68]
        : [25, 29, 38];
    }
    return x >= 5 && x <= 8 || x >= 28 && x <= 33 || y >= 8 && y <= 11
      ? [55, 62, 75]
      : [9, 12, 18];
  });
}

function trackedFrame(
  frameIndex,
  timestampMs,
  visualAnchorTrack,
  { keyboard = "hidden", keyboardInset = null, phase = "stable" } = {}
) {
  const segmentIndex = phase === "entrance" ? 0 : phase === "exit" ? 2 : 1;
  return {
    ...populatedFrame(frameIndex, timestampMs),
    ...calibratedSheetFrame(0, true, segmentIndex),
    visualAnchorTrack,
    visualCalibrationIntervalIndex: 0,
    visualKeyboardInset: keyboardInset,
    visualKeyboardState: keyboard,
    visualPhase: phase
  };
}

function threshold(evaluation, id) {
  return evaluation.thresholds.find((candidate) => candidate.id === id);
}

function validEvidenceRecords() {
  const sourceRevision = "0123456789abcdef0123456789abcdef01234567";
  const sourceFingerprint = "a".repeat(64);
  return parseNdjson([
    JSON.stringify({
      allowDirty: false,
      event: "runner_started",
      metroPort: 8099,
      noBuild: false,
      noMetro: false,
      sourceDirty: false,
      sourceFingerprint,
      sourceRevision
    }),
    JSON.stringify({
      appBundlePath: "/tmp/Derived/Dayframe.app",
      buildManifestPath: "/tmp/Derived/.dayframe-sheet-qa-build.json",
      event: "build_for_testing_finished",
      sourceFingerprint,
      success: true,
      xctestrunPath: "/tmp/Derived/DayframeSheetQA.xctestrun"
    }),
    JSON.stringify({
      event: "metro_ready",
      existing: false,
      ownedProcess: true,
      pid: 4242,
      port: 8099,
      projectRoot: "/tmp/dayframe/apps/mobile"
    }),
    JSON.stringify({
      event: "xctestrun_environment_injected",
      flow: "stress",
      runId: "native-run-1"
    }),
    JSON.stringify({
      event: "invocation_started",
      flow: "stress",
      invocation: 1,
      runId: "native-run-1"
    }),
    JSON.stringify({ event: "test_started", runId: "native-run-1", success: true }),
    JSON.stringify({ event: "test_finished", runId: "native-run-1", success: true }),
    JSON.stringify({
      event: "invocation_finished",
      exitCode: 0,
      invocation: 1,
      success: true,
      telemetryVerified: true
    }),
    JSON.stringify({
      event: "source_verification_finished",
      matchesStart: true,
      sourceDirty: false,
      sourceFingerprint,
      sourceRevision,
      success: true
    }),
    JSON.stringify({
      event: "runner_finished",
      sourceDirty: false,
      sourceFingerprint,
      sourceRevision,
      success: true
    })
  ].join("\n"));
}
