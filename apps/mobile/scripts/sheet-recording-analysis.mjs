export const ANALYSIS_SCHEMA_VERSION = 3;

export const DEFAULT_BACKGROUND_ROI = Object.freeze({
  x: 0.05,
  y: 0.03,
  width: 0.9,
  height: 0.28
});

export const DEFAULT_SHEET_ROI = Object.freeze({
  x: 0.03,
  y: 0.4,
  width: 0.94,
  height: 0.57
});

export const DEFAULT_VISUAL_THRESHOLDS = Object.freeze({
  edgeDifference: 8,
  maximumEdgeRatio: 0.002,
  maximumLumaRange: 8,
  maximumLumaStdDev: 2.5,
  maximumRgbStdDev: 2.5
});

export const DEFAULT_BOUNDARY_THRESHOLDS = Object.freeze({
  maximumSearchRadius: 4,
  minimumBroadContrastCoverage: 0.28,
  minimumMeanColourDifference: 4.5,
  minimumPerColumnColourDifference: 5,
  sampleDepth: 2,
  horizontalInsetRatio: 0.14
});

const OVERLAY_BOUNDARY_THRESHOLDS = Object.freeze({
  ...DEFAULT_BOUNDARY_THRESHOLDS,
  maximumSearchRadius: 1
});

const CALIBRATED_STABLE_BOUNDARY_THRESHOLDS = Object.freeze({
  ...DEFAULT_BOUNDARY_THRESHOLDS,
  maximumSearchRadius: 2
});

const TRANSITION_BOUNDARY_THRESHOLDS = Object.freeze({
  ...DEFAULT_BOUNDARY_THRESHOLDS,
  maximumSearchRadius: 0
});

const MAX_TRANSITION_BOUNDARY_COLOUR_DISTANCE = 32;

export const REQUIRED_THRESHOLDS = Object.freeze({
  settledGeometryDelta: 1,
  unexplainedAdjacentJump: 2,
  missingContentFrames: 0,
  staleCallbackCount: 0,
  duplicateMutationCount: 0
});

const RECT_KEYS = ["x", "y", "width", "height"];
const TRANSITIONAL_PHASE = /(appear|dismiss|drag|enter|exit|open|presenting|settling|swip)/i;
const SETTLED_PHASE = /^(idle|presented|settled|stable|visible)$/i;

export function parseNormalizedRoi(value, label = "ROI") {
  const parts = String(value).split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`${label} must be four comma-separated normalized values: x,y,width,height.`);
  }
  const [x, y, width, height] = parts;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
    throw new Error(`${label} must fit inside normalized frame bounds 0..1.`);
  }
  return { x, y, width, height };
}

export function analyzePixelRegion(
  data,
  imageWidth,
  imageHeight,
  channels,
  roi,
  thresholds = DEFAULT_VISUAL_THRESHOLDS
) {
  if (!data || !Number.isSafeInteger(imageWidth) || !Number.isSafeInteger(imageHeight)) {
    throw new Error("Pixel analysis requires a raw image buffer and integer dimensions.");
  }
  if (!Number.isSafeInteger(channels) || channels < 3) {
    throw new Error("Pixel analysis requires at least three RGB channels.");
  }

  const bounds = normalizedRoiToPixelBounds(roi, imageWidth, imageHeight);
  const pixelCount = bounds.width * bounds.height;
  const lumaValues = new Float32Array(pixelCount);
  const lumaHistogram = new Uint32Array(256);
  const channelSums = [0, 0, 0];
  const channelSquareSums = [0, 0, 0];
  let lumaSum = 0;
  let lumaSquareSum = 0;
  let cursor = 0;

  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      const offset = (y * imageWidth + x) * channels;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      lumaValues[cursor] = luma;
      lumaHistogram[Math.max(0, Math.min(255, Math.round(luma)))] += 1;
      lumaSum += luma;
      lumaSquareSum += luma * luma;
      channelSums[0] += red;
      channelSums[1] += green;
      channelSums[2] += blue;
      channelSquareSums[0] += red * red;
      channelSquareSums[1] += green * green;
      channelSquareSums[2] += blue * blue;
      cursor += 1;
    }
  }

  let edgeCount = 0;
  let edgeComparisons = 0;
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const offset = y * bounds.width + x;
      const luma = lumaValues[offset];
      if (x > 0) {
        edgeComparisons += 1;
        if (Math.abs(luma - lumaValues[offset - 1]) >= thresholds.edgeDifference) edgeCount += 1;
      }
      if (y > 0) {
        edgeComparisons += 1;
        if (Math.abs(luma - lumaValues[offset - bounds.width]) >= thresholds.edgeDifference) edgeCount += 1;
      }
    }
  }

  const meanLuma = lumaSum / pixelCount;
  const lumaVariance = Math.max(0, lumaSquareSum / pixelCount - meanLuma * meanLuma);
  const channelVariances = channelSums.map((sum, index) => {
    const mean = sum / pixelCount;
    return Math.max(0, channelSquareSums[index] / pixelCount - mean * mean);
  });
  const rgbStdDev = Math.sqrt(channelVariances.reduce((sum, value) => sum + value, 0) / 3);
  const lumaP05 = histogramPercentile(lumaHistogram, pixelCount, 0.05);
  const lumaP95 = histogramPercentile(lumaHistogram, pixelCount, 0.95);
  const lumaRange = lumaP95 - lumaP05;
  const edgeRatio = edgeComparisons === 0 ? 0 : edgeCount / edgeComparisons;
  const lumaStdDev = Math.sqrt(lumaVariance);
  const nearUniform =
    lumaStdDev <= thresholds.maximumLumaStdDev &&
    rgbStdDev <= thresholds.maximumRgbStdDev &&
    lumaRange <= thresholds.maximumLumaRange &&
    edgeRatio <= thresholds.maximumEdgeRatio;

  return {
    bounds,
    edgeRatio,
    landmarkPresent: !nearUniform,
    lumaP05,
    lumaP95,
    lumaRange,
    lumaStdDev,
    meanLuma,
    nearUniform,
    pixelCount,
    rgbStdDev
  };
}

/**
 * Looks for a broad horizontal colour discontinuity at a telemetry-calibrated
 * native boundary. Unlike the legacy fixed sheet ROI, this cannot be satisfied
 * merely because the dashboard below the missing sheet is populated. The
 * metric compares RGB colour on both sides of the expected boundary and never
 * treats low luminance itself as absence, so it remains safe for dark themes.
 */
export function analyzeHorizontalBoundary(
  data,
  imageWidth,
  imageHeight,
  channels,
  normalizedRect,
  edge = "top",
  thresholds = DEFAULT_BOUNDARY_THRESHOLDS
) {
  if (!data || !Number.isSafeInteger(imageWidth) || !Number.isSafeInteger(imageHeight)) {
    throw new Error("Boundary analysis requires a raw image buffer and integer dimensions.");
  }
  if (!Number.isSafeInteger(channels) || channels < 3) {
    throw new Error("Boundary analysis requires at least three RGB channels.");
  }
  if (!normalizedRect || !["top", "bottom"].includes(edge)) {
    return unevaluatedBoundary(edge);
  }

  const bounds = normalizedRoiToPixelBounds(normalizedRect, imageWidth, imageHeight);
  const inset = Math.max(1, Math.floor(bounds.width * thresholds.horizontalInsetRatio));
  const firstX = bounds.x + inset;
  const lastX = bounds.x + bounds.width - inset - 1;
  const expectedY = edge === "top" ? bounds.y : bounds.y + bounds.height;
  const sampleDepth = Math.max(1, Math.floor(thresholds.sampleDepth));
  if (lastX <= firstX || expectedY - sampleDepth < 0 || expectedY + sampleDepth >= imageHeight) {
    return unevaluatedBoundary(edge, { bounds, expectedY });
  }

  const searchRadius = Math.min(
    Math.max(0, Math.floor(thresholds.maximumSearchRadius)),
    expectedY - sampleDepth,
    imageHeight - expectedY - sampleDepth - 1
  );
  let best = null;
  for (let y = expectedY - searchRadius; y <= expectedY + searchRadius; y += 1) {
    const differences = [];
    const beforeSums = [0, 0, 0];
    const afterSums = [0, 0, 0];
    for (let x = firstX; x <= lastX; x += 1) {
      const before = averageRgb(data, imageWidth, channels, x, y - sampleDepth, y - 1);
      const after = averageRgb(data, imageWidth, channels, x, y, y + sampleDepth - 1);
      for (let channel = 0; channel < 3; channel += 1) {
        beforeSums[channel] += before[channel];
        afterSums[channel] += after[channel];
      }
      const difference = Math.sqrt(
        ((before[0] - after[0]) ** 2 +
          (before[1] - after[1]) ** 2 +
          (before[2] - after[2]) ** 2) / 3
      );
      differences.push(difference);
    }
    const meanColourDifference = differences.reduce((sum, value) => sum + value, 0) / differences.length;
    const broadContrastCoverage = differences.filter(
      (value) => value >= thresholds.minimumPerColumnColourDifference
    ).length / differences.length;
    const score = broadContrastCoverage * meanColourDifference;
    if (!best || score > best.score) {
      best = {
        afterMeanRgb: afterSums.map((value) => value / differences.length),
        beforeMeanRgb: beforeSums.map((value) => value / differences.length),
        broadContrastCoverage,
        meanColourDifference,
        sampleY: y,
        score
      };
    }
  }

  const landmarkPresent = Boolean(
    best &&
    best.broadContrastCoverage >= thresholds.minimumBroadContrastCoverage &&
    best.meanColourDifference >= thresholds.minimumMeanColourDifference
  );
  return {
    ...best,
    bounds,
    edge,
    evaluated: true,
    expectedY,
    landmarkPresent
  };
}

export function screenRectToNormalizedRect(
  screenRect,
  screenSheetRect,
  imageWidth,
  imageHeight,
  screenAppRect = null
) {
  if (!isMeasuredRect(screenRect) || !isMeasuredRect(screenSheetRect)) return null;
  if (isMeasuredRect(screenAppRect) && screenAppRect.width > 0 && screenAppRect.height > 0) {
    const normalized = {
      x: (screenRect.x - screenAppRect.x) / screenAppRect.width,
      y: (screenRect.y - screenAppRect.y) / screenAppRect.height,
      width: screenRect.width / screenAppRect.width,
      height: screenRect.height / screenAppRect.height
    };
    return validatedNormalizedRect(normalized);
  }
  const screenHeight = screenSheetRect.y + screenSheetRect.height;
  if (!(screenHeight > 0)) return null;

  // Native sheet surfaces terminate at the bottom of the screen. Deriving the
  // other axis from the decoded frame aspect ratio also accommodates an inset
  // accessibility element without pretending its right edge is the display.
  const screenWidth = screenHeight * (imageWidth / imageHeight);
  if (!(screenWidth > 0)) return null;
  return validatedNormalizedRect({
    x: screenRect.x / screenWidth,
    y: screenRect.y / screenHeight,
    width: screenRect.width / screenWidth,
    height: screenRect.height / screenHeight
  });
}

function validatedNormalizedRect(normalized) {
  if (
    normalized.x < -0.01 || normalized.y < -0.01 ||
    normalized.width <= 0 || normalized.height <= 0 ||
    normalized.x + normalized.width > 1.01 ||
    normalized.y + normalized.height > 1.01
  ) return null;
  return {
    x: clamp(normalized.x, 0, 1),
    y: clamp(normalized.y, 0, 1),
    width: clamp(normalized.width, 0.0001, 1 - clamp(normalized.x, 0, 1)),
    height: clamp(normalized.height, 0.0001, 1 - clamp(normalized.y, 0, 1))
  };
}

