// The Blocks springs from `.codex/reference/motion.md`, expressed as CSS `linear()` easings so a
// CSS transition can be the single animation owner on web (the prototype's DF.spring).

export const BLOCKS_SPRINGS = {
  snap: { stiffness: 560, damping: 38 },
  land: { stiffness: 320, damping: 21 },
  sheet: { stiffness: 340, damping: 34 },
  pop: { stiffness: 420, damping: 18 },
  roll: { stiffness: 260, damping: 26 }
} as const;

export type BlocksSpringName = keyof typeof BLOCKS_SPRINGS;

export type SpringEasing = { easing: string; durationMs: number };

const FALLBACK: SpringEasing = { easing: "cubic-bezier(0.22, 1, 0.36, 1)", durationMs: 320 };
const cache = new Map<BlocksSpringName, SpringEasing>();

/** Simulates a unit-mass damped spring from 0 to 1 and samples it as a `linear()` easing. */
export function springLinearEasing(name: BlocksSpringName): SpringEasing {
  const cached = cache.get(name);
  if (cached) return cached;
  const { stiffness, damping } = BLOCKS_SPRINGS[name];
  const step = 1 / 240;
  const samples = [0];
  let position = 0;
  let velocity = 0;
  for (let index = 0; index < 240 * 3; index += 1) {
    velocity += (-stiffness * (position - 1) - damping * velocity) * step;
    position += velocity * step;
    samples.push(position);
    if (Math.abs(position - 1) < 0.001 && Math.abs(velocity) < 0.02) break;
  }
  const count = Math.min(56, samples.length - 1);
  const points = Array.from({ length: count + 1 }, (_, index) =>
    Number(samples[Math.round((index / count) * (samples.length - 1))].toFixed(4))
  );
  points[points.length - 1] = 1;
  const result = { easing: `linear(${points.join(", ")})`, durationMs: Math.round((samples.length / 240) * 1000) };
  cache.set(name, result);
  return result;
}

/** The spring as a transition easing, or the plain ease-out when `linear()` is unsupported. */
export function springTransition(name: BlocksSpringName): SpringEasing {
  const supported = typeof CSS !== "undefined"
    && typeof CSS.supports === "function"
    && CSS.supports("transition-timing-function", "linear(0, 1)");
  return supported ? springLinearEasing(name) : FALLBACK;
}

export function prefersReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
