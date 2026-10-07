import { useLayoutEffect } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../node_modules/react/index.js");
});

type Animation = { kind: string; to: unknown; config?: Record<string, unknown>; delay?: number };
const assigned: Array<{ value: unknown }> = [];
const initialValues: unknown[] = [];

vi.mock("react-native-reanimated", () => ({
  Easing: { inOut: () => "ease", sin: "sin" },
  ReduceMotion: { Never: "never" },
  cancelAnimation: vi.fn(),
  useAnimatedStyle: (factory: () => unknown) => factory(),
  useSharedValue: (initial: unknown) => {
    initialValues.push(initial);
    const shared = { value: initial };
    assigned.push(shared);
    return shared;
  },
  withDelay: (delay: number, animation: Animation) => ({ ...animation, delay }),
  withRepeat: (animation: Animation) => ({ kind: "repeat", to: animation }),
  withSequence: (...animations: Animation[]) => ({ kind: "sequence", to: animations }),
  withSpring: (to: unknown, config: Record<string, unknown>) => ({ config, kind: "spring", to }),
  withTiming: (to: unknown, config: Record<string, unknown>) => ({ config, kind: "timing", to }),
}));
vi.mock("./motion", () => ({ MOBILE_MOTION: { control: 140 } }));

import {
  BLOCKS_SPRING,
  BREATHING_RING,
  DROP_IN,
  POP_FROM_SCALE,
  useBlockLanding,
  useBlockPop,
  useBreathingRing,
  useDropIn,
  type LandingRequest,
} from "./blocksMotion";

function Landing(props: Parameters<typeof useBlockLanding>[0]) {
  useBlockLanding(props);
  return null;
}

function Ring(props: Parameters<typeof useBreathingRing>[0]) {
  useBreathingRing(props);
  return null;
}

function mountLanding(props: Parameters<typeof useBlockLanding>[0]) {
  assigned.length = 0;
  initialValues.length = 0;
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<Landing {...props} />);
  });
  const [translateY, opacity] = assigned;
  return { opacity, translateY, tree };
}

const now = () => ({ requestedAt: Date.now() });

describe("useBlockLanding", () => {
  it("lands once with the Blocks landing spring and one small overshoot", () => {
    const request: LandingRequest = { ...now(), token: 1 };
    const { translateY, tree } = mountLanding({ distance: 14, reduceMotion: false, request });
    expect(translateY.value).toEqual({ config: { ...BLOCKS_SPRING.land, reduceMotion: "never" }, delay: 0, kind: "spring", to: 0 });
    translateY.value = 0;
    act(() => tree.update(<Landing distance={14} reduceMotion={false} request={request} />));
    expect(translateY.value).toBe(0);
    act(() => tree.unmount());
  });

  it("mounts already offset when its landing is due, so the first frame never paints at rest", () => {
    const due = mountLanding({ distance: 14, reduceMotion: false, request: { ...now(), token: 7 } });
    expect(initialValues.slice(0, 2)).toEqual([14, 1]);
    act(() => due.tree.unmount());
    const reduced = mountLanding({ distance: 14, reduceMotion: true, request: { ...now(), token: 8 } });
    expect(initialValues.slice(0, 2)).toEqual([0, 0]);
    act(() => reduced.tree.unmount());
    const idle = mountLanding({ distance: 14, reduceMotion: false, request: null });
    expect(initialValues.slice(0, 2)).toEqual([0, 1]);
    act(() => idle.tree.unmount());
  });

  it("still lands the token it mounted for even if the TTL lapses before the effect runs", () => {
    const realNow = Date.now;
    const start = realNow();
    let clock = start;
    Date.now = () => clock;
    try {
      const request: LandingRequest = { requestedAt: start - 1100, token: 9 };
      assigned.length = 0;
      initialValues.length = 0;
      let tree!: ReturnType<typeof create>;
      // Render while due (1.1 s old); a parent layout effect moves the clock past the 1.2 s TTL
      // before the landing's passive effect runs.
      const Delayed = () => {
        useLayoutEffect(() => {
          clock = start + 200;
        }, []);
        return <Landing distance={14} reduceMotion={false} request={request} />;
      };
      act(() => {
        tree = create(<Delayed />);
      });
      expect(initialValues[0]).toBe(14);
      expect(assigned[0].value).toMatchObject({ kind: "spring", to: 0 });
      act(() => tree.unmount());
    } finally {
      Date.now = realNow;
    }
  });

  it("does not replay for a remount after the request has expired, or for another entry's row", () => {
    const stale: LandingRequest = { requestedAt: Date.now() - 5000, token: 2 };
    const expired = mountLanding({ distance: 14, reduceMotion: false, request: stale });
    expect(expired.translateY.value).toBe(0);
    act(() => expired.tree.unmount());

    const forOther: LandingRequest = { ...now(), entryIds: ["entry-a"], token: 3 };
    const other = mountLanding({ distance: -10, entryId: "entry-b", reduceMotion: false, request: forOther });
    expect(other.translateY.value).toBe(0);
    act(() => other.tree.unmount());
  });

  it("keeps the state change with opacity only under Reduce Motion", () => {
    const request: LandingRequest = { ...now(), entryIds: ["entry-a", "entry-c"], token: 4 };
    const { opacity, translateY, tree } = mountLanding({ delayMs: 60, distance: -10, entryId: "entry-a", reduceMotion: true, request });
    expect(translateY.value).toBe(0);
    expect(opacity.value).toMatchObject({ delay: 60, kind: "timing", to: 1 });
    act(() => tree.unmount());
  });
});

