# Dayframe Review and Reports UX Roadmap

> **Active programme coordination document. Not a replacement for canonical product, architecture or delivery documentation.**
> This records owner-approved future UX and the sequence for delivering it. It is not permission to implement all stages together, and it does not claim that the proposed UX is already shipped.

| Field | Value |
| --- | --- |
| Owner | KB |
| Prepared / last reviewed | 8 September 2026 |
| Revision | 1 |
| Repository | `kwabiwe/dayframe` |
| Verified preparation baseline | `origin/main` at `7db150c7ab65a157c15d0549c0f8578f2df36b77`, the merge of documentation-audit PR #192 |
| Intended repository location | `docs/roadmaps/review-ux-roadmap.md` |

## 1. Purpose and document ownership

Make Review part of the normal activity experience rather than somewhere detected activity is visible only in a separate inbox. Improve Reports first, then reuse suitable visual components for Today, extend the provisional model to Calendar, and bring the same concept to web.

Read this file for programme context in every new Codex implementation thread and independent Claude review. Read the **current, separately supplied PR-specific plan** for the authorised implementation scope, exact changes and acceptance tests. Detailed plans are prepared one stage at a time against freshly verified main, not all at once.

The [PRD](../PRD.md) owns canonical product requirements; [architecture](../architecture.md) owns runtime/data boundaries; the [feature tracker](../feature-fix-tracker.md) alone owns canonical delivery and release status. Follow [documentation governance](../documentation-governance.md). Promote approved changes into those documents in the implementing PR; do not leave lasting product rules only here.

Planned differences from current UI are intentional. An unanticipated conflict with an existing safety invariant must be reported, not silently resolved by changing product scope. Owner-approved revisions to this roadmap and the current plan must reach both implementer and reviewer.

## 2. Delivery sequence: one feature PR at a time

| Stage | Scope | Dependency / boundary |
| --- | --- | --- |
| A | **Reports polish and small reusable chart/control components** | First implementation stage. No new Review presentation or sync architecture. |
| B | **Today donut, provisional activity list and Quick Confirm** | Starts after A merges. Establishes the shared activity presentation projection over existing state owners. |
| C | **Calendar provisional Review generalisation** | Starts after B merges. Reuses its identities, accounting and resolution behaviour. |
| D | **Web integrated Review** | Starts after C merges. Reuses the product rules and server contracts, with desktop-appropriate presentation. |

These are sequential dependencies, **not stacked branches**:

```text
Roadmap adopted on main
  -> A: implement / review / revise / test / merge
  -> refresh main and prepare B's detailed plan
  -> B: implement / review / revise / test / merge
  -> refresh main and prepare C's detailed plan
  -> C: implement / review / revise / test / merge
  -> refresh main and prepare D's detailed plan
  -> D: implement / review / revise / test / merge
```

Do not reserve future GitHub PR numbers. Record actual PRs and evidence in the tracker. A stage may be split further only after owner agreement if implementation reveals a materially larger scope.

## 3. Existing foundations to preserve

The [merged documentation audit](../audits/2026-09-08-documentation-code-alignment.md) and architecture establish the preparation baseline:

- **Review durability and reconciliation:** resolving/structural actions use the existing account-owned Review outbox. SQLite v5 supports one/two-source effects; v6 adds interrupted-delivery, contention, reconciliation and acknowledgement metadata. Keep immutable mutation identities, selective restoration and receipt validation.
- **Health identity:** source journaling and Sleep revisions can resolve several signals into an existing canonical entry. Confirmation does not necessarily create a new entry. Preserve prior decisions, user edits and canonical resolution links.
- **Location authority:** display canonical Review suggestions, including downloaded cached copies. Do not manufacture provisional activities from raw local GPS, Health samples or upload journals. Evidence upload success is not semantic replay success. Preserve V2 authority, boundary corrections and rollout/cutover rules.
- **Existing owners:** extend presentation over the established bootstrap, durable-work projection and Review store. Do not add another queue, sync coordinator, Health/Location interpretation pipeline or timer owner. Native Calendar remains a presentation/action surface; React owns authenticated data and mutations.

