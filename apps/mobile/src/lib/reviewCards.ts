import { OUTING_KEY_PAYLOAD_KEY, OUTING_ROLE_PAYLOAD_KEY, type ReviewPresentationSnapshot } from "@dayframe/shared";

/**
 * One count per outing (PRD D19, PR 12c): a presentation snapshot's open Review records as items for
 * the shared card count (`reviewCardsRemoved`), each with its outing if it has one, so a local
 * decision moves the server's counts of cards as the server would.
 */
export function presentationOutingItems(response: Pick<ReviewPresentationSnapshot, "records">) {
  return response.records.flatMap((record) => record.kind === "review" && record.status === "open" ? [{
    id: record.reviewItemId,
    rawPayload: record.outing ? { [OUTING_KEY_PAYLOAD_KEY]: record.outing.key, [OUTING_ROLE_PAYLOAD_KEY]: record.outing.role } : null,
    record
  }] : []);
}
