/**
 * A test double for the parts of React Native's Animated that Dayframe's native-driver motion uses
 * (the live block's breathing ring and odometer digits). Each value exposes `.value` the way the tests
 * read Reanimated shared values: the number it was last set to, or a plain description of the
 * animation last started on it. `stops` counts stopAnimation calls and `writes` records every value.
 */
export type FakeAnimationDescription = {
  config?: Record<string, unknown>;
  kind: "loop" | "sequence" | "spring" | "timing";
  to: unknown;
};

type FakeAnimation = FakeAnimationDescription & {
  start: (callback?: () => void) => void;
  stop: () => void;
  target?: FakeAnimatedValue;
};

export class FakeAnimatedValue {
  value: unknown;
  stops = 0;
  writes: unknown[] = [];
  constructor(initial: number) {
    this.value = initial;
  }
  setValue(next: number) {
    this.value = next;
    this.writes.push(next);
  }
  stopAnimation() {
    this.stops += 1;
  }
}

function describeAnimation(animation: FakeAnimation): FakeAnimationDescription {
  const to = Array.isArray(animation.to)
    ? (animation.to as FakeAnimation[]).map(describeAnimation)
    : animation.to && typeof animation.to === "object" && "kind" in (animation.to as object)
      ? describeAnimation(animation.to as FakeAnimation)
      : animation.to;
  return animation.config === undefined ? { kind: animation.kind, to } : { config: animation.config, kind: animation.kind, to };
}

function startedOn(animation: FakeAnimation) {
  return () => {
    if (!animation.target) return;
    const description = describeAnimation(animation);
    animation.target.value = description;
    animation.target.writes.push(description);
  };
}

export function createFakeAnimated(onCreate?: (value: FakeAnimatedValue) => void) {
  class Value extends FakeAnimatedValue {
    constructor(initial: number) {
      super(initial);
      onCreate?.(this);
    }
  }
  const make = (animation: Omit<FakeAnimation, "start" | "stop">): FakeAnimation => {
    const full = animation as FakeAnimation;
    full.start = startedOn(full);
    full.stop = () => undefined;
    return full;
  };
  return {
    Value,
    View: "AnimatedView",
    loop: (animation: FakeAnimation, config?: Record<string, unknown>) =>
      make({ config, kind: "loop", target: animation.target, to: animation }),
    sequence: (animations: FakeAnimation[]) => make({ kind: "sequence", target: animations[0]?.target, to: animations }),
    spring: (value: FakeAnimatedValue, config: Record<string, unknown>) =>
      make({ config, kind: "spring", target: value, to: config.toValue }),
    timing: (value: FakeAnimatedValue, config: Record<string, unknown>) =>
      make({ config, kind: "timing", target: value, to: config.toValue }),
  };
}

export const fakeNativeEasing = { inOut: () => "ease", sin: "sin" };
