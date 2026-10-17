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
