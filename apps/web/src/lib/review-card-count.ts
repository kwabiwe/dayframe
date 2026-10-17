/**
 * One count per outing (PRD D19, location v3 PR 12c). Review shows an unknown Stay's card and the
 * Move cards either side of it as one card, so a count of cards leaves out every open Move whose
 * outing's Stay card is open too (the shared `foldedOutingMemberIds` rule the iPhone uses for its
 * local decisions). Older iPhone builds still show those Moves as cards, so they keep the plain
 * count: bootstrap carries both, and the other replies give cards only to clients that ask.
 */
import { REVIEW_COUNT_CARDS, REVIEW_COUNT_REQUEST_HEADER } from "@dayframe/shared";

/** Whether this request asks for the count of cards (`REVIEW_COUNT_REQUEST_HEADER: cards`). */
export function wantsReviewCardCount(request: Request) {
  return request.headers.get(REVIEW_COUNT_REQUEST_HEADER) === REVIEW_COUNT_CARDS;
}

/** SQL: true when review item `ri` (its event `ae`) is a Move folded into its outing's open Stay card. */
export function foldedOutingMemberSql(ri = "ri", ae = "ae") {
  return `coalesce(${ae}.raw_payload ->> 'outingRole' in ('in', 'out') and exists (
    select 1
    from review_items outing_stay
    join activity_events outing_stay_event
      on outing_stay_event.id = outing_stay.event_id
     and outing_stay_event.workspace_id = outing_stay.workspace_id
     and outing_stay_event.user_id = outing_stay.user_id
    where outing_stay.workspace_id = ${ri}.workspace_id and outing_stay.user_id = ${ri}.user_id
      and outing_stay.status = 'open'
      and outing_stay_event.raw_payload ->> 'outingRole' = 'stay'
      and outing_stay_event.raw_payload ->> 'outingKey' = ${ae}.raw_payload ->> 'outingKey'
  ), false)`;
}

/** At most this many open outing Moves are mapped; beyond it the map is left out. */
export const OUTING_STAYS_LIMIT = 200;

/**
 * SQL ($1 workspace, $2 user): each open Move folded into its outing's open Stay card, as
 * `member` → `stay` review item ids (one row per Move; the rule of `foldedOutingMemberSql`). Clients
 * move a count of cards exactly with it when they decide cards locally (Codex r1 on #475): deciding a
 * folded Move changes nothing, deciding its Stay alone brings the Move back as a card.
 */
export const OUTING_STAYS_SQL = `with open_outing_cards as (
    select ri.id, ae.raw_payload ->> 'outingKey' as key, ae.raw_payload ->> 'outingRole' as role
    from review_items ri
    join activity_events ae on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
    where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open'
      and ae.raw_payload ->> 'outingRole' in ('stay', 'in', 'out')
  )
  select distinct on (m.id) m.id::text as member, s.id::text as stay
  from open_outing_cards m
  join open_outing_cards s on s.key = m.key and s.role = 'stay'
  where m.role in ('in', 'out')
  order by m.id, s.id
  limit ${OUTING_STAYS_LIMIT + 1}`;

/** The map, or null when there are more open outing Moves than `OUTING_STAYS_LIMIT`. */
export function outingStaysFromRows(rows: readonly { member: string; stay: string }[]) {
  if (rows.length > OUTING_STAYS_LIMIT) return null;
  return Object.fromEntries(rows.map((row) => [row.member, row.stay])) as Record<string, string>;
}