export function analyzeCalibratedVisualFrame(
  data,
  imageWidth,
  imageHeight,
  channels,
  calibration
) {
  if (!calibration?.sheetRect) {
    return {
      calibratedOverlayEvaluated: false,
      calibratedOverlayExpected: false,
      calibratedOverlayPresent: null,
      calibratedSheetEvaluated: false,
      calibratedSheetExpected: false,
      calibratedSheetPresent: null,
      description: null,
      descriptionBoundary: null,
      overlayBoundary: null,
      sheetBoundary: null
    };
  }
  if (["entrance", "exit", "expected_update"].includes(calibration.visualPhase)) {
    return analyzeTransitionalVisualFrame(
      data,
      imageWidth,
      imageHeight,
      channels,
      calibration
    );
  }
  const sheetRect = screenRectToNormalizedRect(
    calibration.sheetRect,
    calibration.sheetRect,
    imageWidth,
    imageHeight,
    calibration.screenAppRect
  );
  const descriptionRect = screenRectToNormalizedRect(
    calibration.descriptionRect,
    calibration.sheetRect,
    imageWidth,
    imageHeight,
    calibration.screenAppRect
  );
  const overlayRect = screenRectToNormalizedRect(
    calibration.overlayRect,
    calibration.sheetRect,
    imageWidth,
    imageHeight,
    calibration.screenAppRect
  );
  const sheetBoundary = sheetRect
    ? analyzeHorizontalBoundary(
      data,
      imageWidth,
      imageHeight,
      channels,
      sheetRect,
      "top",
      CALIBRATED_STABLE_BOUNDARY_THRESHOLDS
    )
    : unevaluatedBoundary("top");
  const description = descriptionRect
    ? analyzePixelRegion(
      data,
      imageWidth,
      imageHeight,
      channels,
      insetNormalizedRect(descriptionRect, 0.04),
      DEFAULT_VISUAL_THRESHOLDS
    )
    : null;
  const descriptionBoundary = descriptionRect
    ? analyzeHorizontalBoundary(
      data,
      imageWidth,
      imageHeight,
      channels,
      descriptionRect,
      "top",
      CALIBRATED_STABLE_BOUNDARY_THRESHOLDS
    )
    : null;
  // Suggestions starts only a few points below Description. A tight search at
  // its invariant top edge avoids both the nearby Description fill edge and a
  // false loss while query updates legitimately change the overlay height.
  const overlayBoundary = overlayRect
    ? analyzeHorizontalBoundary(
      data,
      imageWidth,
      imageHeight,
      channels,
      overlayRect,
      "top",
      OVERLAY_BOUNDARY_THRESHOLDS
    )
    : null;

  return {
    calibratedOverlayEvaluated: Boolean(overlayRect && overlayBoundary?.evaluated),
    calibratedOverlayExpected: Boolean(overlayRect),
    calibratedOverlayPresent: overlayRect && overlayBoundary
      ? overlayBoundary.landmarkPresent
      : overlayRect ? null : null,
    calibratedSheetEvaluated: Boolean(sheetBoundary.evaluated && descriptionBoundary?.evaluated),
    calibratedSheetExpected: true,
    calibratedSheetPresent: sheetBoundary.evaluated && descriptionBoundary?.evaluated
      ? sheetBoundary.landmarkPresent && descriptionBoundary.landmarkPresent
      : null,
    description,
    descriptionBoundary,
    overlayBoundary,
    sheetBoundary
  };
}

export function applyTemporalVisualContinuity(frames) {
  const groups = new Map();
  for (const frame of frames) {
    if (!["entrance", "exit", "expected_update"].includes(frame.visualPhase)) continue;
    if (!Number.isSafeInteger(frame.visualSheetSegmentIndex)) continue;
    const values = groups.get(frame.visualSheetSegmentIndex) ?? [];
    values.push(frame);
    groups.set(frame.visualSheetSegmentIndex, values);
  }

  for (const values of groups.values()) {
    values.sort((left, right) => left.timestampMs - right.timestampMs);
    const phase = values[0]?.visualPhase;
    const intervalIndex = values[0]?.visualCalibrationIntervalIndex;
    const stableFrames = frames.filter((frame) =>
      frame.visualCalibrationIntervalIndex === intervalIndex &&
      frame.visualPhase === "stable" &&
      frame.calibratedSheetEvaluated &&
      frame.calibratedSheetPresent
    ).sort((left, right) => left.timestampMs - right.timestampMs);
    const reference = phase === "entrance" || phase === "expected_update"
      ? stableFrames.find((frame) => frame.timestampMs >= values.at(-1).timestampMs) ?? null
      : [...stableFrames].reverse().find((frame) => frame.timestampMs <= values[0].timestampMs) ?? null;
    const ordered = phase === "entrance" ? [...values].reverse() : values;
    let expectedTop = ordered[0]?.transitionFinalTop ?? null;
    for (const frame of ordered) {
      const candidates = frame._transitionCandidates ?? [];
      if (frame._transitionCalibrationEvaluated === false || !reference) {
        const overlayExpected = frame._transitionOverlayExpected === true;
        frame.calibratedOverlayEvaluated = false;
        frame.calibratedOverlayExpected = overlayExpected;
        frame.calibratedOverlayPresent = null;
        frame.calibratedSheetEvaluated = false;
        frame.calibratedSheetPresent = null;
        frame.transitionCandidateCount = 0;
        frame.transitionDirection = phase;
        frame.transitionTrackedTop = null;
        delete frame._transitionCalibrationEvaluated;
        delete frame._transitionCandidates;
        delete frame._transitionOverlayExpected;
        continue;
      }
      const directionTolerance = 2 / Math.max(1, frame.analysisHeight ?? frame.height ?? 1);
      const appearanceMatched = candidates.filter((candidate) =>
        transitionCandidateMatchesReference(candidate, reference)
      );
      const eligible = Number.isFinite(expectedTop) && phase !== "expected_update"
        ? appearanceMatched.filter((candidate) => candidate.top >= expectedTop - directionTolerance)
        : appearanceMatched;
      const selected = eligible.sort((left, right) => {
        const leftDistance = Number.isFinite(expectedTop) ? Math.abs(left.top - expectedTop) : 0;
        const rightDistance = Number.isFinite(expectedTop) ? Math.abs(right.top - expectedTop) : 0;
        return leftDistance - rightDistance || right.score - left.score;
      })[0] ?? null;
      frame.calibratedSheetEvaluated = true;
      frame.calibratedSheetPresent = Boolean(selected);
      frame.calibratedOverlayExpected = frame._transitionOverlayExpected === true;
      frame.calibratedOverlayEvaluated = Boolean(
        selected && frame.calibratedOverlayExpected && selected.overlayBoundary?.evaluated
      );
      frame.calibratedOverlayPresent = frame.calibratedOverlayExpected
        ? frame.calibratedOverlayEvaluated
          ? selected.overlayBoundary.landmarkPresent
          : null
        : null;
      frame.descriptionBoundary = selected?.descriptionBoundary ?? null;
      frame.overlayBoundary = selected?.overlayBoundary ?? null;
      frame.sheetBoundary = selected?.sheetBoundary ?? null;
      frame.transitionCandidateCount = candidates.length;
      frame.transitionDirection = phase;
      frame.transitionTrackedTop = selected?.top ?? null;
      if (selected) expectedTop = selected.top;
      delete frame._transitionCalibrationEvaluated;
      delete frame._transitionCandidates;
      delete frame._transitionOverlayExpected;
    }
  }
  attachFrameVisualTracks(frames);
  return frames;
}

export function attachFrameVisualTracks(frames) {
  for (const frame of frames) {
    const screenHeight = Number(frame.visualScreenHeight);
    const analysisHeight = Number(frame.analysisHeight);
    if (!(screenHeight > 0) || !(analysisHeight > 0) || !frame.calibratedSheetPresent) {
      frame.visualAnchorTrack = null;
      frame.visualPointPerAnalysisPixel = null;
      continue;
    }
    frame.visualPointPerAnalysisPixel = screenHeight / analysisHeight;
    const toScreenPoint = (sampleY) => Number.isFinite(sampleY)
      ? sampleY / analysisHeight * screenHeight
      : null;
    const sheetTop = ["entrance", "exit", "expected_update"].includes(frame.visualPhase)
      ? Number.isFinite(frame.transitionTrackedTop) ? frame.transitionTrackedTop * screenHeight : null
      : toScreenPoint(frame.sheetBoundary?.sampleY);
    const descriptionTop = toScreenPoint(frame.descriptionBoundary?.sampleY);
    const overlayTop = frame.calibratedOverlayExpected === true &&
      frame.calibratedOverlayPresent === true
      ? toScreenPoint(frame.overlayBoundary?.sampleY)
      : null;
    if (!Number.isFinite(sheetTop) || !Number.isFinite(descriptionTop)) {
      frame.visualAnchorTrack = null;
      continue;
    }
    frame.visualAnchorTrack = {
      descriptionTop,
      overlayTop,
      sheetTop
    };
  }
  return frames;
}

export function calculateFrameVisualDeltas(frames) {
  const deltas = [];
  const ordered = [...frames].sort((left, right) =>
    left.frameIndex - right.frameIndex || left.timestampMs - right.timestampMs
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (current.frameIndex !== previous.frameIndex + 1) continue;
    if (
      !Number.isSafeInteger(previous.visualCalibrationIntervalIndex) ||
      previous.visualCalibrationIntervalIndex !== current.visualCalibrationIntervalIndex
    ) continue;

    let exclusionReason = null;
    let comparisonMode = null;
    if (!previous.visualAnchorTrack || !current.visualAnchorTrack) {
      exclusionReason = "missing_visual_anchor";
    } else {
      const phases = [previous.visualPhase, current.visualPhase];
      const expectedUpdatePair = phases.includes("expected_update") &&
        phases.every((phase) => phase === "stable" || phase === "expected_update");
      const recordedKeyboardBoundary = phases.every((phase) => phase === "stable") &&
        previous.visualKeyboardState !== current.visualKeyboardState &&
        Number.isFinite(previous.visualKeyboardInset) &&
        Number.isFinite(current.visualKeyboardInset);
      if (expectedUpdatePair || recordedKeyboardBoundary) {
        // Keyboard motion may translate/resize the entire sheet. Comparing
        // Description−sheet and Suggestions−Description removes that expected
        // owner displacement while retaining a strict raw two-point gate for
        // internal jitter, opacity hand-off jumps, or a second geometry owner.
        comparisonMode = "relative_internal_anchors";
      } else if (phases.every((phase) => phase === "stable")) {
        if (previous.visualKeyboardState === current.visualKeyboardState) {
          comparisonMode = "absolute_screen_anchors";
        } else {
          exclusionReason = "expected_keyboard_layout_change_without_inset";
        }
      } else {
        exclusionReason = "expected_presentation_motion";
      }
    }
    const anchorDeltas = {};
    const rawAnchorDeltas = {};
    const relativeAnchorDeltas = {};
    const requiredOverlayAnchorFrameIndexes = [];
    const missingRequiredOverlayAnchorFrameIndexes = [];
    const analysisResolution = Math.max(
      Number(previous.visualPointPerAnalysisPixel) || 0,
      Number(current.visualPointPerAnalysisPixel) || 0
    );
    if (!exclusionReason && comparisonMode === "absolute_screen_anchors") {
      for (const key of ["sheetTop", "descriptionTop", "overlayTop"]) {
        const left = previous.visualAnchorTrack[key];
        const right = current.visualAnchorTrack[key];
        if (Number.isFinite(left) && Number.isFinite(right)) {
          rawAnchorDeltas[key] = Math.abs(right - left);
          // The contract is an absolute two-screen-point limit. Subtracting a
          // whole analysis pixel made a real 3–4 point jump pass at the
          // default 192px analysis width. Keep the detector resolution in the
          // report, but evaluate the unmodified screen-point displacement.
          anchorDeltas[key] = rawAnchorDeltas[key];
        }
      }
      if (!Number.isFinite(anchorDeltas.sheetTop) || !Number.isFinite(anchorDeltas.descriptionTop)) {
        exclusionReason = "missing_required_visual_anchor";
      }
    } else if (!exclusionReason && comparisonMode === "relative_internal_anchors") {
      const previousDescriptionOffset =
        previous.visualAnchorTrack.descriptionTop - previous.visualAnchorTrack.sheetTop;
      const currentDescriptionOffset =
        current.visualAnchorTrack.descriptionTop - current.visualAnchorTrack.sheetTop;
      if (Number.isFinite(previousDescriptionOffset) && Number.isFinite(currentDescriptionOffset)) {
        relativeAnchorDeltas.descriptionFromSheet = Math.abs(
          currentDescriptionOffset - previousDescriptionOffset
        );
      }
      const previousOverlayOffset = Number.isFinite(previous.visualAnchorTrack.overlayTop)
        ? previous.visualAnchorTrack.overlayTop - previous.visualAnchorTrack.descriptionTop
        : null;
      const currentOverlayOffset = Number.isFinite(current.visualAnchorTrack.overlayTop)
        ? current.visualAnchorTrack.overlayTop - current.visualAnchorTrack.descriptionTop
        : null;
      if (Number.isFinite(previousOverlayOffset) && Number.isFinite(currentOverlayOffset)) {
        relativeAnchorDeltas.overlayFromDescription = Math.abs(
          currentOverlayOffset - previousOverlayOffset
        );
      }
      for (const frame of [previous, current]) {
        if (frame.calibratedOverlayExpected !== true) continue;
        requiredOverlayAnchorFrameIndexes.push(frame.frameIndex);
        if (
          frame.calibratedOverlayPresent !== true ||
          !Number.isFinite(frame.visualAnchorTrack?.overlayTop)
        ) {
          missingRequiredOverlayAnchorFrameIndexes.push(frame.frameIndex);
        }
      }
      Object.assign(anchorDeltas, relativeAnchorDeltas);
      if (!Number.isFinite(relativeAnchorDeltas.descriptionFromSheet)) {
        exclusionReason = "missing_required_relative_anchor";
      } else if (missingRequiredOverlayAnchorFrameIndexes.length > 0) {
        exclusionReason = "missing_required_selected_overlay_anchor";
      } else if (
        previous.calibratedOverlayExpected === true &&
        current.calibratedOverlayExpected === true &&
        !Number.isFinite(relativeAnchorDeltas.overlayFromDescription)
      ) {
        exclusionReason = "missing_required_relative_overlay_anchor";
      }
    }
    const previousKeyboardInset = Number.isFinite(previous.visualKeyboardInset)
      ? previous.visualKeyboardInset
      : null;
    const currentKeyboardInset = Number.isFinite(current.visualKeyboardInset)
      ? current.visualKeyboardInset
      : null;
    const recordedKeyboardInsetDelta = previousKeyboardInset !== null && currentKeyboardInset !== null
      ? currentKeyboardInset - previousKeyboardInset
      : null;
    const signedSheetDisplacement = previous.visualAnchorTrack && current.visualAnchorTrack
      ? current.visualAnchorTrack.sheetTop - previous.visualAnchorTrack.sheetTop
      : null;
    deltas.push({
      anchorDeltas,
      comparisonMode,
      currentFrameIndex: current.frameIndex,
      currentTimeMs: current.timestampMs,
      currentKeyboardInset,
      eligibleForJumpCheck: exclusionReason === null,
      exclusionReason,
      maximumAnchorDelta: exclusionReason === null
        ? Math.max(...Object.values(anchorDeltas))
        : null,
      previousFrameIndex: previous.frameIndex,
      previousTimeMs: previous.timestampMs,
      previousKeyboardInset,
      presentationIntervalIndex: current.visualCalibrationIntervalIndex,
      analysisResolution,
      quantizationAllowance: 0,
      rawAnchorDeltas,
      recordedKeyboardInsetDelta,
      relativeAnchorDeltas,
      requiredOverlayAnchorFrameIndexes,
      missingRequiredOverlayAnchorFrameIndexes,
      signedSheetDisplacement,
      sheetDisplacementAfterRecordedKeyboardDelta:
        Number.isFinite(signedSheetDisplacement) && Number.isFinite(recordedKeyboardInsetDelta)
          ? signedSheetDisplacement + recordedKeyboardInsetDelta
          : null
    });
  }
  return deltas;
}

