# Today + Integrated Review — Stage B evidence

This is an implementation evidence trail for Stage B. Delivery status belongs
in the [feature tracker](../feature-fix-tracker.md); product and runtime
contracts remain owned by the PRD, architecture and canonical references.

## Verified baseline

- Isolated worktree branch: `codex/today-integrated-review`.
- Actual base: `e9ca2652542619cd83b91bb7778a608a13e1d01e`
  (`origin/main` at implementation start), matching the handoff plan's
  verified PR #195 merge baseline.
- The source worktree was clean before the isolated worktree was created; no
  local change was adopted or reverted.
- The roadmap and feature tracker still describe PR #195 as open. That is
  stale coordination text, not deployment or physical-device evidence; Stage
  B updates that text without claiming a new hosted or device result.

## Preserved ownership boundaries

- The existing Dashboard remains the authenticated bootstrap and timer owner.
- The existing Review SQLite store remains the only Review cache, outbox,
  durable-effect and delivery owner.
- The read model is app-session scoped, read-only, bounded and separate from
  mutation processing. It does not obtain a timer or Review mutation lock.
- No Health, Location, timer, auth or sync owner is added. The Stage B chart
  is a Today-only projection and does not change Reports or Calendar.

## Baseline regression evidence

Before Stage B source changes, the following focused mobile baseline passed:

```text
npm run test -w @dayframe/mobile -- --run \
  src/components/HistoryDayCard.render.test.tsx \
  src/components/charts/DonutChart.test.tsx \
  src/components/reports/ReportsTab.test.tsx \
  src/components/reports/reportAccessibility.contract.test.ts \
  src/components/accessibility/TodayTimerSurface.test.tsx \
  src/components/accessibility/TodayDateHeading.test.tsx \
  src/components/accessibility/TodayLoggedSummary.test.tsx

PASS: 7 files, 30 tests
```

The initial run was blocked because a newly-created isolated worktree did not
yet have dependencies installed (`vitest: command not found`). `npm ci` then
installed the lockfile-defined local workspace dependencies; no application,
staging or production data was accessed.

## Accounting and handover decision

Stage B treats a local Review commit as a durable saved decision, not a new
logged interval. The source row changes immediately to a saved/syncing state,
leaves awaiting-review geometry, and contributes no invented canonical entry.
Only a current scoped canonical result linked by persisted evidence may add a
completed interval, once per actual entry ID. A receipt proves a saved action;
it is not itself a canonical interval.

## Motion contract

- Trigger: a complete Today presentation generation arrives, or a Review
  source crosses needs-review → locally-saved → explicitly-linked canonical.
- Owner: the Today presentation layer; durable Review delivery remains owned
  by the existing Review store and has no animation authority.
- Entrance/update/exit: the summary and its rows use a restrained opacity and
  position transition; a locally saved row retains its identity while the
  provisional slice exits. A linked canonical row enters only after current
  canonical evidence is available.
- Surrounding layout: list layout remains owned by the existing virtualised
  Today history; summary size changes reserve normal document-flow space and
  do not move timer controls unexpectedly.
- Interruption: a newer owner/range generation replaces an unfinished
  presentation transition; a second check press is locally gated while the
  store transaction commits.
- Async and rollback: no HTTP spinner promises completion. A SQLite commit
  keeps the saved row through retry/backoff; a proven, source-scoped rejection
  restores only the explicitly open source. Unknown results remain marked
  unresolved rather than animating back to a fresh proposal.
- Reduce Motion: visual state changes settle without transform/rotation while
  semantic labels and VoiceOver announcements remain available.

## Remaining validation gates

Automated checks, a staging-backed Preview/alias smoke, and an identified
ordinary signed staging build plus owner physical-iPhone acceptance are
separate evidence. None is claimed by this note until recorded with the
actual SHA, backend identity and result.
