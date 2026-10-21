import type { MotionTravelMode } from "./types";

/**
 * Location v3 naming (PRD D19, design §4): everything location finds is a Stay or a Move. Titles are
 * made on the server so web, iPhone and exports agree; clients show `title` and the Move's `route`.
 */

/** One end of a Move: the place's display name (Home and Work by their role label) and its role. */
export type MoveEndpoint = { name: string | null; role: "home" | "work" | null };

/** What a Move suggests as its activity: Commute between Home and Work, Errands with a stop, else Getting around. */
export type MoveActivityKind = "commute" | "errand" | "travel";

export type MoveName = { title: string; route: string; activity: MoveActivityKind };

const MODE_WORDS: Record<MotionTravelMode, string> = {
  automotive: "Drive",
  walking: "Walk",
  running: "Run",
  cycling: "Cycle"
};

/** "Drive", "Walk", "Run" or "Cycle" for a known travel mode, else null. */
export function moveModeWord(mode: unknown): string | null {
  return typeof mode === "string" && Object.hasOwn(MODE_WORDS, mode) ? MODE_WORDS[mode as MotionTravelMode] : null;
}

const endpointName = (endpoint: MoveEndpoint) => endpoint.name?.trim() || "Unknown place";

/**
 * A Move's title, route line and activity:
 * - Home ↔ Work, any mode: "Commute", "Drive · Home → Work".
 * - With a stop: "Trip", "Home → a stop → Home" (an errand).
 * - Back to where it started (a round trip, or time away from a place): the mode word or "Trip",
 *   "Round trip from Home".
 * - Otherwise: the mode word or "Trip", "Home → Gym".
 */
export function moveName(input: {
  from: MoveEndpoint;
  to: MoveEndpoint;
  travelMode?: unknown;
  /** Both ends are the same known place. */
  sameEndpoint: boolean;
  stopCount?: number | null;
}): MoveName {
  const mode = moveModeWord(input.travelMode);
  const from = endpointName(input.from);
  const to = endpointName(input.to);
  const roles = new Set([input.from.role, input.to.role]);
  if (!input.sameEndpoint && roles.has("home") && roles.has("work")) {
    return { title: "Commute", route: `${mode ? `${mode} · ` : ""}${from} → ${to}`, activity: "commute" };
  }
  const stops = Math.max(0, Math.floor(input.stopCount ?? 0));
  if (stops > 0) {
    return { title: "Trip", route: `${from} → ${stops === 1 ? "a stop" : `${stops} stops`} → ${to}`, activity: "errand" };
  }
  if (input.sameEndpoint) return { title: mode ?? "Trip", route: `Round trip from ${from}`, activity: "travel" };
  return { title: mode ?? "Trip", route: `${from} → ${to}`, activity: "travel" };
}

/** A Stay's title: the place's name, "Near saved places" for an ambiguous match, else "Unknown place". */
export function stayName(input: { name: string | null | undefined; ambiguous?: boolean }) {
  const name = input.name?.trim();
  if (name) return name;
  return input.ambiguous ? "Near saved places" : "Unknown place";
}
