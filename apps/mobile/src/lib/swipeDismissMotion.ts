export const SWIPE_DISMISS_MOTION = {
  activeOffsetY: 4,
  horizontalFailureOffset: 24,
  minimumFlickDistance: 12,
  projectionSeconds: 0.14,
  distanceRatio: 0.2,
  minimumDistance: 96,
  maximumDistance: 128
} as const;

export type SwipeRelease = {
  disabled?: boolean;
  sheetHeight: number;
  translationX: number;
  translationY: number;
  velocityY: number;
};

export type SwipeDismissCoordinator = {
  canSettle: () => boolean;
  commit: () => boolean;
  finish: () => boolean;
  hide: () => void;
};

export type SwipeSheetPresentationPlan = {
  animatePresenceTo: number;
  animateTranslationTo: number;
  initialPresence: number;
  initialTranslation: number;
  travel: boolean;
};

export type SwipeSheetExitPlan = {
  fadeOnly: boolean;
  translationTarget: number;
};

export function dismissDistanceForSheet(sheetHeight: number) {
  "worklet";
  return Math.min(
    SWIPE_DISMISS_MOTION.maximumDistance,
    Math.max(
      SWIPE_DISMISS_MOTION.minimumDistance,
      sheetHeight * SWIPE_DISMISS_MOTION.distanceRatio
    )
  );
}

export function projectedSwipeEndpoint(translationY: number, velocityY: number) {
  "worklet";
  return Math.max(0, translationY) +
    Math.max(0, velocityY) * SWIPE_DISMISS_MOTION.projectionSeconds;
}

export function shouldDismissSwipe({
  disabled = false,
  sheetHeight,
  translationX,
  translationY,
  velocityY
}: SwipeRelease) {
  "worklet";
  const downwardTravel = Math.max(0, translationY);
  if (disabled || downwardTravel < SWIPE_DISMISS_MOTION.minimumFlickDistance) return false;
  if (
    Math.abs(translationX) > SWIPE_DISMISS_MOTION.horizontalFailureOffset &&
    Math.abs(translationX) > downwardTravel
  ) {
    return false;
  }
  return projectedSwipeEndpoint(downwardTravel, velocityY) >=
    dismissDistanceForSheet(sheetHeight);
}

export function backdropProgressForTranslation(translationY: number, exitTarget: number) {
  "worklet";
  if (exitTarget <= 0) return translationY > 0 ? 0 : 1;
  return Math.max(0, Math.min(1, 1 - Math.max(0, translationY) / exitTarget));
}

export function swipeSheetPresentationPlan({
  exitTarget,
  reduceMotion,
  visible
}: {
  exitTarget: number;
  reduceMotion: boolean;
  visible: boolean;
}): SwipeSheetPresentationPlan {
  if (!visible) {
    return {
      animatePresenceTo: 0,
      animateTranslationTo: exitTarget,
      initialPresence: 0,
      initialTranslation: exitTarget,
      travel: false
    };
  }
  if (reduceMotion) {
    return {
      animatePresenceTo: 1,
      animateTranslationTo: 0,
      initialPresence: 0,
      initialTranslation: 0,
      travel: false
    };
  }
  return {
    animatePresenceTo: 1,
    animateTranslationTo: 0,
    initialPresence: 1,
    initialTranslation: exitTarget,
    travel: true
  };
}

export function swipeSheetExitPlan({
  currentTranslation,
  exitTarget,
  reduceMotion
}: {
  currentTranslation: number;
  exitTarget: number;
  reduceMotion: boolean;
}): SwipeSheetExitPlan {
  "worklet";
  return reduceMotion
    ? { fadeOnly: true, translationTarget: currentTranslation }
    : { fadeOnly: false, translationTarget: exitTarget };
}

export function createSwipeDismissCoordinator(onDismiss: () => void): SwipeDismissCoordinator {
  let state: "idle" | "committed" | "finished" = "idle";

  return {
    canSettle() {
      return state === "idle";
    },
    commit() {
      if (state !== "idle") return false;
      state = "committed";
      return true;
    },
    finish() {
      if (state !== "committed") return false;
      state = "finished";
      onDismiss();
      return true;
    },
    hide() {
      state = "idle";
    }
  };
}