function transitionCandidateMatchesReference(candidate, reference) {
  const sheetDistance = rgbDistance(
    candidate.sheetBoundary?.afterMeanRgb,
    reference.sheetBoundary?.afterMeanRgb
  );
  if (sheetDistance === null || sheetDistance > MAX_TRANSITION_BOUNDARY_COLOUR_DISTANCE) return false;
  if (!candidate.descriptionBoundary) return true;
  const descriptionDistance = rgbDistance(
    candidate.descriptionBoundary.afterMeanRgb,
    reference.descriptionBoundary?.afterMeanRgb
  );
  return descriptionDistance !== null &&
    descriptionDistance <= MAX_TRANSITION_BOUNDARY_COLOUR_DISTANCE;
}

function rgbDistance(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length < 3 || right.length < 3) return null;
  return Math.sqrt(
    ((left[0] - right[0]) ** 2 +
      (left[1] - right[1]) ** 2 +
      (left[2] - right[2]) ** 2) / 3
  );
}

function analyzeTransitionalVisualFrame(data, imageWidth, imageHeight, channels, calibration) {
  const sheetRect = screenRectToNormalizedRect(
    calibration.sheetRect,
    calibration.sheetRect,
    imageWidth,
    imageHeight,
    calibration.screenAppRect
  );
  const descriptionRect = screenRectToNormalizedRect(
    calibration.descriptionRect,
    calibration.sheetRect,
    imageWidth,
    imageHeight,
    calibration.screenAppRect
  );
  const overlayRect = screenRectToNormalizedRect(
    calibration.overlayRect,
    calibration.sheetRect,
    imageWidth,
    imageHeight,
    calibration.screenAppRect
  );
  if (!sheetRect || !descriptionRect) {
    return {
      _transitionCandidates: [],
      _transitionCalibrationEvaluated: false,
      _transitionOverlayExpected: Boolean(overlayRect),
      calibratedOverlayEvaluated: false,
      calibratedOverlayExpected: false,
      calibratedOverlayPresent: null,
      calibratedSheetEvaluated: false,
      calibratedSheetExpected: true,
      calibratedSheetPresent: null,
      description: null,
      descriptionBoundary: null,
      overlayBoundary: null,
      sheetBoundary: null,
      transitionFinalTop: sheetRect?.y ?? null
    };
  }

  const candidates = [];
  const descriptionOffset = descriptionRect.y - sheetRect.y;
  const overlayOffset = overlayRect ? overlayRect.y - sheetRect.y : null;
  const firstY = Math.max(2, Math.floor(sheetRect.y * imageHeight) - 2);
  const lastY = imageHeight - 3;
  for (let pixelY = firstY; pixelY <= lastY; pixelY += 1) {
    const top = pixelY / imageHeight;
    const movingSheetRect = {
      x: sheetRect.x,
      y: top,
      width: sheetRect.width,
      height: Math.max(1 / imageHeight, 1 - top)
    };
    const sheetBoundary = analyzeHorizontalBoundary(
      data,
      imageWidth,
      imageHeight,
      channels,
      movingSheetRect,
      "top",
      TRANSITION_BOUNDARY_THRESHOLDS
    );
    if (!sheetBoundary.landmarkPresent) continue;

    const movingDescriptionTop = top + descriptionOffset;
    const descriptionInFrame = movingDescriptionTop >= 0 &&
      movingDescriptionTop + descriptionRect.height <= 1;
    const descriptionBoundary = descriptionInFrame
      ? analyzeHorizontalBoundary(
        data,
        imageWidth,
        imageHeight,
        channels,
        { ...descriptionRect, y: movingDescriptionTop },
        "top",
        TRANSITION_BOUNDARY_THRESHOLDS
      )
      : null;
    if (descriptionInFrame && !descriptionBoundary?.landmarkPresent) continue;
    const movingOverlayTop = Number.isFinite(overlayOffset) ? top + overlayOffset : null;
    const overlayInFrame = overlayRect && Number.isFinite(movingOverlayTop) &&
      movingOverlayTop >= 0 && movingOverlayTop + overlayRect.height <= 1;
    const overlayBoundary = overlayInFrame
      ? analyzeHorizontalBoundary(
        data,
        imageWidth,
        imageHeight,
        channels,
        { ...overlayRect, y: movingOverlayTop },
        "top",
        DEFAULT_BOUNDARY_THRESHOLDS
      )
      : null;
    candidates.push({
      descriptionBoundary,
      overlayBoundary,
      score: (sheetBoundary.score ?? 0) + (descriptionBoundary?.score ?? 0),
      sheetBoundary,
      top
    });
  }

  return {
    _transitionCandidates: candidates,
    _transitionCalibrationEvaluated: true,
    _transitionOverlayExpected: Boolean(overlayRect),
    // Transitional analysis can find several plausible horizontal-edge
    // candidates. Overlay evidence becomes meaningful only after temporal
    // tracking selects the candidate owned by the sheet/Description pair.
    // Publishing an any-candidate result here lets an unrelated lower edge
    // stand in for a missing Suggestions surface on the selected sheet.
    calibratedOverlayEvaluated: false,
    calibratedOverlayExpected: Boolean(overlayRect),
    calibratedOverlayPresent: null,
    calibratedSheetEvaluated: true,
    calibratedSheetExpected: true,
    calibratedSheetPresent: candidates.length > 0,
    description: null,
    descriptionBoundary: null,
    overlayBoundary: null,
    sheetBoundary: null,
    transitionFinalTop: sheetRect.y
  };
}

export function normalizedRoiToPixelBounds(roi, imageWidth, imageHeight) {
  const x = Math.max(0, Math.min(imageWidth - 1, Math.floor(roi.x * imageWidth)));
  const y = Math.max(0, Math.min(imageHeight - 1, Math.floor(roi.y * imageHeight)));
  const maximumWidth = imageWidth - x;
  const maximumHeight = imageHeight - y;
  const width = Math.max(1, Math.min(maximumWidth, Math.ceil(roi.width * imageWidth)));
  const height = Math.max(1, Math.min(maximumHeight, Math.ceil(roi.height * imageHeight)));
  return { x, y, width, height };
}

