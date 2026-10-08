# Review card reason line flicker (8 Oct 2026)

Status: open — needs a device capture.

## Report
Owner's staging phone test: the reason line on one Location Review card alternated between "Needs review · start or end place isn't saved" and "Needs review · automatic location logging is not enabled" within seconds; the deck count also jumped from "14 of 160" to "14 of 56".

## Findings
- **Count (fixed in step 5d):** right after a swipe the decision is still syncing, so `reviewCountIsExact` is false and "M" fell back to the loaded deck length. The deck now keeps the last exact total while its own decisions sync.
- **Reason (open):** the copy comes from `locationReviewReasonCopy` (`apps/mobile/src/lib/review.ts`). With `rawPayload.semanticReason = "review_mode"` it says "automatic location logging is not enabled"; when the payload has no `semanticReason`, a commute without a saved place falls back to "start or end place isn't saved". `/api/bootstrap` review items carry `activity_events.raw_payload`, while Review presentation/backlog records are built by `review-presentation-service.ts` and do not pass that payload through. The deck item can therefore be replaced by copies with different payloads as bootstrap reloads and backlog pages merge, which matches the flicker.

## Next step
On a staging or dev build, log (temporary debug instrumentation; the support export does not include item payloads) the item's `rawPayload.semanticReason` each time the deck item is replaced, noting which read replaced it (bootstrap reload, backlog page or local projection), for one flickering card. Then pick one source for the deck's reason (prefer the server's semantic reason) so reloads cannot switch it, crossfading genuine changes. A server-side fix (bootstrap and presentation agreeing) would be a hosted change needing owner approval.

## Closure
Close when one flickering card shows a single, stable reason across bootstrap reloads and backlog pages on a device.
