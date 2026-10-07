import type { View } from "react-native";

/**
 * The Blocks Stop flight (design/blocks/ios.html stopTimer): the live block squashes, then shrinks
 * and flies into its row in Today's blocks; the row block pops when it arrives. 620 ms on
 * cubic-bezier(.3,.7,.2,1), keyframes at 0, 16% and 100% of the eased progress.
 */
export const STOP_FLIGHT = {
  durationMs: 620,
  easing: [0.3, 0.7, 0.2, 1] as const,
  squashAt: 0.16,
  squash: { translateY: 6, scaleX: 1.02, scaleY: 0.94 },
  endOpacity: 0.9,
  /** The ghost's content (chip, title, timer, actions) fades while the block flies. */
  contentFadeMs: 200,
  /** With nowhere to land (no row for the entry), the ghost fades where it is. */
  fadeInPlaceMs: 200,
  /** A row that moved once Stop committed (the idle card is shorter) is chased over this long. */
  retargetMs: 180,
} as const;

export type FlightFrame = { x: number; y: number; width: number; height: number };

export type StopFlightPose = {
  opacity: number;
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
};

function lerp(from: number, to: number, t: number) {
  "worklet";
  return from + (to - from) * t;
}

/**
 * Where the ghost is at eased progress `e` (0–1). The ghost is laid out at `from`; transforms use
 * its centre, so the end pose puts its centre on the target's centre at the target's size.
 */
export function stopFlightPose(e: number, from: FlightFrame, to: FlightFrame): StopFlightPose {
  "worklet";
  const end = {
    opacity: STOP_FLIGHT.endOpacity,
    scaleX: from.width > 0 ? to.width / from.width : 1,
    scaleY: from.height > 0 ? to.height / from.height : 1,
    translateX: to.x + to.width / 2 - (from.x + from.width / 2),
    translateY: to.y + to.height / 2 - (from.y + from.height / 2),
  };
  const squash = { opacity: 1, scaleX: STOP_FLIGHT.squash.scaleX, scaleY: STOP_FLIGHT.squash.scaleY, translateX: 0, translateY: STOP_FLIGHT.squash.translateY };
  if (e <= STOP_FLIGHT.squashAt) {
    const t = STOP_FLIGHT.squashAt > 0 ? Math.max(0, e) / STOP_FLIGHT.squashAt : 1;
    return {
      opacity: 1,
      scaleX: lerp(1, squash.scaleX, t),
      scaleY: lerp(1, squash.scaleY, t),
      translateX: 0,
      translateY: lerp(0, squash.translateY, t),
    };
  }
  const t = Math.min(1, (e - STOP_FLIGHT.squashAt) / (1 - STOP_FLIGHT.squashAt));
  return {
    opacity: lerp(squash.opacity, end.opacity, t),
    scaleX: lerp(squash.scaleX, end.scaleX, t),
    scaleY: lerp(squash.scaleY, end.scaleY, t),
    translateX: lerp(squash.translateX, end.translateX, t),
    translateY: lerp(squash.translateY, end.translateY, t),
  };
}

/** A frame worth flying to: measured, with a size. */
export function isUsableFrame(frame: FlightFrame | null | undefined): frame is FlightFrame {
  return Boolean(frame && frame.width > 0 && frame.height > 0 && [frame.x, frame.y].every(Number.isFinite));
}

/*
 * Nodes the flight measures: the live block ("live") and Today's row blocks ("row:<entryId>").
 * Components register their host views while mounted; the Dashboard measures them in window
 * coordinates when a Stop is accepted. Nothing here animates.
 */
const nodes = new Map<string, View>();

export const LIVE_FLIGHT_NODE = "live";
export const rowFlightNode = (entryId: string) => `row:${entryId}`;

/** Registers a host view, or with `null` removes `previous` (only if it is still the one registered). */
export function registerFlightNode(key: string, node: View | null, previous?: View | null) {
  if (node) nodes.set(key, node);
  else if (previous && nodes.get(key) === previous) nodes.delete(key);
}

/** Registers `node` under `key` from a callback ref; returns the ref callback. */
export function flightNodeRef(key: string | undefined) {
  let current: View | null = null;
  return (node: View | null) => {
    if (!key) return;
    if (node) {
      current = node;
      registerFlightNode(key, node);
    } else {
      registerFlightNode(key, null, current);
      current = null;
    }
  };
}

export function measureFlightNode(key: string): Promise<FlightFrame | null> {
  const node = nodes.get(key);
  if (!node || typeof node.measureInWindow !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      node.measureInWindow((x, y, width, height) => {
        const frame = { height, width, x, y };
        resolve(isUsableFrame(frame) ? frame : null);
      });
    } catch {
      resolve(null);
    }
  });
}