The approved automatic-logging/overlap policy is already in the PRD. This programme does not loosen it or reimplement it in chart or Calendar code. Preserve category-first tracking, optional descriptions/categories and user-facing tags; do not return projects or clients to the normal UX.

## 4. Stage A: Reports decisions — Revision 3.2

The owner-approved Reports refinements Revision 3.2 supersede conflicting V3.1/V3
presentation requirements while retaining their unaffected safety and acceptance
rules. Revision 3 supersedes the earlier
Stage A layout and filtering decisions. Continue existing PR #194, not a second
Reports PR. Preserve the extracted Reports owner and useful chart primitives.
Revision 3.2 retains the final-fixes addendum's unaffected requirements:
filter-sheet-only selection, explicit seven-cell week rows, compact measured
numeric columns, adaptive left-aligned axis gutters and evidence-led text fixes;
it keeps Cancel and forbids Clear or dismiss-to-Today reset behaviour.
Native clipping and physical acceptance remain open until reproduced/retested;
see `docs/investigations/2026-09-10-reports-final-fixes.md`. A new Claude whole-PR
review follows known fixes and owner physical retests, not before them.

- One compact mobile Reports surface has one range chooser and one funnel/count action. Equal compact Today / Week / Month / Year controls live below the shared date sheet's swipe handle and Cancel action, not on a permanent strip or below a duplicate title. Both Reports sheets use `SwipeDismissSheet`; Done/Apply commits once, dismissal discards, and the current presentation remains mounted until its coordinated exit completes.
- The donut centre shows Total: summed confirmed logged activity clipped to the selected range. Concurrent entries count independently; there is no Time covered card or overlap explanation in mobile Reports. Web/Today goal coverage semantics are unchanged.
- Only selected positive categories appear in the donut and compact zero-gap summary list. Both use exact duration descending with stable category-key tie order. Angles, totals and percentages use the selected denominator, including spoken values. All/include/none stays reversible through the full category catalogue; None is valid and explains No categories selected. Bare ticks/dashes show filter selection, including mixed All. Uncategorized, duplicate names and unavailable stable IDs remain distinct.
- The filter sheet is the only category-selection surface: Apply commits, Cancel discards. Donut slices and category rows are informational, never filter/remove actions or extra popups; each row speaks its complete name, selected-time percentage and duration without moving focus.
- Custom ranges use inclusive device-local dates, reversible endpoint selection, no future dates and a maximum of 366 calendar days. Presets use whole local calendar periods, Week begins Monday, and future portions stay present with zero contribution.
- Activity over time uses one daily-total bar for Today/custom one day, seven daily Week bars, daily Month bars, twelve monthly Year bars, and clipped calendar-week/month custom buckets. Labels are weekday plus `DD/MM` for one day/Week, first and last `DD/MM` for Month/custom, and Jan/Mar/May/Jul/Sep/Nov for Year at normal widths. The plot remains fitted and non-scrolling with zero-height zero buckets, three nice ticks, one plot-level target and one bounded accessible tooltip.
- Confirmed active timer contribution follows the existing projected timer through one current instant; Review-needed entries and suggestions never contribute. Month/Year/custom use bounded authenticated aggregates rather than raw history. An unavailable uncached range says Connect to load this report range; cached results never masquerade as another range.
- Donut geometry follows available width, never font scale; show its clock total once, in the centre when it fits or in one bounded companion line. Durations use unbounded-hour HH:MM:SS, flooring only final labels, with natural spoken durations. Informational category rows target a measured 38–42-point ordinary pitch without a sibling gap and retain minimum-only height. They remain one line at every supported width/text size: only names ellipsise; percentages and durations remain complete. The Reports grid shares the entry picker's 349-point inner cap, adapting to 308 points at a 320-point host while retaining six 44-point rows.