export function parseNdjson(text, source = "telemetry.ndjson") {
  const records = [];
  const lines = String(text).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`${source}:${index + 1} is not valid JSON: ${error.message}`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${source}:${index + 1} must contain one JSON object.`);
    }
    records.push({ ...value, _line: index + 1, _sequence: records.length });
  }
  return records;
}

export function analyzeTelemetry(records, options = {}) {
  const frameTimestampsMs = options.frameTimestampsMs ?? [];
  const timing = resolveTelemetryTiming(records, {
    eventTimeOriginMs: options.eventTimeOriginMs,
    frameTimestampsMs
  });
  const measurements = extractGeometryMeasurements(records, {
    frameTimestampsMs,
    originMs: timing.originMs
  });
  const geometryDeltas = calculateGeometryDeltas(measurements);
  const counters = countTelemetryGuardrailEvents(records);
  const committedExits = resolveCommittedExits(records, {
    explicitCommittedExitMs: options.committedExitMs,
    frameTimestampsMs,
    originMs: timing.originMs
  });
  const presentationIntervals = resolvePresentationIntervals(records, committedExits, {
    frameTimestampsMs,
    originMs: timing.originMs
  });
  const visualCalibration = resolveVisualCalibration(records, presentationIntervals, {
    frameTimestampsMs,
    originMs: timing.originMs
  });
  const committedExit = committedExits.at(-1) ?? null;

  return {
    committedExit,
    committedExits,
    counters,
    geometryDeltas,
    measurements,
    presentationIntervals,
    recordCount: records.length,
    timing,
    visualCalibration
  };
}

export function resolveVisualCalibration(
  records,
  presentationIntervals,
  { frameTimestampsMs = [], originMs = null } = {}
) {
  const events = records.map((record) => ({
    descriptionRect: measuredRectValue(record, "screenDescriptionRect"),
    expectedOverlayExit: expectedTelemetryMarker(record, "expectedOverlayExit"),
    expectedTransition: expectedTelemetryMarker(record, "expectedTransition") ||
      expectedTelemetryMarker(record, "expectedSheetTransition"),
    exitStarted: expectedTelemetryMarker(record, "exitStarted") ||
      /sheet[_ -]?exit[_ -]?started/i.test(telemetryType(record)),
    externalInterruption: /(background|foreground|\bhome\b)/i.test(
      `${telemetryType(record)} ${String(record.step ?? "")}`
    ),
    keyboardLayout: extractKeyboardLayout(record),
    line: record._line ?? null,
    overlayRect: measuredRectValue(record, "screenOverlayRect"),
    openStarted: expectedTelemetryMarker(record, "openStarted") ||
      /sheet[_ -]?open[_ -]?started/i.test(telemetryType(record)),
    presentationId: telemetryPresentationId(record),
    runId: telemetryRunId(record),
    screenAppRect: measuredRectValue(record, "screenAppRect"),
    sequence: record._sequence ?? 0,
    settled: geometryIsSettled(record, geometryPhase(record)),
    sheetRect: measuredRectValue(record, "screenSheetRect"),
    timeMs: telemetryVideoTimeMs(record, { frameTimestampsMs, originMs })
  })).filter((event) => Number.isFinite(event.timeMs));

  const sheetSegments = [];
  const overlaySegments = [];
  const samples = [];
  for (const interval of presentationIntervals) {
    const intervalEvents = events.filter((event) =>
      event.runId === interval.runId &&
      event.timeMs >= (Number.isFinite(interval.startTimeMs) ? interval.startTimeMs : Number.NEGATIVE_INFINITY) &&
      event.timeMs < interval.endTimeMs &&
      presentationIdsAreCompatible(event.presentationId, interval.presentationId)
    ).sort((left, right) => left.timeMs - right.timeMs || left.sequence - right.sequence);
    let activeSheet = null;
    let activeOverlay = null;
    let firstStableEvent = null;
    let lastStableEvent = null;
    let pendingExpectedTransition = null;

    const closeSheet = (endTimeMs, reason) => {
      if (!activeSheet) return;
      addVisualSegment(sheetSegments, activeSheet, endTimeMs, reason);
      activeSheet = null;
    };
    const closeOverlay = (endTimeMs, reason) => {
      if (!activeOverlay) return;
      addVisualSegment(overlaySegments, activeOverlay, endTimeMs, reason);
      activeOverlay = null;
    };

    for (const event of intervalEvents) {
      if (event.exitStarted) {
        closeSheet(event.timeMs, "exit_started");
        closeOverlay(event.timeMs, "exit_started");
        const exitCalibration = event.sheetRect ? event : lastStableEvent;
        if (exitCalibration?.sheetRect) {
          activeSheet = visualSegmentStart(exitCalibration, interval, {
            descriptionRect: exitCalibration.descriptionRect,
            keyboardLayout: exitCalibration.keyboardLayout,
            phase: "exit",
            screenAppRect: exitCalibration.screenAppRect,
            sheetRect: exitCalibration.sheetRect,
            startTimeMs: event.timeMs
          });
        }
        continue;
      }
      if (event.expectedTransition) {
        closeSheet(event.timeMs, "expected_transition");
        closeOverlay(event.timeMs, "expected_transition");
        pendingExpectedTransition = event.externalInterruption ? null : event;
        continue;
      }
      if (event.expectedOverlayExit) {
        closeOverlay(event.timeMs, "expected_overlay_exit");
      }
      if (!event.settled || !event.sheetRect) continue;

      firstStableEvent ??= event;
      lastStableEvent = event;

      if (pendingExpectedTransition && pendingExpectedTransition.timeMs < event.timeMs) {
        const expectedUpdateStartTimeMs = pendingExpectedTransition.timeMs;
        sheetSegments.push({
          ...visualSegmentStart(event, interval, {
            descriptionRect: event.descriptionRect,
            keyboardLayout: event.keyboardLayout,
            overlayRect: event.overlayRect,
            phase: "expected_update",
            screenAppRect: event.screenAppRect,
            sheetRect: event.sheetRect,
            startTimeMs: expectedUpdateStartTimeMs
          }),
          endReason: "next_stable_calibration",
          endTimeMs: event.timeMs
        });
        // The next settled sample is already the calibration source for the
        // in-flight expected update. Preserve its Suggestions rectangle as a
        // first-class overlay segment too, rather than leaving those decoded
        // frames with an inline rect but no segment identity or diagnostics.
        if (event.overlayRect) {
          overlaySegments.push({
            ...visualSegmentStart(event, interval, {
              overlayRect: event.overlayRect,
              phase: "expected_update",
              screenAppRect: event.screenAppRect,
              sheetRect: event.sheetRect,
              startTimeMs: expectedUpdateStartTimeMs
            }),
            endReason: "next_stable_calibration",
            endTimeMs: event.timeMs
          });
        }
        pendingExpectedTransition = null;
      }

      closeSheet(event.timeMs, "next_stable_calibration");
      activeSheet = visualSegmentStart(event, interval, {
        descriptionRect: event.descriptionRect,
        keyboardLayout: event.keyboardLayout,
        phase: "stable",
        screenAppRect: event.screenAppRect,
        sheetRect: event.sheetRect
      });
      samples.push({
        descriptionRect: event.descriptionRect,
        intervalIndex: interval.index,
        line: event.line,
        overlayRect: event.overlayRect,
        presentationId: interval.presentationId,
        runId: interval.runId,
        screenAppRect: event.screenAppRect,
        sheetRect: event.sheetRect,
        timeMs: event.timeMs
      });

      if (event.overlayRect && !event.expectedOverlayExit) {
        closeOverlay(event.timeMs, "next_stable_calibration");
        activeOverlay = visualSegmentStart(event, interval, {
          overlayRect: event.overlayRect,
          screenAppRect: event.screenAppRect,
          sheetRect: event.sheetRect
        });
      } else if (!event.overlayRect) {
        closeOverlay(event.timeMs, "stable_overlay_absent");
      }
    }
    closeSheet(interval.endTimeMs, interval.endSource ?? "committed_exit");
    closeOverlay(interval.endTimeMs, interval.endSource ?? "committed_exit");

    if (
      firstStableEvent?.sheetRect &&
      interval.startSource === "open_started" &&
      Number.isFinite(interval.startTimeMs) &&
      interval.startTimeMs < firstStableEvent.timeMs
    ) {
      sheetSegments.push({
        ...visualSegmentStart(firstStableEvent, interval, {
          descriptionRect: firstStableEvent.descriptionRect,
          keyboardLayout: firstStableEvent.keyboardLayout,
          phase: "entrance",
          screenAppRect: firstStableEvent.screenAppRect,
          sheetRect: firstStableEvent.sheetRect,
          startTimeMs: interval.startTimeMs
        }),
        endReason: "first_stable_calibration",
        endTimeMs: firstStableEvent.timeMs
      });
    }
  }

  sheetSegments.sort((left, right) =>
    left.startTimeMs - right.startTimeMs || left.endTimeMs - right.endTimeMs
  );
  overlaySegments.sort((left, right) =>
    left.startTimeMs - right.startTimeMs || left.endTimeMs - right.endTimeMs
  );

  sheetSegments.forEach((segment, index) => { segment.segmentIndex = index; });
  overlaySegments.forEach((segment, index) => { segment.segmentIndex = index; });

  const calibratedPresentationIndexes = [...new Set(
    sheetSegments.map((segment) => segment.intervalIndex)
  )].sort((left, right) => left - right);
  const missingPresentationIndexes = presentationIntervals
    .map((interval) => interval.index)
    .filter((index) => !calibratedPresentationIndexes.includes(index));
  const missingOpenPresentationIndexes = presentationIntervals
    .filter((interval) => interval.startSource !== "open_started")
    .map((interval) => interval.index);
  return {
    calibratedPresentationIndexes,
    missingPresentationIndexes,
    missingOpenPresentationIndexes,
    overlaySegments,
    sampleCount: samples.length,
    samples,
    sheetSegments
  };
}

export function visualCalibrationForFrame(frame, visualCalibration) {
  if (!Number.isFinite(frame?.timestampMs) || !visualCalibration) return null;
  const sheetSegment = visualCalibration.sheetSegments.find((segment) =>
    frame.timestampMs >= segment.startTimeMs && frame.timestampMs < segment.endTimeMs
  );
  if (!sheetSegment) return null;
  const overlaySegment = visualCalibration.overlaySegments.find((segment) =>
    segment.intervalIndex === sheetSegment.intervalIndex &&
    frame.timestampMs >= segment.startTimeMs && frame.timestampMs < segment.endTimeMs
  );
  return {
    descriptionRect: sheetSegment.descriptionRect,
    intervalIndex: sheetSegment.intervalIndex,
    keyboardLayout: sheetSegment.keyboardLayout,
    overlayRect: overlaySegment?.overlayRect ?? sheetSegment.overlayRect ?? null,
    overlaySegmentIndex: overlaySegment?.segmentIndex ?? null,
    presentationId: sheetSegment.presentationId,
    runId: sheetSegment.runId,
    screenAppRect: sheetSegment.screenAppRect,
    sheetRect: sheetSegment.sheetRect,
    visualPhase: sheetSegment.phase ?? "stable",
    sheetSegmentIndex: sheetSegment.segmentIndex,
    sheetSegmentLine: sheetSegment.line,
    overlaySegmentLine: overlaySegment?.line ?? null
  };
}

export function resolveTelemetryTiming(records, { eventTimeOriginMs, frameTimestampsMs = [] } = {}) {
  if (Number.isFinite(eventTimeOriginMs)) {
    return { originMs: Number(eventTimeOriginMs), originSource: "cli" };
  }

  for (const record of records) {
    const explicit = firstFinite(
      record.recordingStartTimestampMs,
      record.recordingStartedAtMs,
      record.recordingStartMs,
      record.sessionStartTimestampMs,
      nestedValue(record, "recording.startTimestampMs")
    );
    if (explicit !== null) return { originMs: explicit, originSource: `ndjson:${record._line}` };
  }

  for (const record of records) {
    const type = telemetryType(record);
    if (!/(recording|session).*(start|begin)|(start|begin).*(recording|session)/i.test(type)) continue;
    const absolute = absoluteTimestampMs(record);
    const relative = relativeTimestampMs(record, frameTimestampsMs);
    if (absolute !== null && relative !== null) {
      return {
        originMs: absolute - relative,
        originSource: `ndjson:${record._line}`
      };
    }
    if (absolute !== null) {
      return { originMs: absolute, originSource: `ndjson:${record._line}` };
    }
  }

  const absoluteValues = records.map(absoluteTimestampMs).filter((value) => value !== null);
  if (absoluteValues.length > 0) {
    return {
      originMs: Math.min(...absoluteValues),
      originSource: "inferred-first-absolute-event"
    };
  }

  return { originMs: null, originSource: null };
}

export function extractGeometryMeasurements(
  records,
  { frameTimestampsMs = [], originMs = null } = {}
) {
  const measurements = [];
  for (const record of records) {
    const rects = findMeasuredRects(record);
    if (rects.length === 0) continue;
    const presentationId = firstDefined(
      record.presentationId,
      nestedValue(record, "presentation.id"),
      nestedValue(record, "state.presentationId"),
      nestedValue(record, "details.presentationId"),
      null
    );
    const runId = telemetryRunId(record);
    const phase = geometryPhase(record);
    const settled = geometryIsSettled(record, phase);
    const eligibleForJumpCheck = geometryIsEligibleForJumpCheck(record, phase);
    const coordinateSpace = String(firstDefined(
      record.geometryCoordinateSpace,
      nestedValue(record, "geometry.coordinateSpace"),
      nestedValue(record, "state.geometryCoordinateSpace"),
      "window"
    ));
    const keyboardLayout = extractKeyboardLayout(record);
    const keyboardCompensation = coordinateSpace === "sheet_local"
      ? { x: 0, y: 0, width: 0, height: 0 }
      : extractKeyboardCompensation(record);
    const videoTimeMs = telemetryVideoTimeMs(record, { frameTimestampsMs, originMs });
    const frameIndex = normalizedFrameIndex(record, frameTimestampsMs.length);

    for (const { name, rect } of rects) {
      const correctedRect = Object.fromEntries(
        RECT_KEYS.map((key) => [key, rect[key] + keyboardCompensation[key]])
      );
      measurements.push({
        correctedRect,
        coordinateSpace,
        eligibleForJumpCheck,
        frameIndex,
        keyboardCompensation,
        keyboardLayout,
        line: record._line ?? null,
        phase,
        presentationId,
        rect,
        rectName: name,
        runId,
        sequence: record._sequence ?? measurements.length,
        settled,
        videoTimeMs
      });
    }
  }
  return measurements;
}

export function calculateGeometryDeltas(measurements) {
  const groups = new Map();
  for (const measurement of measurements) {
    const key = `${measurement.runId}::${String(measurement.presentationId ?? "unknown")}::${measurement.rectName}`;
    const values = groups.get(key) ?? [];
    values.push(measurement);
    groups.set(key, values);
  }

  const deltas = [];
  for (const values of groups.values()) {
    values.sort(compareMeasurements);
    for (let index = 1; index < values.length; index += 1) {
      const previous = values[index - 1];
      const current = values[index];
      const rawDelta = rectDelta(previous.rect, current.rect);
      const compensatedDelta = rectDelta(previous.correctedRect, current.correctedRect);
      const equivalentLayout = geometryLayoutsAreEquivalent(previous, current);
      deltas.push({
        compensatedDelta,
        compensatedMaxDelta: maximumRectDelta(compensatedDelta),
        currentFrameIndex: current.frameIndex,
        currentLine: current.line,
        currentTimeMs: current.videoTimeMs,
        coordinateSpace: current.coordinateSpace,
        eligibleForJumpCheck: equivalentLayout &&
          previous.eligibleForJumpCheck && current.eligibleForJumpCheck,
        equivalentLayout,
        phase: current.phase,
        presentationId: current.presentationId,
        previousFrameIndex: previous.frameIndex,
        previousLine: previous.line,
        previousTimeMs: previous.videoTimeMs,
        rawDelta,
        rawMaxDelta: maximumRectDelta(rawDelta),
        rectName: current.rectName,
        runId: current.runId,
        settledPair: equivalentLayout && previous.settled && current.settled
      });
    }
  }
  return deltas.sort((left, right) => {
    const leftTime = left.currentTimeMs ?? Number.POSITIVE_INFINITY;
    const rightTime = right.currentTimeMs ?? Number.POSITIVE_INFINITY;
    return leftTime - rightTime || (left.currentLine ?? 0) - (right.currentLine ?? 0);
  });
}

export function countTelemetryGuardrailEvents(records) {
  let declaredDuplicateMutationCount = 0;
  let declaredStaleCallbackCount = 0;
  let duplicateMutationCounterObservationCount = 0;
  let mutationLifecycleCounterObservationCount = 0;
  let staleCallbackCounterObservationCount = 0;
  const duplicateMutationLines = new Set();
  const staleCallbackLines = new Set();
  const activeMutations = new Map();
  const seenMutationKeys = new Set();

  for (const record of records) {
    const type = telemetryType(record);
    const line = record._line ?? record._sequence ?? 0;
    const observedStaleCallbackCount = firstFinite(
      record.staleCallbackCount,
      nestedValue(record, "counters.staleCallbackCount"),
      nestedValue(record, "counters.staleCallbacks"),
      nestedValue(record, "state.staleCallbackCount")
    );
    if (observedStaleCallbackCount !== null) {
      staleCallbackCounterObservationCount += 1;
      declaredStaleCallbackCount = Math.max(
        declaredStaleCallbackCount,
        observedStaleCallbackCount
      );
    }
    const observedDuplicateMutationCount = firstFinite(
      record.duplicateMutationCount,
      nestedValue(record, "counters.duplicateMutationCount"),
      nestedValue(record, "counters.duplicateMutations"),
      nestedValue(record, "state.duplicateMutationCount")
    );
    if (observedDuplicateMutationCount !== null) {
      duplicateMutationCounterObservationCount += 1;
      declaredDuplicateMutationCount = Math.max(
        declaredDuplicateMutationCount,
        observedDuplicateMutationCount
      );
    }
    const mutationLifecycleCounters = [
      firstFinite(
        record.mutationAttemptCount,
        nestedValue(record, "counters.mutationAttemptCount"),
        nestedValue(record, "state.mutationAttemptCount")
      ),
      firstFinite(
        record.mutationStartedCount,
        nestedValue(record, "counters.mutationStartedCount"),
        nestedValue(record, "state.mutationStartedCount")
      ),
      firstFinite(
        record.mutationRejectedCount,
        nestedValue(record, "counters.mutationRejectedCount"),
        nestedValue(record, "state.mutationRejectedCount")
      ),
      firstFinite(
        record.mutationFinishedCount,
        nestedValue(record, "counters.mutationFinishedCount"),
        nestedValue(record, "state.mutationFinishedCount")
      )
    ];
    if (mutationLifecycleCounters.every((value) => value !== null)) {
      mutationLifecycleCounterObservationCount += 1;
    }

    const staleCallback =
      record.staleCallback === true ||
      nestedValue(record, "guardrail.staleCallback") === true ||
      /stale[_ -]?callback/i.test(type) ||
      (/callback/i.test(type) && record.stale === true);
    if (staleCallback) staleCallbackLines.add(line);

    const explicitDuplicate =
      record.duplicateMutation === true ||
      nestedValue(record, "guardrail.duplicateMutation") === true ||
      /duplicate[_ -]?mutation/i.test(type);
    if (explicitDuplicate) duplicateMutationLines.add(line);

    if (isMutationStart(type, record)) {
      const scope = mutationScope(record);
      const token = mutationToken(record);
      const mutationKey = token === null ? null : `${scope}:${String(token)}`;
      if (activeMutations.has(scope) || (mutationKey !== null && seenMutationKeys.has(mutationKey))) {
        duplicateMutationLines.add(line);
      }
      activeMutations.set(scope, mutationKey ?? `line:${line}`);
      if (mutationKey !== null) seenMutationKeys.add(mutationKey);
    } else if (isMutationFinish(type, record)) {
      const scope = mutationScope(record);
      const token = mutationToken(record);
      const active = activeMutations.get(scope);
      if (token === null || active === `${scope}:${String(token)}` || active?.startsWith("line:")) {
        activeMutations.delete(scope);
      }
    }
  }

  return {
    duplicateMutationCount: Math.max(declaredDuplicateMutationCount, duplicateMutationLines.size),
    duplicateMutationCounterObservationCount,
    duplicateMutationEvidencePresent:
      duplicateMutationLines.size > 0 || (
        duplicateMutationCounterObservationCount > 0 &&
        mutationLifecycleCounterObservationCount > 0
      ),
    duplicateMutationLines: [...duplicateMutationLines].sort((a, b) => a - b),
    mutationLifecycleCounterObservationCount,
    staleCallbackCount: Math.max(declaredStaleCallbackCount, staleCallbackLines.size),
    staleCallbackCounterObservationCount,
    staleCallbackEvidencePresent:
      staleCallbackCounterObservationCount > 0 || staleCallbackLines.size > 0,
    staleCallbackLines: [...staleCallbackLines].sort((a, b) => a - b)
  };
}

export function resolveCommittedExits(
  records,
  { explicitCommittedExitMs, frameTimestampsMs = [], originMs = null } = {}
) {
  if (Number.isFinite(explicitCommittedExitMs)) {
    return [{
      committedTimeMs: Number(explicitCommittedExitMs),
      exitFinished: false,
      iteration: null,
      presentationId: null,
      runId: "cli",
      source: "cli",
      timeMs: Number(explicitCommittedExitMs)
    }];
  }
  const exits = [];
  const latestOpenSequenceByRun = new Map();
  for (const record of records) {
    const type = telemetryType(record);
    const runId = telemetryRunId(record);
    if (
      expectedTelemetryMarker(record, "openStarted") ||
      /sheet[_ -]?open[_ -]?started/i.test(type)
    ) {
      latestOpenSequenceByRun.set(runId, record._sequence ?? record._line ?? null);
    }
    const exitFinished = isExplicitExitFinishedRecord(record);
    const committed =
      record.committedExit === true ||
      nestedValue(record, "details.committedExit") === true ||
      nestedValue(record, "exit.committed") === true ||
      /(commit(ted)?[_ -]?(exit|dismiss|swipe)|(exit|dismiss|swipe)[_ -]?commit(ted)?)/i.test(type) ||
      exitFinished;
    if (!committed) continue;
    const timeMs = telemetryVideoTimeMs(record, { frameTimestampsMs, originMs });
    const observation = {
      committedTimeMs: exitFinished ? null : timeMs,
      exitFinished,
      frameIndex: normalizedFrameIndex(record, frameTimestampsMs.length),
      iteration: firstFinite(record.iteration, nestedValue(record, "details.iteration")),
      lifecycleOpenSequence: latestOpenSequenceByRun.get(runId) ?? null,
      line: record._line ?? null,
      presentationId: telemetryPresentationId(record),
      runId,
      source: `ndjson:${record._line ?? "unknown"}`,
      timeMs
    };

    if (exitFinished) {
      // A gesture/action may emit its semantic commit before the presentation
      // has physically left the screen. Merge the later, explicit finish into
      // that lifecycle instead of creating a second presentation interval.
      // This keeps every decoded exit-animation frame inside the strict check.
      const pendingIndex = exits.findLastIndex((exit) =>
        exit.exitFinished !== true &&
        exit.runId === observation.runId &&
        exit.lifecycleOpenSequence === observation.lifecycleOpenSequence &&
        presentationIdsAreCompatible(exit.presentationId, observation.presentationId)
      );
      if (pendingIndex >= 0) {
        const pending = exits[pendingIndex];
        exits[pendingIndex] = {
          ...observation,
          committedLine: pending.line ?? null,
          committedSource: pending.source,
          committedTimeMs: pending.timeMs,
          iteration: observation.iteration ?? pending.iteration,
          presentationId: observation.presentationId ?? pending.presentationId
        };
        continue;
      }
    }
    exits.push(observation);
  }
  return exits.sort((left, right) => {
    const leftTime = Number.isFinite(left.timeMs) ? left.timeMs : Number.POSITIVE_INFINITY;
    const rightTime = Number.isFinite(right.timeMs) ? right.timeMs : Number.POSITIVE_INFINITY;
    return leftTime - rightTime || (left.line ?? 0) - (right.line ?? 0);
  });
}

function isExplicitExitFinishedRecord(record) {
  if (
    record.exitFinished === true ||
    nestedValue(record, "details.exitFinished") === true ||
    nestedValue(record, "state.exitFinished") === true
  ) return true;
  return [record.type, record.event, record.name, record.kind, record.action]
    .some((value) => typeof value === "string" && value.trim().toLowerCase() === "sheet_exit_finished");
}

export function resolveCommittedExit(records, options = {}) {
  return resolveCommittedExits(records, options).at(-1) ?? null;
}

export function resolvePresentationIntervals(
  records,
  committedExits,
  { frameTimestampsMs = [], originMs = null } = {}
) {
  const firstTimeByRun = new Map();
  const openStarts = [];
  for (const record of records) {
    const timeMs = telemetryVideoTimeMs(record, { frameTimestampsMs, originMs });
    if (!Number.isFinite(timeMs)) continue;
    const runId = telemetryRunId(record);
    const first = firstTimeByRun.get(runId);
    if (!Number.isFinite(first) || timeMs < first) firstTimeByRun.set(runId, timeMs);
    const type = telemetryType(record);
    if (
      expectedTelemetryMarker(record, "openStarted") ||
      /sheet[_ -]?open[_ -]?started/i.test(type)
    ) {
      openStarts.push({
        presentationId: telemetryPresentationId(record),
        runId,
        timeMs
      });
    }
  }

  const previousExitByRun = new Map();
  return committedExits
    .filter((exit) => Number.isFinite(exit.timeMs))
    .map((exit, index) => {
      const previousExit = previousExitByRun.get(exit.runId);
      const firstRunTime = firstTimeByRun.get(exit.runId);
      const matchingOpen = openStarts
        .filter((open) =>
          open.runId === exit.runId &&
          open.timeMs < exit.timeMs &&
          (!Number.isFinite(previousExit) || open.timeMs >= previousExit) &&
          presentationIdsAreCompatible(open.presentationId, exit.presentationId)
        )
        .sort((left, right) => left.timeMs - right.timeMs)
        .at(-1);
      const candidateStart = matchingOpen?.timeMs ??
        (Number.isFinite(previousExit) ? previousExit : firstRunTime);
      const startTimeMs = Number.isFinite(candidateStart) && candidateStart < exit.timeMs
        ? candidateStart
        : null;
      previousExitByRun.set(exit.runId, exit.timeMs);
      return {
        committedTimeMs: exit.committedTimeMs ?? null,
        endTimeMs: exit.timeMs,
        endSource: exit.exitFinished === true ? "exit_finished" : "committed_exit",
        exitFinished: exit.exitFinished === true,
        exitLine: exit.line ?? null,
        index,
        iteration: exit.iteration ?? null,
        presentationId: exit.presentationId ?? null,
        runId: exit.runId,
        startSource: matchingOpen ? "open_started" :
          Number.isFinite(previousExit) ? "previous_exit_fallback" : "first_event_fallback",
        startTimeMs
      };
    });
}

export function evaluateThresholds({
  frames,
  telemetry,
  evidenceProvenance = null,
  requireProvenance = false
}) {
  const geometryDeltas = telemetry?.geometryDeltas ?? [];
  // The immutable baseSheetRect is useful context, but cannot prove that the
  // live keyboard-sized sheet remained stable. Only compare live sheetRect
  // samples within equivalent stable layout states.
  const liveSheetDeltas = geometryDeltas.filter((delta) => delta.rectName === "sheetRect");
  const settledDeltas = liveSheetDeltas.filter((delta) => delta.settledPair);
  const sparseUnexplainedDeltas = liveSheetDeltas.filter((delta) => delta.eligibleForJumpCheck);
  const frameVisualDeltas = calculateFrameVisualDeltas(frames);
  const eligibleFrameVisualDeltas = frameVisualDeltas.filter((delta) => delta.eligibleForJumpCheck);
  const missingRequiredRelativeAnchorDeltas = frameVisualDeltas.filter((delta) =>
    delta.exclusionReason === "missing_required_relative_anchor" ||
    delta.exclusionReason === "missing_required_selected_overlay_anchor" ||
    delta.exclusionReason === "missing_required_relative_overlay_anchor"
  );
  const useFrameVisualDeltas = (telemetry?.visualCalibration?.sampleCount ?? 0) > 0;
  const presentationIntervals = telemetry?.presentationIntervals ?? [];
  const committedExitTimeMs = telemetry?.committedExit?.timeMs;
  const preExitFrames = frames.filter((frame) => {
    if (presentationIntervals.length > 0) {
      return presentationIntervals.some((interval) => frameIsInPresentationInterval(frame, interval));
    }
    return !Number.isFinite(committedExitTimeMs) || frame.timestampMs < committedExitTimeMs;
  });
  const fixedRoiMissingFrames = preExitFrames.filter((frame) =>
    frame.backgroundLandmarkPresent !== true &&
    frame.sheetPresent !== true &&
    frame.calibratedSheetPresent !== true
  );
  const sheetContinuity = evaluateCalibratedSheetContinuity(preExitFrames, telemetry?.visualCalibration);
  const missingCalibratedSheetFrames = sheetContinuity.violationFrames;
  const missingCalibratedOverlayFrames = preExitFrames.filter((frame) =>
    frame.calibratedOverlayExpected === true &&
    frame.calibratedOverlayEvaluated === true &&
    frame.calibratedOverlayPresent === false
  );
  const missingFrames = uniqueFrames([
    ...fixedRoiMissingFrames,
    ...missingCalibratedSheetFrames,
    ...missingCalibratedOverlayFrames
  ]);
  const hasTelemetry = telemetry !== null && telemetry !== undefined;
  const committedExitCount = telemetry?.committedExits?.length ?? (telemetry?.committedExit ? 1 : 0);
  const finishedExitCount = telemetry?.committedExits
    ? telemetry.committedExits.filter((exit) => exit.exitFinished === true).length
    : telemetry?.committedExit?.exitFinished === true ? 1 : 0;
  const unfinishedCommittedExits = telemetry?.committedExits
    ? telemetry.committedExits.filter((exit) => exit.exitFinished !== true)
    : telemetry?.committedExit && telemetry.committedExit.exitFinished !== true
      ? [telemetry.committedExit]
      : [];
  const completePresentationTiming = !hasTelemetry || (
    committedExitCount > 0 &&
    finishedExitCount === committedExitCount &&
    presentationIntervals.length === committedExitCount
  );
  const calibration = telemetry?.visualCalibration ?? null;
  const calibratedFrameIndexes = new Set(
    preExitFrames
      .filter((frame) => frame.calibratedSheetExpected && frame.calibratedSheetEvaluated)
      .map((frame) => frame.visualCalibrationIntervalIndex)
      .filter(Number.isSafeInteger)
  );
  const missingFrameCalibrationPresentationIndexes = presentationIntervals
    .map((interval) => interval.index)
    .filter((index) => !calibratedFrameIndexes.has(index));
  const invalidCalibratedSheetFrameIndexes = preExitFrames
    .filter((frame) => frame.calibratedSheetExpected && !frame.calibratedSheetEvaluated)
    .map((frame) => frame.frameIndex);
  const invalidCalibratedOverlayFrameIndexes = preExitFrames
    .filter((frame) => frame.calibratedOverlayExpected && !frame.calibratedOverlayEvaluated)
    .map((frame) => frame.frameIndex);
  const invalidTrackedSheetFrameIndexes = preExitFrames
    .filter((frame) =>
      ["entrance", "exit"].includes(frame.visualPhase) &&
      frame.calibratedSheetPresent === true &&
      !Number.isFinite(trackedSheetTopInScreenPoints(frame))
    )
    .map((frame) => frame.frameIndex);
  const overlaySegmentIndexes = new Set(
    preExitFrames
      .filter((frame) => frame.calibratedOverlayExpected)
      .map((frame) => frame.visualOverlaySegmentIndex)
      .filter(Number.isSafeInteger)
  );
  const evaluatedOverlaySegmentIndexes = new Set(
    preExitFrames
      .filter((frame) => frame.calibratedOverlayExpected && frame.calibratedOverlayEvaluated)
      .map((frame) => frame.visualOverlaySegmentIndex)
      .filter(Number.isSafeInteger)
  );
  const missingOverlaySegmentIndexes = [...overlaySegmentIndexes]
    .filter((index) => !evaluatedOverlaySegmentIndexes.has(index));
  const sheetSegmentCoverage = visualSegmentCoverage(
    preExitFrames,
    calibration?.sheetSegments ?? [],
    "sheet"
  );
  const overlaySegmentCoverage = visualSegmentCoverage(
    preExitFrames,
    calibration?.overlaySegments ?? [],
    "overlay"
  );
  const missingDecodedSheetSegmentIndexes = sheetSegmentCoverage
    .filter((coverage) => coverage.decodedFrameCount === 0)
    .map((coverage) => coverage.segmentIndex);
  const missingEvaluatedSheetSegmentIndexes = sheetSegmentCoverage
    .filter((coverage) => coverage.decodedFrameCount > 0 && coverage.evaluatedFrameCount === 0)
    .map((coverage) => coverage.segmentIndex);
  const missingDecodedOverlaySegmentIndexes = overlaySegmentCoverage
    .filter((coverage) => coverage.decodedFrameCount === 0)
    .map((coverage) => coverage.segmentIndex);
  const missingEvaluatedOverlaySegmentIndexes = overlaySegmentCoverage
    .filter((coverage) => coverage.decodedFrameCount > 0 && coverage.evaluatedFrameCount === 0)
    .map((coverage) => coverage.segmentIndex);
  const completeVisualCalibration = !hasTelemetry || Boolean(
    calibration &&
    presentationIntervals.length > 0 &&
    calibration.missingOpenPresentationIndexes.length === 0 &&
    calibration.missingPresentationIndexes.length === 0 &&
    missingFrameCalibrationPresentationIndexes.length === 0 &&
    invalidCalibratedSheetFrameIndexes.length === 0 &&
    invalidCalibratedOverlayFrameIndexes.length === 0 &&
    invalidTrackedSheetFrameIndexes.length === 0 &&
    missingOverlaySegmentIndexes.length === 0 &&
    missingDecodedSheetSegmentIndexes.length === 0 &&
    missingEvaluatedSheetSegmentIndexes.length === 0 &&
    missingDecodedOverlaySegmentIndexes.length === 0 &&
    missingEvaluatedOverlaySegmentIndexes.length === 0
  );
  const hasStaleCallbackEvidence = Boolean(
    hasTelemetry && telemetry?.counters?.staleCallbackEvidencePresent
  );
  const hasDuplicateMutationEvidence = Boolean(
    hasTelemetry && telemetry?.counters?.duplicateMutationEvidencePresent
  );
  const thresholds = [
    thresholdResult({
      id: "settled_geometry_delta",
      description: "Equivalent settled live-sheet geometry changes by at most 1 source pixel/point after coordinate-space-aware normalization.",
      limit: REQUIRED_THRESHOLDS.settledGeometryDelta,
      observed: maximumValue(settledDeltas.map((delta) => delta.compensatedMaxDelta)),
      sampleCount: settledDeltas.length,
      unit: "pixel_or_point"
    }),
    thresholdResult({
      evaluated: useFrameVisualDeltas
        ? eligibleFrameVisualDeltas.length > 0 && missingRequiredRelativeAnchorDeltas.length === 0
        : undefined,
      id: "unexplained_adjacent_jump",
      description: "Adjacent decoded frames have no unexplained raw anchor displacement above 2 screen points; stable frames use absolute anchors, while expected keyboard/layout updates use Description−sheet and Suggestions−Description so recorded whole-sheet displacement is compensated without weakening the limit.",
      details: useFrameVisualDeltas ? {
        comparisonModes: countBy(
          eligibleFrameVisualDeltas,
          (delta) => delta.comparisonMode
        ),
        evaluatedFramePairCount: eligibleFrameVisualDeltas.length,
        excludedFramePairCount: frameVisualDeltas.length - eligibleFrameVisualDeltas.length,
        excludedFramePairReasons: countBy(
          frameVisualDeltas.filter((delta) => !delta.eligibleForJumpCheck),
          (delta) => delta.exclusionReason
        ),
        framePairsAboveLimit: eligibleFrameVisualDeltas
          .filter((delta) => delta.maximumAnchorDelta > REQUIRED_THRESHOLDS.unexplainedAdjacentJump)
          .slice(0, 100),
        missingRequiredRelativeAnchorFramePairs:
          missingRequiredRelativeAnchorDeltas.slice(0, 100),
        source: "adjacent_decoded_frame_visual_anchors"
      } : {
        source: "legacy_sparse_geometry_fallback"
      },
      limit: REQUIRED_THRESHOLDS.unexplainedAdjacentJump,
      observed: useFrameVisualDeltas
        ? maximumValue(eligibleFrameVisualDeltas.map((delta) => delta.maximumAnchorDelta))
        : maximumValue(sparseUnexplainedDeltas.map((delta) => delta.compensatedMaxDelta)),
      sampleCount: useFrameVisualDeltas
        ? eligibleFrameVisualDeltas.length
        : sparseUnexplainedDeltas.length,
      unit: "pixel_or_screen_point"
    }),
    thresholdResult({
      evaluated: completePresentationTiming && completeVisualCalibration && preExitFrames.length > 0,
      id: "pre_exit_content_continuity",
      description: "Every telemetry lifecycle segment has decoded/evaluated coverage; the underlay or tracked sheet remains visible from open-start through exit-finished; and the sheet cannot disappear mid-lifecycle.",
      details: {
        allowedOuterUnderlayFrameIndexes: sheetContinuity.allowedOuterUnderlayFrameIndexes.slice(0, 100),
        calibratedFrameCount: preExitFrames.filter((frame) => frame.calibratedSheetEvaluated).length,
        calibratedPresentationIndexes: calibration?.calibratedPresentationIndexes ?? [],
        committedExitTimeMs: Number.isFinite(committedExitTimeMs) ? committedExitTimeMs : null,
        committedExitCount,
        coveredPresentationCount: presentationIntervals.length,
        finishedExitCount,
        fixedRoiMissingFrameIndexes: fixedRoiMissingFrames.slice(0, 100).map((frame) => frame.frameIndex),
        invalidCalibratedSheetFrameIndexes: invalidCalibratedSheetFrameIndexes.slice(0, 100),
        invalidCalibratedOverlayFrameIndexes: invalidCalibratedOverlayFrameIndexes.slice(0, 100),
        invalidTrackedSheetFrameIndexes: invalidTrackedSheetFrameIndexes.slice(0, 100),
        lifecycleDirectionViolationFrameIndexes:
          sheetContinuity.directionViolationFrameIndexes.slice(0, 100),
        missingCalibratedOverlayFrameIndexes: missingCalibratedOverlayFrames.slice(0, 100).map((frame) => frame.frameIndex),
        missingCalibratedSheetFrameIndexes: missingCalibratedSheetFrames.slice(0, 100).map((frame) => frame.frameIndex),
        missingDecodedOverlaySegmentIndexes,
        missingDecodedSheetSegmentIndexes,
        missingEvaluatedOverlaySegmentIndexes,
        missingEvaluatedSheetSegmentIndexes,
        missingFrameCalibrationPresentationIndexes,
        missingFrameIndexes: missingFrames.slice(0, 100).map((frame) => frame.frameIndex),
        missingOverlaySegmentIndexes,
        missingTelemetryCalibrationPresentationIndexes: calibration?.missingPresentationIndexes ??
          presentationIntervals.map((interval) => interval.index),
        missingTelemetryOpenPresentationIndexes: calibration?.missingOpenPresentationIndexes ??
          presentationIntervals.map((interval) => interval.index),
        overlaySegmentCoverage,
        preExitFrameCount: preExitFrames.length,
        presentationIntervals,
        sheetSegmentCoverage,
        unfinishedCommittedExits: unfinishedCommittedExits.slice(0, 100)
      },
      limit: REQUIRED_THRESHOLDS.missingContentFrames,
      observed: missingFrames.length,
      sampleCount: preExitFrames.length,
      unit: "frame"
    }),
    thresholdResult({
      evaluated: hasStaleCallbackEvidence,
      id: "stale_callback_count",
      description: "The development telemetry reports zero stale callbacks.",
      details: { lines: telemetry?.counters?.staleCallbackLines ?? [] },
      limit: REQUIRED_THRESHOLDS.staleCallbackCount,
      observed: hasStaleCallbackEvidence ? telemetry.counters.staleCallbackCount : null,
      sampleCount: telemetry?.counters?.staleCallbackCounterObservationCount ?? 0,
      unit: "event"
    }),
    thresholdResult({
      evaluated: hasDuplicateMutationEvidence,
      id: "duplicate_mutation_count",
      description: "The development telemetry reports zero duplicate mutations.",
      details: { lines: telemetry?.counters?.duplicateMutationLines ?? [] },
      limit: REQUIRED_THRESHOLDS.duplicateMutationCount,
      observed: hasDuplicateMutationEvidence ? telemetry.counters.duplicateMutationCount : null,
      sampleCount: telemetry?.counters?.duplicateMutationCounterObservationCount ?? 0,
      unit: "event"
    })
  ];

  if (requireProvenance) {
    thresholds.push(thresholdResult({
      evaluated: evidenceProvenance?.complete === true,
      id: "evidence_provenance",
      description: "Video analysis is bound to a clean, fresh native build, runner-owned Metro, successful XCUITest run IDs, final source verification, and the analyzer's current source.",
      details: evidenceProvenance ?? {
        complete: false,
        issues: [{ code: "provenance_missing", message: "No evidence provenance was supplied." }]
      },
      limit: 0,
      observed: evidenceProvenance?.complete === true ? 0 : null,
      sampleCount: evidenceProvenance?.invocationRunIds?.length ?? 0,
      unit: "provenance_issue"
    }));
  }

  const failed = thresholds.filter((threshold) => threshold.evaluated && threshold.passed === false);
  const incomplete = thresholds.filter((threshold) => !threshold.evaluated);
  return {
    overall: {
      failedThresholdIds: failed.map((threshold) => threshold.id),
      incompleteThresholdIds: incomplete.map((threshold) => threshold.id),
      passed: failed.length === 0 && incomplete.length === 0,
      status: failed.length > 0 ? "fail" : incomplete.length > 0 ? "incomplete" : "pass"
    },
    thresholds
  };
}

export function toCsv(rows, columns) {
  const header = columns.map((column) => csvCell(column.header ?? column.key)).join(",");
  const lines = rows.map((row) => columns.map((column) => {
    const value = typeof column.value === "function" ? column.value(row) : row[column.key];
    return csvCell(value);
  }).join(","));
  return `${[header, ...lines].join("\n")}\n`;
}

function thresholdResult({ evaluated, id, description, details = {}, limit, observed, sampleCount, unit }) {
  const isEvaluated = evaluated ?? (sampleCount > 0 && Number.isFinite(observed));
  return {
    description,
    details,
    evaluated: isEvaluated,
    id,
    limit,
    operator: "<=",
    observed: isEvaluated ? observed : null,
    passed: isEvaluated ? observed <= limit : null,
    sampleCount,
    unit
  };
}

function measuredRectValue(record, key) {
  const value = firstDefined(
    record[key],
    nestedValue(record, `state.${key}`),
    nestedValue(record, `geometry.${key}`),
    null
  );
  if (!isMeasuredRect(value) || Number(value.width) <= 0 || Number(value.height) <= 0) return null;
  return Object.fromEntries(RECT_KEYS.map((rectKey) => [rectKey, Number(value[rectKey])]));
}

function expectedTelemetryMarker(record, key) {
  return firstDefined(
    record[key],
    nestedValue(record, `details.${key}`),
    nestedValue(record, `state.${key}`),
    false
  ) === true;
}

function presentationIdsAreCompatible(left, right) {
  return left === null || left === undefined || right === null || right === undefined ||
    String(left) === String(right);
}

function visualSegmentStart(event, interval, rects) {
  return {
    ...rects,
    endReason: null,
    endTimeMs: null,
    intervalIndex: interval.index,
    line: event.line,
    presentationId: interval.presentationId,
    runId: interval.runId,
    startTimeMs: Number.isFinite(rects.startTimeMs) ? rects.startTimeMs : event.timeMs
  };
}

function addVisualSegment(segments, active, endTimeMs, endReason) {
  if (!Number.isFinite(endTimeMs) || endTimeMs <= active.startTimeMs) return;
  segments.push({ ...active, endReason, endTimeMs });
}

function visualSegmentCoverage(frames, segments, kind) {
  const indexKey = kind === "overlay"
    ? "visualOverlaySegmentIndex"
    : "visualSheetSegmentIndex";
  const expectedKey = kind === "overlay"
    ? "calibratedOverlayExpected"
    : "calibratedSheetExpected";
  const evaluatedKey = kind === "overlay"
    ? "calibratedOverlayEvaluated"
    : "calibratedSheetEvaluated";
  const presentKey = kind === "overlay"
    ? "calibratedOverlayPresent"
    : "calibratedSheetPresent";
  return segments.map((segment) => {
    const decoded = frames.filter((frame) => frame[indexKey] === segment.segmentIndex);
    const expected = decoded.filter((frame) => frame[expectedKey] === true);
    const evaluated = expected.filter((frame) => frame[evaluatedKey] === true);
    const present = evaluated.filter((frame) => frame[presentKey] === true);
    const missingSelectedAnchor = kind === "overlay"
      ? expected.filter((frame) =>
        frame[evaluatedKey] !== true ||
        frame[presentKey] !== true ||
        !Number.isFinite(frame.visualAnchorTrack?.overlayTop)
      )
      : [];
    return {
      decodedFrameCount: decoded.length,
      endTimeMs: segment.endTimeMs,
      evaluatedFrameCount: evaluated.length,
      expectedFrameCount: expected.length,
      intervalIndex: segment.intervalIndex,
      missingSelectedAnchorFrameIndexes:
        missingSelectedAnchor.map((frame) => frame.frameIndex),
      phase: segment.phase ?? (kind === "overlay" ? "overlay" : "stable"),
      presentFrameCount: present.length,
      segmentIndex: segment.segmentIndex,
      startTimeMs: segment.startTimeMs
    };
  });
}

function evaluateCalibratedSheetContinuity(frames, calibration) {
  const byIndex = new Map((calibration?.sheetSegments ?? []).map((segment) => [
    segment.segmentIndex,
    segment
  ]));
  const violationFrames = new Map();
  const allowedOuterUnderlayFrameIndexes = [];
  const directionViolationFrameIndexes = [];
  const framesBySegment = new Map();
  for (const frame of frames) {
    if (!Number.isSafeInteger(frame.visualSheetSegmentIndex)) continue;
    const values = framesBySegment.get(frame.visualSheetSegmentIndex) ?? [];
    values.push(frame);
    framesBySegment.set(frame.visualSheetSegmentIndex, values);
  }
  const markViolation = (frame, direction = false) => {
    violationFrames.set(frame.frameIndex, frame);
    if (direction) directionViolationFrameIndexes.push(frame.frameIndex);
  };

  for (const [segmentIndex, values] of framesBySegment) {
    const segment = byIndex.get(segmentIndex);
    const phase = segment?.phase ?? values[0]?.visualPhase ?? "stable";
    const ordered = [...values].sort((left, right) =>
      left.timestampMs - right.timestampMs || left.frameIndex - right.frameIndex
    );
    const evaluated = ordered.filter((frame) =>
      frame.calibratedSheetExpected === true && frame.calibratedSheetEvaluated === true
    );

    if (phase === "entrance") {
      let sheetHasAppeared = false;
      for (const frame of evaluated) {
        if (frame.calibratedSheetPresent === true) {
          sheetHasAppeared = true;
        } else if (sheetHasAppeared) {
          markViolation(frame);
        } else {
          allowedOuterUnderlayFrameIndexes.push(frame.frameIndex);
        }
      }
    } else if (phase === "exit") {
      let sheetHasDisappeared = false;
      const absenceSinceLastPresence = [];
      for (const frame of evaluated) {
        if (frame.calibratedSheetPresent === false) {
          sheetHasDisappeared = true;
          absenceSinceLastPresence.push(frame);
          allowedOuterUnderlayFrameIndexes.push(frame.frameIndex);
        } else if (sheetHasDisappeared) {
          // A suffix of underlay-only frames is expected after the sheet has
          // left the screen. Reappearance proves a mid-exit dropout instead.
          for (const absent of absenceSinceLastPresence) markViolation(absent);
          markViolation(frame);
          sheetHasDisappeared = false;
          absenceSinceLastPresence.length = 0;
        }
      }
    } else {
      for (const frame of evaluated) {
        if (frame.calibratedSheetPresent === false) markViolation(frame);
      }
    }

    const presentFrames = evaluated.filter((frame) => frame.calibratedSheetPresent === true);
    for (let index = 1; index < presentFrames.length; index += 1) {
      const previous = presentFrames[index - 1];
      const current = presentFrames[index];
      const previousTop = trackedSheetTopInScreenPoints(previous);
      const currentTop = trackedSheetTopInScreenPoints(current);
      if (!Number.isFinite(previousTop) || !Number.isFinite(currentTop)) continue;
      const reversal = phase === "entrance"
        ? currentTop - previousTop
        : phase === "exit"
          ? previousTop - currentTop
          : 0;
      if (reversal > REQUIRED_THRESHOLDS.unexplainedAdjacentJump) {
        markViolation(current, true);
      }
    }
  }

  return {
    allowedOuterUnderlayFrameIndexes: [...new Set(allowedOuterUnderlayFrameIndexes)].sort((a, b) => a - b),
    directionViolationFrameIndexes: [...new Set(directionViolationFrameIndexes)].sort((a, b) => a - b),
    violationFrames: [...violationFrames.values()].sort((left, right) => left.frameIndex - right.frameIndex)
  };
}

function trackedSheetTopInScreenPoints(frame) {
  if (Number.isFinite(frame.visualAnchorTrack?.sheetTop)) {
    return frame.visualAnchorTrack.sheetTop;
  }
  if (Number.isFinite(frame.transitionTrackedTop) && Number.isFinite(frame.visualScreenHeight)) {
    return frame.transitionTrackedTop * frame.visualScreenHeight;
  }
  return null;
}

function uniqueFrames(frames) {
  const byIndex = new Map();
  for (const frame of frames) byIndex.set(frame.frameIndex, frame);
  return [...byIndex.values()].sort((left, right) => left.frameIndex - right.frameIndex);
}

function countBy(values, keyForValue) {
  const counts = {};
  for (const value of values) {
    const key = String(keyForValue(value) ?? "unknown");
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function findMeasuredRects(record) {
  const rects = [];
  const seen = new Set();
  const containers = [
    [record, ""],
    [record.geometry, "geometry"],
    [record.measurement, "measurement"],
    [record.measurements, "measurements"],
    [record.rects, "rects"],
    [record.state, "state"],
    [record.state?.geometry, "state.geometry"]
  ];

  for (const [container, prefix] of containers) {
    if (!container || typeof container !== "object" || Array.isArray(container)) continue;
    if (isMeasuredRect(container)) {
      const name = String(record.rectName ?? record.target ?? (prefix || "rect"));
      addRect(rects, seen, name, container);
      continue;
    }
    for (const [key, value] of Object.entries(container)) {
      if (!isMeasuredRect(value)) continue;
      const name = key === "rect" && record.rectName
        ? String(record.rectName)
        : key === "rect" && record.target
          ? String(record.target)
          : key;
      addRect(rects, seen, name, value);
    }
  }
  return rects;
}

function addRect(rects, seen, name, value) {
  const rect = Object.fromEntries(RECT_KEYS.map((key) => [key, Number(value[key])]));
  const signature = `${name}:${RECT_KEYS.map((key) => rect[key]).join(":")}`;
  if (seen.has(signature)) return;
  seen.add(signature);
  rects.push({ name, rect });
}

function isMeasuredRect(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    RECT_KEYS.every((key) => Number.isFinite(Number(value[key]))) &&
    Number(value.width) >= 0 &&
    Number(value.height) >= 0
  );
}

function extractKeyboardCompensation(record) {
  const explicit = firstDefined(
    record.keyboardCompensation,
    nestedValue(record, "geometry.keyboardCompensation"),
    nestedValue(record, "measurement.keyboardCompensation"),
    null
  );
  if (Number.isFinite(Number(explicit))) {
    return { x: 0, y: Number(explicit), width: 0, height: 0 };
  }
  if (explicit && typeof explicit === "object") {
    return Object.fromEntries(RECT_KEYS.map((key) => [key, finiteNumber(explicit[key]) ?? 0]));
  }
  const verticalCompensation = firstFinite(
    record.keyboardLift,
    record.keyboardInset,
    record.keyboardOffset,
    nestedValue(record, "keyboard.lift"),
    nestedValue(record, "keyboard.inset"),
    nestedValue(record, "state.keyboardInset")
  ) ?? 0;
  return { x: 0, y: verticalCompensation, width: 0, height: 0 };
}

function extractKeyboardLayout(record) {
  const phase = String(firstDefined(
    record.keyboardPhase,
    nestedValue(record, "keyboard.phase"),
    nestedValue(record, "state.keyboardPhase"),
    "unknown"
  ));
  const inset = firstFinite(
    record.keyboardInset,
    nestedValue(record, "keyboard.inset"),
    nestedValue(record, "state.keyboardInset")
  );
  const overlayBottomBoundary = firstFinite(
    record.overlayBottomBoundary,
    nestedValue(record, "geometry.overlayBottomBoundary"),
    nestedValue(record, "state.overlayBottomBoundary")
  );
  const stableState = /^(visible|hidden)$/i.test(phase)
    ? phase.toLowerCase()
    : inset !== null
      ? inset > 0 ? "visible" : "hidden"
      : phase.toLowerCase();
  return { inset, overlayBottomBoundary, phase, stableState };
}

function geometryLayoutsAreEquivalent(previous, current) {
  if (previous.coordinateSpace !== current.coordinateSpace) return false;
  if (current.coordinateSpace !== "sheet_local") return true;
  if (previous.keyboardLayout.stableState !== current.keyboardLayout.stableState) return false;

  const previousBoundary = previous.keyboardLayout.overlayBottomBoundary;
  const currentBoundary = current.keyboardLayout.overlayBottomBoundary;
  if ((previousBoundary === null) !== (currentBoundary === null)) return false;
  if (
    previousBoundary !== null &&
    currentBoundary !== null &&
    Math.abs(previousBoundary - currentBoundary) > REQUIRED_THRESHOLDS.settledGeometryDelta
  ) return false;
  return true;
}

function geometryPhase(record) {
  return String(firstDefined(
    record.geometryPhase,
    record.phase,
    record.sheetPhase,
    nestedValue(record, "state.sheetPhase"),
    "unknown"
  ));
}

function geometryIsSettled(record, phase) {
  const explicit = firstDefined(record.settled, record.geometrySettled, nestedValue(record, "geometry.settled"));
  if (typeof explicit === "boolean") return explicit;
  const sheetPhase = String(firstDefined(record.sheetPhase, nestedValue(record, "state.sheetPhase"), phase));
  const keyboardPhase = String(firstDefined(record.keyboardPhase, nestedValue(record, "state.keyboardPhase"), "stable"));
  const gesturePhase = String(firstDefined(record.gesturePhase, nestedValue(record, "state.gesturePhase"), "idle"));
  return SETTLED_PHASE.test(sheetPhase) && !TRANSITIONAL_PHASE.test(keyboardPhase) && !TRANSITIONAL_PHASE.test(gesturePhase);
}

function geometryIsEligibleForJumpCheck(record, phase) {
  const explicit = firstDefined(
    record.eligibleForJumpCheck,
    record.includeInJumpCheck,
    nestedValue(record, "geometry.eligibleForJumpCheck")
  );
  if (typeof explicit === "boolean") return explicit;
  if (
    record.expectedGeometryChange === true ||
    record.expectedTransition === true ||
    nestedValue(record, "geometry.expectedChange") === true
  ) return false;
  const keyboardPhase = String(firstDefined(record.keyboardPhase, nestedValue(record, "state.keyboardPhase"), "stable"));
  const gesturePhase = String(firstDefined(record.gesturePhase, nestedValue(record, "state.gesturePhase"), "idle"));
  return !TRANSITIONAL_PHASE.test(phase) && !TRANSITIONAL_PHASE.test(keyboardPhase) && !TRANSITIONAL_PHASE.test(gesturePhase);
}

function telemetryVideoTimeMs(record, { frameTimestampsMs = [], originMs = null } = {}) {
  // A caller-supplied recording origin is authoritative. XCUITest and the
  // outer Node runner each emit their own elapsed clock, so preferring an
  // embedded elapsedMs here would silently misalign otherwise valid epoch
  // timestamps with a simctl recording that began before XCTest launched.
  const absolute = absoluteTimestampMs(record);
  if (absolute !== null && Number.isFinite(originMs)) return absolute - originMs;
  const relative = relativeTimestampMs(record, frameTimestampsMs);
  if (relative !== null) return relative;
  return null;
}

function relativeTimestampMs(record, frameTimestampsMs) {
  const milliseconds = firstFinite(
    record.videoTimeMs,
    record.recordingTimeMs,
    record.elapsedMs,
    record.timeMs,
    record.tMs,
    nestedValue(record, "video.timeMs"),
    nestedValue(record, "recording.elapsedMs")
  );
  if (milliseconds !== null) return milliseconds;
  const seconds = firstFinite(record.videoTimeSeconds, record.elapsedSeconds, record.timeSeconds);
  if (seconds !== null) return seconds * 1000;
  const frameIndex = normalizedFrameIndex(record, frameTimestampsMs.length);
  if (frameIndex !== null && Number.isFinite(frameTimestampsMs[frameIndex])) {
    return frameTimestampsMs[frameIndex];
  }
  return null;
}

function absoluteTimestampMs(record) {
  const numeric = firstFinite(
    record.timestampMs,
    record.epochMs,
    record.wallClockMs,
    nestedValue(record, "timestamp.epochMs")
  );
  if (numeric !== null && numeric > 10_000_000_000) return numeric;
  const text = firstDefined(record.timestamp, record.timestampIso, record.createdAt);
  if (typeof text === "string") {
    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizedFrameIndex(record, frameCount) {
  const value = firstFinite(record.frameIndex, record.videoFrameIndex, nestedValue(record, "video.frameIndex"));
  if (value === null || !Number.isSafeInteger(value) || value < 0) return null;
  if (frameCount > 0 && value >= frameCount) return null;
  return value;
}

function telemetryType(record) {
  return String(firstDefined(record.type, record.event, record.name, record.kind, record.action, ""));
}

function isMutationStart(type, record) {
  if (record.mutationStarted === true) return true;
  return /(mutation.*(start|begin|request)|(start|begin|request).*mutation)/i.test(type) && !/(finish|complete|reject|fail)/i.test(type);
}

function isMutationFinish(type, record) {
  if (record.mutationFinished === true) return true;
  return /(mutation.*(finish|complete|succeed|fail|cancel)|(finish|complete|succeed|fail|cancel).*mutation)/i.test(type);
}

function mutationScope(record) {
  const localScope = String(firstDefined(
    record.presentationId,
    record.entryId,
    record.mutationScope,
    nestedValue(record, "presentation.id"),
    nestedValue(record, "state.presentationId"),
    "global"
  ));
  return `${telemetryRunId(record)}::${localScope}`;
}

function mutationToken(record) {
  return firstDefined(
    record.operationToken,
    record.mutationToken,
    record.mutationId,
    nestedValue(record, "mutation.token"),
    nestedValue(record, "mutation.id"),
    null
  );
}

function rectDelta(left, right) {
  return Object.fromEntries(RECT_KEYS.map((key) => [key, Math.abs(right[key] - left[key])]));
}

function maximumRectDelta(delta) {
  return Math.max(...RECT_KEYS.map((key) => delta[key]));
}

function compareMeasurements(left, right) {
  if (Number.isFinite(left.videoTimeMs) && Number.isFinite(right.videoTimeMs)) {
    return left.videoTimeMs - right.videoTimeMs || left.sequence - right.sequence;
  }
  if (left.frameIndex !== null && right.frameIndex !== null) {
    return left.frameIndex - right.frameIndex || left.sequence - right.sequence;
  }
  return left.sequence - right.sequence;
}

function telemetryRunId(record) {
  return String(firstDefined(
    record.runId,
    record.runID,
    nestedValue(record, "run.id"),
    nestedValue(record, "state.runId"),
    "default"
  ));
}

function telemetryPresentationId(record) {
  return firstDefined(
    record.presentationId,
    nestedValue(record, "presentation.id"),
    nestedValue(record, "state.presentationId"),
    nestedValue(record, "details.presentationId"),
    null
  );
}

export function frameIsInPresentationInterval(frame, interval) {
  if (!Number.isFinite(frame?.timestampMs) || !Number.isFinite(interval?.endTimeMs)) return false;
  const startsBeforeFrame = !Number.isFinite(interval.startTimeMs) ||
    frame.timestampMs >= interval.startTimeMs;
  return startsBeforeFrame && frame.timestampMs < interval.endTimeMs;
}

/**
 * Proves that an NDJSON input is the complete output of one clean, fresh,
 * runner-owned native QA session. This is deliberately separate from the
 * visual thresholds: missing or contradictory chain-of-custody metadata makes
 * evidence incomplete, rather than turning an unknown recording into a pass.
 */
export function analyzeEvidenceProvenance(records, { currentSource = null } = {}) {
  const issues = [];
  const byEvent = (name) => records.filter((record) => telemetryType(record) === name);
  const addIssue = (code, message, details = {}) => {
    issues.push({ code, details, message });
  };
  const exactlyOne = (name) => {
    const matches = byEvent(name);
    if (matches.length !== 1) {
      addIssue(
        `${name}_count`,
        `Expected exactly one ${name} record, observed ${matches.length}.`,
        { observed: matches.length }
      );
    }
    return matches.length === 1 ? matches[0] : null;
  };

  const runnerStarted = exactlyOne("runner_started");
  const runnerFinished = exactlyOne("runner_finished");
  const sourceVerification = exactlyOne("source_verification_finished");
  const buildFinished = exactlyOne("build_for_testing_finished");
  const metroReady = exactlyOne("metro_ready");

  if (runnerStarted) {
    if (runnerStarted.noBuild !== false) {
      addIssue("fresh_build_required", "Evidence must use a fresh build-for-testing run.");
    }
    if (runnerStarted.noMetro !== false) {
      addIssue("owned_metro_required", "Evidence must use the runner-owned Metro process.");
    }
    if (runnerStarted.allowDirty === true || runnerStarted.sourceDirty !== false) {
      addIssue("clean_source_required", "Evidence must start from a clean source tree.");
    }
    if (!isNonemptyString(runnerStarted.sourceRevision)) {
      addIssue("source_revision_missing", "runner_started has no source revision.");
    }
    if (!isSha256(runnerStarted.sourceFingerprint)) {
      addIssue("source_fingerprint_missing", "runner_started has no valid SHA-256 source fingerprint.");
    }
  }

  if (buildFinished) {
    if (buildFinished.success !== true) {
      addIssue("build_unsuccessful", "build_for_testing_finished was not successful.");
    }
    for (const key of ["appBundlePath", "buildManifestPath", "xctestrunPath"]) {
      if (!isNonemptyString(buildFinished[key])) {
        addIssue("build_artifact_missing", `build_for_testing_finished has no ${key}.`, { key });
      }
    }
    if (runnerStarted && buildFinished.sourceFingerprint !== runnerStarted.sourceFingerprint) {
      addIssue("build_source_mismatch", "The native build fingerprint does not match runner_started.");
    }
  }
  if (byEvent("build_for_testing_reused").length > 0) {
    addIssue("reused_build_disallowed", "Final evidence may not reuse an earlier native build.");
  }

  if (metroReady) {
    if (
      metroReady.existing !== false ||
      metroReady.ownedProcess !== true ||
      !Number.isSafeInteger(metroReady.pid) ||
      metroReady.pid <= 0 ||
      !isNonemptyString(metroReady.projectRoot)
    ) {
      addIssue("metro_ownership_unverified", "Metro was not proven to be a new runner-owned process.");
    }
    if (runnerStarted && Number(metroReady.port) !== Number(runnerStarted.metroPort)) {
      addIssue("metro_port_mismatch", "Metro ready and runner-start ports differ.");
    }
  }
  if (byEvent("metro_skipped").length > 0) {
    addIssue("metro_skipped", "Final evidence may not skip runner-owned Metro.");
  }

  const invocationStarts = byEvent("invocation_started");
  const invocationRunIds = invocationStarts
    .map((record) => isNonemptyString(record.runId) ? record.runId : null)
    .filter(Boolean);
  if (invocationStarts.length === 0) {
    addIssue("invocation_missing", "No native QA invocation was recorded.");
  }
  if (invocationRunIds.length !== invocationStarts.length) {
    addIssue("invocation_run_id_missing", "Every invocation_started record must have a runId.");
  }
  if (new Set(invocationRunIds).size !== invocationRunIds.length) {
    addIssue("invocation_run_id_reused", "Native QA invocation run IDs must be unique.");
  }

  const knownRunIds = new Set(invocationRunIds);
  for (const record of records) {
    if (!isNonemptyString(record.runId)) continue;
    if (!knownRunIds.has(record.runId)) {
      addIssue(
        "unknown_telemetry_run_id",
        `Telemetry runId ${JSON.stringify(record.runId)} has no invocation_started owner.`,
        { line: record._line ?? null, runId: record.runId }
      );
    }
  }

  for (const invocation of invocationStarts) {
    if (!isNonemptyString(invocation.runId)) continue;
    const runId = invocation.runId;
    const testStarts = byEvent("test_started").filter((record) => record.runId === runId);
    const testFinishes = byEvent("test_finished").filter((record) => record.runId === runId);
    const environmentRecords = byEvent("xctestrun_environment_injected")
      .filter((record) => record.runId === runId);
    const invocationFinishes = byEvent("invocation_finished").filter((record) =>
      Number(record.invocation) === Number(invocation.invocation)
    );
    if (environmentRecords.length !== 1) {
      addIssue("invocation_environment_unbound", "Invocation runId was not bound exactly once into xctestrun.", {
        count: environmentRecords.length,
        runId
      });
    }
    if (testStarts.length !== 1 || testStarts[0]?.success !== true) {
      addIssue("test_start_unbound", "Invocation has no unique successful test_started record.", {
        count: testStarts.length,
        runId
      });
    }
    if (testFinishes.length !== 1 || testFinishes[0]?.success !== true) {
      addIssue("test_finish_unsuccessful", "Invocation has no unique successful test_finished record.", {
        count: testFinishes.length,
        runId
      });
    }
    if (
      invocationFinishes.length !== 1 ||
      invocationFinishes[0]?.success !== true ||
      invocationFinishes[0]?.telemetryVerified !== true ||
      Number(invocationFinishes[0]?.exitCode) !== 0
    ) {
      addIssue("invocation_finish_unverified", "Invocation did not finish successfully with verified telemetry.", {
        count: invocationFinishes.length,
        runId
      });
    }
  }

  if (sourceVerification) {
    if (sourceVerification.success !== true || sourceVerification.matchesStart !== true) {
      addIssue("final_source_unverified", "The runner did not verify its final source against its start source.");
    }
    if (sourceVerification.sourceDirty !== false) {
      addIssue("final_source_dirty", "The runner's final source tree was not clean.");
    }
    for (const key of ["sourceRevision", "sourceFingerprint"]) {
      if (runnerStarted && sourceVerification[key] !== runnerStarted[key]) {
        addIssue("final_source_mismatch", `${key} changed during the native QA run.`, { key });
      }
    }
  }

  if (runnerFinished) {
    if (runnerFinished.success !== true) {
      addIssue("runner_unsuccessful", "runner_finished did not report success.");
    }
    if (records.at(-1) !== runnerFinished) {
      addIssue("runner_not_terminal", "runner_finished is not the terminal NDJSON record.");
    }
    for (const key of ["sourceRevision", "sourceFingerprint"]) {
      if (runnerStarted && runnerFinished[key] !== runnerStarted[key]) {
        addIssue("runner_source_mismatch", `runner_finished ${key} differs from runner_started.`, { key });
      }
    }
    if (runnerFinished.sourceDirty !== false) {
      addIssue("runner_final_source_dirty", "runner_finished did not report a clean final source tree.");
    }
  }

  if (!currentSource) {
    addIssue("current_source_unverified", "The analyzer could not verify the current source provenance.");
  } else if (runnerStarted) {
    if (currentSource.dirty !== false) {
      addIssue("current_source_dirty", "The analyzer is running against a dirty source tree.");
    }
    for (const key of ["revision", "fingerprint"]) {
      const runnerKey = key === "revision" ? "sourceRevision" : "sourceFingerprint";
      if (currentSource[key] !== runnerStarted[runnerKey]) {
        addIssue("analyzer_source_mismatch", `Analyzer source ${key} differs from the recorded runner source.`, {
          key
        });
      }
    }
  }

  return {
    complete: issues.length === 0,
    currentSource,
    invocationRunIds,
    issues,
    runner: runnerStarted ? {
      flow: runnerStarted.flow ?? null,
      metroPort: runnerStarted.metroPort ?? null,
      sourceDirty: runnerStarted.sourceDirty ?? null,
      sourceFingerprint: runnerStarted.sourceFingerprint ?? null,
      sourceRevision: runnerStarted.sourceRevision ?? null
    } : null
  };
}

function histogramPercentile(histogram, total, percentile) {
  const target = Math.max(0, Math.min(total - 1, Math.floor((total - 1) * percentile)));
  let seen = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    seen += histogram[index];
    if (seen > target) return index;
  }
  return histogram.length - 1;
}

function averageRgb(data, imageWidth, channels, x, firstY, lastY) {
  const sums = [0, 0, 0];
  let count = 0;
  for (let y = firstY; y <= lastY; y += 1) {
    const offset = (y * imageWidth + x) * channels;
    sums[0] += data[offset];
    sums[1] += data[offset + 1];
    sums[2] += data[offset + 2];
    count += 1;
  }
  return sums.map((sum) => sum / count);
}

function unevaluatedBoundary(edge, details = {}) {
  return {
    afterMeanRgb: null,
    beforeMeanRgb: null,
    broadContrastCoverage: null,
    edge,
    evaluated: false,
    landmarkPresent: null,
    meanColourDifference: null,
    sampleY: null,
    score: null,
    ...details
  };
}

function insetNormalizedRect(rect, ratio) {
  const insetX = rect.width * ratio;
  const insetY = rect.height * ratio;
  return {
    x: rect.x + insetX,
    y: rect.y + insetY,
    width: Math.max(0.0001, rect.width - insetX * 2),
    height: Math.max(0.0001, rect.height - insetY * 2)
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function nestedValue(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function firstFinite(...values) {
  for (const value of values) {
    const parsed = finiteNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function isNonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function maximumValue(values) {
  return values.length === 0 ? null : Math.max(...values);
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
