// The Play orb and its bloom (Blocks prototype, design/blocks/ios.html openBloom): a coral orb
// beside the tab bar. Tap starts a bare block, or stops the running one; holding it for 360 ms
// fans out up to nine activities on two arcs above-left of the orb to slide to and release.

export const PLAY_ORB = {
  size: 64,
  /** How long the finger must rest on the orb before the bloom opens. */
  holdMs: 360,
  /** A finger that travels further than this before the bloom opens is not a tap. */
  tapSlop: 10,
  /** Bubbles within this distance of the finger are under it. */
  hitRadius: 44,
  bubbleSize: 54,
  maxActivities: 9,
  inner: { count: 3, radius: 112, fromDeg: 95, toDeg: 178 },
  outer: { radius: 196, fromDeg: 90, toDeg: 180 },
  /** Bubbles fly out from the orb with `pop`, this far apart. */
  staggerMs: 18,
} as const;

/**
 * Where iOS draws the tab bar's trailing circular item (the hidden "search"-role tab the orb sits
 * on), measured on iPhone 17 Pro, iOS 26: its centre is 52.5 points from the right edge and 53
 * points from the bottom with a 34-point home-indicator inset. The orb is centred on it.
 */
export const NATIVE_TRAILING_ITEM = { centerFromRight: 52.5, centerAboveSafeBottom: 19 } as const;

/** The orb's top-left in window points. Without a home indicator the bar sits 8 points higher. */
export function playOrbFrame({ bottomInset, height, width }: { bottomInset: number; height: number; width: number }) {
  const centerX = width - NATIVE_TRAILING_ITEM.centerFromRight;
  const centerY = height - (bottomInset > 0 ? bottomInset + NATIVE_TRAILING_ITEM.centerAboveSafeBottom : NATIVE_TRAILING_ITEM.centerAboveSafeBottom + 8);
  return { left: centerX - PLAY_ORB.size / 2, top: centerY - PLAY_ORB.size / 2 };
}

export type BloomActivity = {
  color: string | null;
  icon: string | null;
  id: string;
  name: string;
  pinned: boolean;
};

export type BloomSpot<T extends BloomActivity = BloomActivity> = {
  activity: T;
  /** Offset of the bubble's centre from the orb's centre, in points (y down). */
  dx: number;
  dy: number;
};

/**
 * The bloom's activities: pinned ones first, then by time over the last seven days, at most nine.
 * Ties keep the given (usage) order.
 */
export function bloomActivities<T extends BloomActivity>(
  activities: readonly T[],
  recentSeconds: ReadonlyMap<string, number>
): T[] {
  return activities
    .map((activity, index) => ({ activity, index }))
    .sort((left, right) =>
      Number(right.activity.pinned) - Number(left.activity.pinned) ||
      (recentSeconds.get(right.activity.id) ?? 0) - (recentSeconds.get(left.activity.id) ?? 0) ||
      left.index - right.index
    )
    .slice(0, PLAY_ORB.maxActivities)
    .map(({ activity }) => activity);
}

function arc<T extends BloomActivity>(list: readonly T[], radius: number, fromDeg: number, toDeg: number): BloomSpot<T>[] {
  return list.map((activity, index) => {
    const angle = ((fromDeg + ((toDeg - fromDeg) * (index + 0.5)) / list.length) * Math.PI) / 180;
    return { activity, dx: Math.cos(angle) * radius, dy: -Math.sin(angle) * radius };
  });
}

/** The first three on the inner arc, the rest on the outer one, as in the prototype. */
export function bloomSpots<T extends BloomActivity>(activities: readonly T[]): BloomSpot<T>[] {
  const inner = activities.slice(0, PLAY_ORB.inner.count);
  const outer = activities.slice(PLAY_ORB.inner.count, PLAY_ORB.maxActivities);
  return [
    ...arc(inner, PLAY_ORB.inner.radius, PLAY_ORB.inner.fromDeg, PLAY_ORB.inner.toDeg),
    ...arc(outer, PLAY_ORB.outer.radius, PLAY_ORB.outer.fromDeg, PLAY_ORB.outer.toDeg),
  ];
}

/** The bubble under a finger at (dx, dy) from the orb's centre, if any. */
export function bloomHit(spots: readonly { dx: number; dy: number }[], dx: number, dy: number) {
  "worklet";
  let best = -1;
  let bestDistance: number = PLAY_ORB.hitRadius;
  for (let index = 0; index < spots.length; index += 1) {
    const distance = Math.hypot(spots[index].dx - dx, spots[index].dy - dy);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}