describe("useBreathingRing", () => {
  function mountRing(props: Parameters<typeof useBreathingRing>[0]) {
    assigned.length = 0;
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Ring {...props} />);
    });
    return { opacity: assigned[0], tree };
  }

  it("breathes on opacity alone in a 2.4 s cycle while live", () => {
    const { opacity, tree } = mountRing({ live: true, reduceMotion: false });
    const loop = opacity.value as { kind: string; to: { to: Animation[] } };
    expect(loop.kind).toBe("repeat");
    const halves = loop.to.to;
    expect(halves.map((half) => half.to)).toEqual([BREATHING_RING.maxOpacity, BREATHING_RING.minOpacity]);
    expect(halves.reduce((sum, half) => sum + Number(half.config?.duration), 0)).toBe(BREATHING_RING.cycleMs);
    act(() => tree.unmount());
  });

  it("stays still under Reduce Motion and fades out when the block is no longer live", () => {
    const reduced = mountRing({ live: true, reduceMotion: true });
    expect(reduced.opacity.value).toBe(BREATHING_RING.reducedOpacity);
    act(() => reduced.tree.unmount());

    const stopped = mountRing({ live: false, reduceMotion: false });
    expect(stopped.opacity.value).toMatchObject({ kind: "timing", to: 0 });
    act(() => stopped.tree.unmount());
  });
});

describe("useBlockPop", () => {
  function Pop(props: Parameters<typeof useBlockPop>[0]) {
    useBlockPop(props);
    return null;
  }

  it("pops its row block once from 1.5 with the pop spring, and never for another entry or a stale request", () => {
    assigned.length = 0;
    const request: LandingRequest = { ...now(), entryIds: ["entry-a"], token: 11 };
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Pop entryId="entry-a" request={request} />);
    });
    const [scale] = assigned;
    expect(POP_FROM_SCALE).toBe(1.5);
    expect(scale.value).toEqual({ config: { ...BLOCKS_SPRING.pop, reduceMotion: "never" }, kind: "spring", to: 1 });
    scale.value = 1;
    act(() => tree.update(<Pop entryId="entry-a" request={request} />));
    expect(scale.value).toBe(1);
    act(() => tree.update(<Pop entryId="entry-a" request={{ ...request, entryIds: ["entry-b"], token: 12 }} />));
    expect(scale.value).toBe(1);
    act(() => tree.update(<Pop entryId="entry-a" request={{ ...request, requestedAt: Date.now() - 5000, token: 13 }} />));
    expect(scale.value).toBe(1);
    act(() => tree.unmount());
  });
});

describe("useDropIn", () => {
  function Drop(props: Parameters<typeof useDropIn>[0]) {
    useDropIn(props);
    return null;
  }

  it("drops a first-paint tile from 18 points and 92 %, staggered by its order", () => {
    assigned.length = 0;
    initialValues.length = 0;
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Drop index={2} play />);
    });
    expect(initialValues).toEqual([DROP_IN.distance, DROP_IN.fromScale, 0]);
    const [translateY, scale, opacity] = assigned;
    const delay = DROP_IN.firstDelayMs + 2 * DROP_IN.staggerMs;
    expect(translateY.value).toMatchObject({ delay, kind: "spring", to: 0 });
    expect(scale.value).toMatchObject({ delay, kind: "spring", to: 1 });
    expect(opacity.value).toMatchObject({ delay, kind: "timing", to: 1 });
    act(() => tree.unmount());
    // An interrupted drop-in settles at rest.
    expect([translateY.value, scale.value, opacity.value]).toEqual([0, 1, 1]);
  });

  it("shows a tile at rest when it is not the app's first paint", () => {
    assigned.length = 0;
    initialValues.length = 0;
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Drop index={0} play={false} />);
    });
    expect(initialValues).toEqual([0, 1, 1]);
    expect(assigned.map((value) => value.value)).toEqual([0, 1, 1]);
    act(() => tree.unmount());
  });
});