Remove the superseded Pie/Bars switch, vertical category chart, two summary cards,
visible Review warning and fixed Current week Daily bars. Filters remain Reports-only.
Use a bounded workspace/user-scoped summary endpoint, a mounted exact-range memory
cache and abort/generation/session guards. Remove Reports-only bootstrap coverage
metadata; no new sync owner, persisted store, schema or native dependency.

Acceptance requires focused and repository checks, disposable database integration,
final-head independent Claude review via OpenClaw, exact Ready staging Preview and
signed staging iPhone checks (including maximum Dynamic Type). Revision 1/2 approvals
are historical, not Revision 3 acceptance. Do not merge automatically. Stages B–D
below remain unchanged and out of this PR.

## 5. Stage B: Today and integrated Review decisions

### Today arrangement

```text
Timer and quick actions
Daily donut
Subtle awaiting-review duration
Open Review control
Chronological activity list
```

The donut contains solid slices for **completed confirmed entries grouped by category**. Each eligible pending Review item has its **own individual slice**, even when several share a category. Pending slices use their category colour with hatching and a question-mark treatment; an unknown category uses a neutral provisional treatment. Tiny slices remain reachable through the corresponding activity row/accessibility action.

Only approximately the **four largest slices** receive external labels, with collision-safe placement. Confirmed labels use category names; pending labels use the activity name and a Review cue. Smaller slices stay individually addressable, not merged into an unidentified backlog slice.

Inside the donut:

```text
Total logged     <- smaller, light-grey / secondary text
8h 56m           <- larger duration
```

Below and outside it, show a restrained `+ 1h 12m awaiting review` when applicable. The running timer contributes **nothing to this donut or its centre total until stopped**; its normal live timer display remains unchanged.

Pending duration participates in slice geometry but contributes nothing to Total logged before user acceptance. The donut represents activity-duration distribution, not a 24-hour clock or unique coverage. Concurrent completed activities count in full towards logged duration; unique clock coverage remains a separate calculation.

The Open Review control shows **all outstanding items across dates**, with secondary today context, for example `13 items to review` / `4 today`. When backlog exists but none falls today, retain the control with `None today`. The chart/list only show the portion belonging to the displayed day.

### Rows and Quick Confirm

Pending activities appear chronologically alongside normal entries with a recognisable provisional treatment, detected time/category/place and `Needs review`. Tapping a pending row or slice opens that exact Review item.

An eligible row also has a **small trailing check control within a minimum 44-point touch target**. It accepts the exact complete proposal; no adjacent Dismiss button clutters the row. Show Quick Confirm only when the existing action contract supports unchanged acceptance and required data is valid. Incomplete items stay accessible through Review but must not invent a duration or be treated as running timers.

Persist the decision through the existing Review outbox before transforming the row. Network delivery must not hold the interaction open. Confirm changes the provisional representation in place; edited time/category/place moves or recolours it; Dismiss removes it without a replacement. Do not replay the full chart entrance for these changes.

### One projection, not another data store

The B plan must define stable presentation identities and distinguish:

| Presentation state | Meaning |
| --- | --- |
| `needs_review` | Canonical open suggestion, possibly read from the account-owned cache. |
| `accepted_locally` | User decision committed durably; normal-looking local presentation while existing sync proves the outcome. |
| `confirmed` | Canonical time entry, including a reused entry returned by reconciliation. |

These are presentation concepts, not a proposed replacement for persisted outbox states. Preserve needs-attention, rejection and unknown-outcome handling rather than flattening them into success.

A still-open canonical row after a timeout is **not** proof that the user's decision failed. Keep the durable intent and follow the existing retry/reconciliation rules. Only a proven rejection/conflict with canonical-open evidence permits restoration. Unknown outcomes stay recoverable; never silently discard them or fabricate a replacement mutation.

Map the provisional/local identity to the canonical result without rendering or counting both. Account for Sleep resolving into an existing entry and structural actions producing multiple results. Do not infer identity merely from overlapping timestamps or similar descriptions.

The B plan must explicitly settle local-versus-canonical total presentation, persistence across relaunch, stale bootstrap handling and canonical-ID handover before coding. A normal-looking local acceptance must not claim that server sync completed. Reuse existing stores; any minimal additional correlation metadata requires a justified, reviewed change within the existing owner.

