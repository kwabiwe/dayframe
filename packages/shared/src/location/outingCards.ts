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

/**
 * One count per outing (PRD D19, PR 12c): the open items that do not count as cards of their own, an
 * outing's Moves whose Stay is open among them. The server counts the same way
 * (apps/web/src/lib/review-card-count.ts), so a local decision moves a count as the server would.
 */
export function foldedOutingMemberIds<T extends Pick<OutingCard, "id" | "rawPayload">>(items: readonly T[]) {
  const stayKeys = new Set(items.filter((item) => outingRoleOf(item) === "stay").map(outingKeyOf));
  const folded = new Set<string>();
  for (const item of items) {
    const role = outingRoleOf(item);
    const key = outingKeyOf(item);
    if ((role === "in" || role === "out") && key && stayKeys.has(key)) folded.add(item.id);
  }
  return folded;
}

/** How many Review cards these open items show as: an outing counts once. */
export function reviewCardCount<T extends Pick<OutingCard, "id" | "rawPayload">>(items: readonly T[], within: (item: T) => boolean = () => true) {
  const folded = foldedOutingMemberIds(items);
  return items.filter((item) => !folded.has(item.id) && within(item)).length;
}

/**
 * How many cards leave the count when `removed` leave these open items (`within` limits it, e.g. to
 * today's): deciding a Stay on its own can bring its Moves back as cards, so this can be negative.
 */
export function reviewCardsRemoved<T extends Pick<OutingCard, "id" | "rawPayload">>(
  items: readonly T[],
  removed: ReadonlySet<string>,
  within: (item: T) => boolean = () => true
) {
  return reviewCardCount(items, within) - reviewCardCount(items.filter((item) => !removed.has(item.id)), within);
}

/**
 * How many cards leave a count when the open review items `removed` are decided, read from the
 * server's outing map (each open Move folded into its outing → that open Stay card; Codex r1 on
 * #475): a folded Move leaves no card; a Stay decided without its Moves brings them back as cards,
 * so this can be negative. Exact whatever the client has loaded. `within` limits it (today's ids).
 */
export function reviewCardsRemovedByOutings(
  outingStays: Readonly<Record<string, string>>,
  removed: Iterable<string>,
  within: (id: string) => boolean = () => true
) {
  const gone = new Set(removed);
  let cards = 0;
  for (const id of gone) {
    if (within(id) && !Object.hasOwn(outingStays, id)) cards += 1;
  }
  for (const [member, stay] of Object.entries(outingStays)) {
    if (gone.has(stay) && !gone.has(member) && within(member)) cards -= 1;
  }
  return cards;
}
