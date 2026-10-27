/**
 * Location v3 naming (PRD D19, design §4): everything location finds is a Stay or a Move. Titles are
 * made on the server so web, iPhone and exports agree; clients show `title` and the Move's `route`.
 */

/** One end of a Move: the place's display name (Home and Work by their role label) and its role. */
export type MoveEndpoint = { name: string | null; role: "home" | "work" | null };

/** What a Move suggests as its activity: Commute between Home and Work, Errands with a stop, else Getting around. */
export type MoveActivityKind = "commute" | "errand" | "travel";

export type MoveName = { title: string; route: string; activity: MoveActivityKind };

/** Every trip's title but a Commute's (PRD D21): the default activity's own name. */
export const GETTING_AROUND = "Getting around";

const endpointName = (endpoint: MoveEndpoint) => endpoint.name?.trim() || "Unknown place";

/**
 * A Move's title, route line and activity. A trip is "Getting around", "Commute" between Home and Work, or
 * "Trip" with a stop; its modes show only in its leg line, never in its title or route, so a title never
 * names a mode the trip's legs don't have (card A, owner feedback 25 Oct: "Drive" over three Underground legs).
 * - Home ↔ Work, any mode: "Commute", "Home → Work".
 * - With a stop: "Trip", "Home → a stop → Home" (an errand: Errands when the workspace has it, PRD D19).
 * - Back to where it started (a round trip, or time away from a place): "Getting around", "Round trip from Home".
 * - Otherwise: "Getting around", "Home → Gym".
 */
export function moveName(input: {
  from: MoveEndpoint;
  to: MoveEndpoint;
  /** Both ends are the same known place. */
  sameEndpoint: boolean;
  stopCount?: number | null;
}): MoveName {
  const from = endpointName(input.from);
  const to = endpointName(input.to);
  const roles = new Set([input.from.role, input.to.role]);
  if (!input.sameEndpoint && roles.has("home") && roles.has("work")) {
    return { title: "Commute", route: `${from} → ${to}`, activity: "commute" };
  }
  const stops = Math.max(0, Math.floor(input.stopCount ?? 0));
  if (stops > 0) {
    return { title: "Trip", route: `${from} → ${stops === 1 ? "a stop" : `${stops} stops`} → ${to}`, activity: "errand" };
  }
  if (input.sameEndpoint) return { title: GETTING_AROUND, route: `Round trip from ${from}`, activity: "travel" };
  return { title: GETTING_AROUND, route: `${from} → ${to}`, activity: "travel" };
}

/** A Stay's title: the place's name, "Near saved places" for an ambiguous match, else "Unknown place". */
export function stayName(input: { name: string | null | undefined; ambiguous?: boolean }) {
  const name = input.name?.trim();
  if (name) return name;
  return input.ambiguous ? "Near saved places" : "Unknown place";
}
