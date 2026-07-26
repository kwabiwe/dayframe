import { describe, expect, it, vi } from "vitest";
import {
  backdropProgressForTranslation,
  createSwipeDismissCoordinator,
  dismissDistanceForSheet,
  projectedSwipeEndpoint,
  shouldDismissSwipe,
  swipeSheetExitPlan,
  swipeSheetPresentationPlan
} from "./swipeDismissMotion";

const BASE_RELEASE = {
  sheetHeight: 600,
  translationX: 0,
  translationY: 0,
  velocityY: 0
};

describe("swipe dismissal decision", () => {
  it("dismisses a slow deliberate drag beyond the distance boundary", () => {
    const boundary = dismissDistanceForSheet(600);
    expect(shouldDismissSwipe({
      ...BASE_RELEASE,
      translationY: boundary + 1
    })).toBe(true);
  });

  it("dismisses a short fast downward flick by projected endpoint", () => {
    expect(shouldDismissSwipe({
      ...BASE_RELEASE,
      translationY: 18,
      velocityY: 900
    })).toBe(true);
  });

  it("rejects a short slow release", () => {
    expect(shouldDismissSwipe({
      ...BASE_RELEASE,
      translationY: 42,
      velocityY: 80
    })).toBe(false);
  });

  it("has a continuous decision immediately below and above the projected boundary", () => {
    const boundary = dismissDistanceForSheet(600);
    expect(shouldDismissSwipe({
      ...BASE_RELEASE,
      translationY: boundary - 0.1
    })).toBe(false);
    expect(shouldDismissSwipe({
      ...BASE_RELEASE,
      translationY: boundary + 0.1
    })).toBe(true);
  });

  it("rejects a primarily horizontal release", () => {
    expect(shouldDismissSwipe({
      ...BASE_RELEASE,
      translationX: 80,
      translationY: 30,
      velocityY: 1_000
    })).toBe(false);
  });

  it("rejects upward travel and upward velocity", () => {
    expect(shouldDismissSwipe({
      ...BASE_RELEASE,
      translationY: -80,
      velocityY: -1_000
    })).toBe(false);
  });

  it("rejects a cancelled gesture represented by zero travel", () => {
    expect(shouldDismissSwipe(BASE_RELEASE)).toBe(false);
  });

  it("honours the disabled state", () => {
    expect(shouldDismissSwipe({
      ...BASE_RELEASE,
      disabled: true,
      translationY: 300,
      velocityY: 1_500
    })).toBe(false);
  });

  it("does not include keyboard offset in the drag decision", () => {
    const release = {
      ...BASE_RELEASE,
      translationY: 30,
      velocityY: 700
    };
    expect(shouldDismissSwipe(release)).toBe(
      projectedSwipeEndpoint(release.translationY, release.velocityY) >=
        dismissDistanceForSheet(release.sheetHeight)
    );
  });
});

describe("backdrop progress", () => {
  it("is fully visible at rest", () => {
    expect(backdropProgressForTranslation(0, 800)).toBe(1);
  });

  it("lightens continuously with downward travel", () => {
    expect(backdropProgressForTranslation(200, 800)).toBeCloseTo(0.75);
    expect(backdropProgressForTranslation(400, 800)).toBeCloseTo(0.5);
  });

  it("returns to full opacity when a cancelled drag returns to rest", () => {
    expect(backdropProgressForTranslation(140, 800)).toBeLessThan(1);
    expect(backdropProgressForTranslation(0, 800)).toBe(1);
  });

  it("reaches zero at and beyond the successful exit target", () => {
    expect(backdropProgressForTranslation(800, 800)).toBe(0);
    expect(backdropProgressForTranslation(1_000, 800)).toBe(0);
  });
});

describe("dismiss callback coordination", () => {
  it("does not invoke the callback before a committed exit finishes", () => {
    const onDismiss = vi.fn();
    const coordinator = createSwipeDismissCoordinator(onDismiss);
    expect(coordinator.commit()).toBe(true);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("invokes the successful callback exactly once", () => {
    const onDismiss = vi.fn();
    const coordinator = createSwipeDismissCoordinator(onDismiss);
    coordinator.commit();
    expect(coordinator.finish()).toBe(true);
    expect(coordinator.finish()).toBe(false);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("prevents settle after dismissal has committed", () => {
    const coordinator = createSwipeDismissCoordinator(() => undefined);
    expect(coordinator.canSettle()).toBe(true);
    coordinator.commit();
    expect(coordinator.canSettle()).toBe(false);
  });

  it("allows only the first rapid dismissal request to commit", () => {
    const coordinator = createSwipeDismissCoordinator(() => undefined);
    expect(coordinator.commit()).toBe(true);
    expect(coordinator.commit()).toBe(false);
    expect(coordinator.commit()).toBe(false);
  });

  it("resets only through the hidden lifecycle", () => {
    const coordinator = createSwipeDismissCoordinator(() => undefined);
    coordinator.commit();
    coordinator.finish();
    expect(coordinator.commit()).toBe(false);
    coordinator.hide();
    expect(coordinator.commit()).toBe(true);
  });
});

describe("presentation lifecycle", () => {
  it("keeps a hidden sheet off-screen with a clear backdrop", () => {
    expect(swipeSheetPresentationPlan({
      exitTarget: 800,
      reduceMotion: false,
      visible: false
    })).toEqual({
      animatePresenceTo: 0,
      animateTranslationTo: 800,
      initialPresence: 0,
      initialTranslation: 800,
      travel: false
    });
  });

  it("starts a newly visible sheet below the viewport and ends at rest", () => {
    const plan = swipeSheetPresentationPlan({
      exitTarget: 800,
      reduceMotion: false,
      visible: true
    });
    expect(plan.initialTranslation).toBe(800);
    expect(plan.animateTranslationTo).toBe(0);
    expect(plan.travel).toBe(true);
  });

  it("uses opacity only with Reduce Motion", () => {
    expect(swipeSheetPresentationPlan({
      exitTarget: 800,
      reduceMotion: true,
      visible: true
    })).toEqual({
      animatePresenceTo: 1,
      animateTranslationTo: 0,
      initialPresence: 0,
      initialTranslation: 0,
      travel: false
    });
  });

  it("keeps the exact released position during a Reduce Motion exit fade", () => {
    expect(swipeSheetExitPlan({
      currentTranslation: 72,
      exitTarget: 800,
      reduceMotion: true
    })).toEqual({
      fadeOnly: true,
      translationTarget: 72
    });
  });

  it("continues to the off-screen target during a normal exit", () => {
    expect(swipeSheetExitPlan({
      currentTranslation: 72,
      exitTarget: 800,
      reduceMotion: false
    })).toEqual({
      fadeOnly: false,
      translationTarget: 800
    });
  });
});