## 6. Cross-surface accounting and identity

Use the same day clipping, identity and inclusion rules wherever an activity appears. A pending Sleep from 23:30 to 07:00 contributes 30 minutes to the first local day and seven hours to the second; it remains **one Review item**. Confirmation resolves every representation, not two separate mutations.

Use the user's local-day/timezone rules, including daylight-saving changes. Pending and confirmed activities may overlap visually. Do not clip activities against each other to make charts or calendars look tidy.

Global backlog counts, per-day pending counts and pending duration must be separate, deduplicated values. A limited bootstrap page/cache must not be mistaken for the complete backlog, and absence from a partial refresh must not be treated as deletion. Each detailed plan must verify that its read model covers the required range.

Preserve offline warmth, draft state, stable keys, account/backend ownership and current intent during refresh. No chart animation, navigation cancellation or filter change may cancel or erase a durable user decision.

## 7. Stages C and D

### C: Calendar

Extend the existing provisional-commute mechanism to all eligible finite Review activities using B's shared projection. Blocks occupy detected times, are visually distinct, may overlap normal entries, and open the exact Review item when tapped. Unconfirmed suggestions contribute zero to logged totals. Confirm transforms in place; corrections move/recolour; dismissal removes. Midnight clipping does not create duplicate identities.

Keep the existing native pinch/scroll/navigation owners. Native callbacks request semantic actions from React; native code does not independently confirm, fetch or persist activity. Validate ordinary creation/editing, overlap layout, zoom and cancelled gestures on a physical iPhone.

### D: Web

Adopt the same provisional activity concept in Timeline/List and Calendar, retaining the Review inbox and server receipt contracts. Use desktop-appropriate layout, keyboard/focus behaviour and responsive phone-width fallbacks. Do not copy the iOS SQLite implementation into the browser.

The exact web scope and whether a matching dashboard donut belongs in D will be settled in its detailed plan. Do not assume every mobile visual must be reproduced on web, or introduce offline browser persistence without separate approval.

## 8. Implementation, independent review and revision cycle

Each stage receives **one versioned Markdown implementation plan**, one short Codex implementation prompt, and one short OpenClaw/Claude review prompt. Prepare the next stage only after the previous one merges and its actual changes have been examined.

1. **Prepare:** fetch current main, read this roadmap and canonical docs, verify baseline, then prepare/approve the stage-specific plan. Record plan revision and baseline SHA. Preserve unrelated local changes.
2. **Implement:** use a new Codex thread and isolated feature branch/worktree from main. Implement only the current plan in reviewable commits. No automatic merge.
3. **Self-check:** run focused tests, applicable repository checks and documentation-impact checks; inspect changed files and Git status. Open/update the PR with evidence and explicitly unrun tests.
4. **Independent review:** OpenClaw invokes Claude Sonnet/Opus through the CLI on the Mac Mini, with the same plan revision available as a local file, this roadmap, relevant canonical docs and actual PR diff. Record base/head SHAs. Review is read-only; it is not a licence to rewrite the implementation.
5. **Revisions:** Claude reports Blocker / Important / Nice-to-have findings with file/line, consequence, evidence and recommended correction, plus an acceptance-criteria assessment. Codex addresses substantiated findings in the original implementation thread. Owner-approved deviations are written down and supplied to both agents.
6. **Re-review:** verify the fixes and inspect newly changed code at the new exact head. Do not carry an earlier approval forward automatically. Record remaining limitations; do not manufacture speculative findings simply to keep reviewing.
7. **Hands-on acceptance:** test the exact staging build/Preview. Send failures back through implementation and independent re-review. Changes after testing require applicable retesting on the new head.
8. **Merge and continue:** after owner approval, required checks and hands-on acceptance, merge, refresh main and update canonical delivery evidence. Review what actually landed before preparing the next plan.

