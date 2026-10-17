// One Review card per outing (PRD D19): an unknown Stay's card and the Move cards either side of it
// share an outing key in their event payload (set by the server's emitter on open cards), and web
// Review and the iPhone deck show them as one card. Both group with these helpers.

/** The event-payload fields the emitter tags an outing's cards with. */
export const OUTING_KEY_PAYLOAD_KEY = "outingKey";
export const OUTING_ROLE_PAYLOAD_KEY = "outingRole";

export type OutingRole = "stay" | "in" | "out";

type OutingCard = {
  id: string;
  rawPayload?: Record<string, unknown> | null;
  suggestedStartedAt?: string | Date | null;
};

/** The key an outing's cards share, from their event payload. */
export function outingKeyOf(item: Pick<OutingCard, "rawPayload">) {
  const key = item.rawPayload?.[OUTING_KEY_PAYLOAD_KEY];
  return typeof key === "string" && key ? key : null;
}

/** The card's part in its outing: the Stay, the Move there ("in") or the Move on ("out"). */
export function outingRoleOf(item: Pick<OutingCard, "rawPayload">): OutingRole | null {
  const role = item.rawPayload?.[OUTING_ROLE_PAYLOAD_KEY];
  return role === "stay" || role === "in" || role === "out" ? role : null;
}

export type CardOuting<T> = { anchor: T; members: T[] };

function startMs(value: string | Date | null | undefined) {
  const ms = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

/**
 * The outings among these cards, by their Stay card's id: the unknown Stay's card (the anchor) with
 * the Move cards that share its key, in time order (then id). An outing whose Stay card is not among
 * them is no outing (its Moves show on their own). `eligible` leaves a card out of every outing
 * (a card whose own change is waiting stays a card of its own); an ineligible Stay has no outing.
 */
export function groupOutings<T extends OutingCard>(items: readonly T[], eligible: (item: T) => boolean = () => true) {
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    const key = outingKeyOf(item);
    if (key && eligible(item)) byKey.set(key, [...byKey.get(key) ?? [], item]);
  }
  const outings = new Map<string, CardOuting<T>>();
  for (const group of byKey.values()) {
    const anchor = group.find((item) => outingRoleOf(item) === "stay");
    const members = group.filter((item) => item !== anchor && outingRoleOf(item) !== null && outingRoleOf(item) !== "stay")
      .sort((a, b) => (startMs(a.suggestedStartedAt) - startMs(b.suggestedStartedAt)) || a.id.localeCompare(b.id));
    if (anchor && members.length) outings.set(anchor.id, { anchor, members });
  }
  return outings;
}

const OUTING_VERB: Record<string, string> = { automotive: "Drives", walking: "Walks", cycling: "Cycles", running: "Runs" };

/**
 * The words of an outing's travel line ("Drives there and back", "Walks there", "Travel on"): a verb
 * only when every Move says the same way of travelling.
 */
export function outingTravelWords(members: readonly Pick<OutingCard, "rawPayload">[]) {
  const modes = members.map((member) => member.rawPayload?.travelMode);
  const verb = typeof modes[0] === "string" && modes.every((mode) => mode === modes[0]) ? OUTING_VERB[modes[0]] ?? "Travel" : "Travel";
  const roles = new Set(members.map(outingRoleOf));
  const where = roles.has("in") && roles.has("out") ? "there and back" : roles.has("in") ? "there" : "on";
  return `${verb} ${where}`;
}