The reviewer must not rely solely on the PR description or the implementer's summary. A plan attachment in Codex is not automatically available to Claude: OpenClaw must save/locate it and explicitly pass its path. Keep approved amendments and the current plan revision with the review handoff. Store review evidence in the PR or an appropriately sanitised repository note, not solely in a transient agent conversation.

## 9. Validation and release boundaries

Follow the current [validation matrix](../../.codex/reference/validation-matrix.md), [regression checklist](../dayframe-regression-checklist.md) and [release runbook](../../.codex/reference/release-and-testflight.md). The programme does not waive existing release gaps identified by the documentation audit.

**Before Stage B:** establish a signed physical-iPhone baseline for current Review actions, receipt recovery, Health/Sleep, Location/commutes, offline/reconnect and staging isolation. Confirm backend schema readiness. Record known inherited failures separately so the redesign is not blamed for unverified pre-existing behaviour. Reports planning need not wait for every historical incident to be closed; a known unsafe prerequisite must still be fixed before affected runtime testing/release.

**Every implementation PR:** promote its exact Ready Vercel Preview manually to `https://dayframe-staging.vercel.app`, using staging Supabase only. Test the signed preview with the separate staging identity and isolated App Group/Keychain; verify the baked API and signed identity rather than assuming coexistence proves isolation. No production configuration or personal production data for PR testing.

Test the feature's empty, warm-cache, offline, slow-response, conflict and cross-account states as applicable. Retain timer/Live Activity, Health/Location, category/tag, total/coverage and navigation regressions. Use synthetic 2/13/25/50-item backlogs for Review-related stages; measure actual iPhone responsiveness, not just desktop calculations.

For UI, require real device/browser evidence, Light/Dark/System, Dynamic Type, VoiceOver/keyboard, Reduce Motion and relevant Reduce Transparency checks. Follow the [motion contract](../../.codex/reference/motion.md): one owner per transition, restrained first entrance, correct update/exit, interruption and rollback. Still screenshots alone do not prove animation quality.

A source merge, green CI, Vercel deployment, schema readiness and a signed mobile release are separate facts. Record PASS / FAIL / NOT RUN and exact tested identities; do not mark missing historical release evidence as completed to tidy the roadmap.

## 10. Programme boundaries and remaining design detail

Keep automation policy, rollout decisions, existing sync/status presentation, retention, permissions and timer background execution intact. This programme does not add telemetry, full deletion semantics, native NFC, external beta/App Store scope, persisted icons, commute endpoint learning or raw-evidence reconstruction. Those remain in the canonical decision register.

Before each stage's implementation, resolve only its necessary remaining details: Reports filter edge cases and chart denominators; Today canonical/local accounting and identity; Calendar incomplete-item and collision presentation; web layout and scope. These are not permission to reopen the already agreed interactions or expand the work without KB's approval.

Do not impose a blanket prohibition on every read-model or metadata change if one is genuinely needed. Require evidence, a small scope, compatibility tests and the existing ownership boundary instead of creating parallel architecture.

## 11. Roadmap lifecycle and next action

Adopt this file through a **small documentation-only feature branch and PR**, not a direct push to main. Add one discoverability link from the contributor documentation and identify it as temporary programme coordination. The canonical tracker remains the only release-status register. Run `npm run check:docs` and `git diff --check`; independent review should confirm document scope and no accidental current-state claims. A pure roadmap addition needs no new iPhone binary or production migration.

After each stage merges, reconcile the remaining sequence and add only significant owner-approved decision changes here. Link to the tracker/PR evidence rather than copying mutable release tables or command logs. Revision history starts with revision 1: agreed Reports, Today, Calendar and web scope following PR #192.

When all stages finish, promote enduring requirements and guardrails to their canonical documents, then remove this temporary roadmap and its navigation links or replace it with a short dated historical completion note. Preserve useful decisions in Git history; do not leave a stale active roadmap behind.

**Next action:** finish Revision 3.2 implementation validation and staging/iPhone acceptance on existing PR #194, then request a new whole-PR Claude review. V3.2 wins conflicts with V3.1/V3; V1/V2 remain historical. Do not start Stage B or merge automatically; the tracker and PR hold current validation evidence.
