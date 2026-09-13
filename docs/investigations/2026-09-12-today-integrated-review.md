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
- The roadmap and feature tracker record PR #195 as merged. Their Stage B
  coordination text remains distinct from deployment or physical-device
  evidence; this work does not claim a new hosted or device result.

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

## Completed implementation and focused gates

The ordered source commits, all based on
`e9ca2652542619cd83b91bb7778a608a13e1d01e`, are:

- `343fcc99ff665f4ba6b40c9a2ebc8099402bdfe0` — baseline evidence;
- `86782435185f9f2e43b83eb22986c9e13a0ed758` — bounded presentation read;
- `8630908eb3b227491590a7ffbbfb808da23f42fd` — durable handover evidence;
- `9b9ae268fc4e95c2d2cfa13ded418e8bb1345207` — guarded Quick Confirm;
- `5369c54af780fac5df05389bc6db20e783593321` — pure Today accounting;
- `b2142aff77bda8cd61b1073195b77e7542a6df77` — scoped cache hardening;
- `8dcc97cdbe06390576c474634a6c82996bab9086` — Today rows and exact Review
  navigation;
- `9c0fb30ea113742ede41601f6c93b4329c5f15bd` — opt-in Today donut and its
  accessibility contract; and
- `90f643aea4e906392b0dd1c6fc997cc9246cc0db` — partial-summary qualification;
- `0d48b7a7c23fcaacb10a5c290985a69398199d3a` — test-mock lint hygiene; and
- `9a2bf3ad8f2e1d7bbb3e9222f8ce6f749d5eb3da` — native exact-focus handover;
  and
- `5745ea8a4134ef14b5c6444ec65fc96bab9f5beb` — first exact-head review
  corrections;
- `e3c8962fce046b4f92c2cefe0bf17c9786d0e93a` — explicit equivalent-result
  handover proof; and
- `f12aabcebb5947ef82ed128adb2727c7cdde5684` — accessible bounded Review
  backlog paging; and
- `068bde70990318c8a3f8fc7e3af1b1546f0c3694` — retryable foreground
  handover proof.

The required gates were deliberately run before the donut was introduced:

```text
@dayframe/mobile Review store, Quick Confirm, presentation-client and pure
Today projection suite: PASS (4 files, 47 tests)
@dayframe/web presentation/mutation/Location Review suite: PASS (3 files,
21 tests)
@dayframe/shared presentation/acknowledgement suite: PASS (2 files, 14 tests)
```

After the Today rows and then after the donut, the focused mobile navigation,
row, summary, history, Quick Confirm, Review SQLite and guarded Reports/
accessibility suites also passed. The final partial-summary guard was rerun
with the donut and Reports suites: PASS (4 files, 27 tests).

All four disposable-data validators passed again at code head
`068bde70990318c8a3f8fc7e3af1b1546f0c3694`. The SQLite scripts create and
remove their own temporary databases. The two Postgres validators ran after a
fresh local PostgreSQL 17 instance was initialised on loopback with ordered
schemas in databases named `dayframe_stage_b_review_test` and
`dayframe_stage_b_location_test`; their built-in localhost-and-`*_test`
refusal and fixture cleanup were retained. That local server was stopped after
the run. No staging or production data was contacted.

At code head `068bde70990318c8a3f8fc7e3af1b1546f0c3694`, the broad test
command passed: mobile 138 files / 1,188 tests; web 134 passed files plus one
intentional skipped file / 909 passed tests plus two intentional skips; shared
16 files / 250 tests. The time-zone-sensitive Today presentation/client/label/
focus/handover suite also passed 20 tests each with `TZ=UTC`,
`TZ=Europe/London`, and `TZ=America/Los_Angeles`. `npm run lint`,
documentation alignment, iOS configuration, brand-asset checks and the web
production build passed; lint retains only two pre-existing warnings in
`event-service.test.ts`.

The web production build passed. At
`6042bbb8dd25c3f1ddab7620bb95223f6dc87e50`, and again at
`578c98fe715c1182a9edeeab49937a5b58862af2`, a clean `expo run:ios` Debug
simulator build passed and installed on `Dayframe Accessibility Max QA`; its
built host and extension lane metadata passed the built-product iOS
configuration check. The final run needed a local `pod install` to repair a
generated CocoaPods sandbox/lock mismatch; its three path-dependent checksum
changes were restored before the repository check. The compiler emitted one
pre-existing duplicate `-lc++` linker warning. This is
configuration/compilation evidence only, not a signed staging or physical-
iPhone acceptance claim.

`npm run typecheck` remains **FAIL** only at the unmodified baseline file
`apps/mobile/src/components/ConnectivityStatusStrip.tsx(27,43)`: TypeScript
cannot resolve `expo-symbols`. Mobile, web and shared Stage B diagnostics do
not appear; web and shared typechecks complete after the mobile failure. This
pre-existing dependency-resolution issue is recorded rather than masked by an
unrelated dependency/configuration change.

## Independent review correction

The available cloud whole-PR review integration could not start because its
GitHub App lacks repository access. A local read-only review of the former
`c2fa2921c919e862dd83257e228687730d157863` head found two actionable issues:

- a guarded generic accept checked its proposal hash before resolving an
  already-closed source; and
- a locally saved Sleep Review whose explicit canonical entry was already
  visible could display both the saved row and that entry before receipt
  verification, even though duration was not counted twice.

`5745ea8a4134ef14b5c6444ec65fc96bab9f5beb` checks terminal state before the
optional hash and suppresses the saved row whenever explicit, current canonical
evidence is visible. It adds targeted regression coverage for both cases.

The subsequent exact-head review found two further proof gaps: ordinary Today
reads did not trigger a terminal/result lookup for an already acknowledged
Review effect, and Review did not expose a page after the capped bootstrap
list. `e3c8962fce046b4f92c2cefe0bf17c9786d0e93a` adds one cancellable display
handover reader that requests all structural sources together, follows only
explicit accepted source-to-entry links, and requires current result/missing
evidence before the existing store can retire its effect. It also makes lookup
lineage include the persisted receipt relation used by the normal reader.
`f12aabcebb5947ef82ed128adb2727c7cdde5684` adds serial, cancellable 100-item
backlog pages to the existing Review route, an accessible Load more action, one
bounded snapshot restart and truthful count qualification. Neither correction
adds a queue, mutation owner, timer, Health, Location, auth, or sync owner.
`068bde70990318c8a3f8fc7e3af1b1546f0c3694` clears only an ephemeral failed
foreground-handover dedupe marker, allowing a later existing foreground or
store-subscription trigger to retry the bounded proof without a poll, timer or
new delivery owner. Its hook regression proves the ordinary Today reader
invokes the handover reader.

An additional exact-head external read-only review was attempted at
`578c98fe715c1182a9edeeab49937a5b58862af2`, but the available local reviewer
returned an execution error without findings after its bounded read window.
That result is **NOT RUN**, not approval. Direct exact-head maintainer review
found no new actionable contract conflict, but does not substitute for an
independent review; no earlier review approval is treated as approval of this
corrected head.

## 2026-09-13 independent-review follow-up

Claude Sonnet's read-only review compared base
`e9ca2652542619cd83b91bb7778a608a13e1d01e` with PR #196 head
`b724de278f9cd862e19d85ae6593c6b2ddd0c983`. It reported the six existing CI
checks green for that reviewed head and requested changes rather than merge:

- the complete Today presentation did not receive the existing Dashboard
  manual timer/edit/delete projection, so a just-saved local manual completion
  could be absent until a server presentation read; and
- terminal Review suppression was account-only, and the typed Review-record
  schema exposed an unreachable `missing` status even though lookup misses are
  represented as `missing_review`.

`ecea295389942dea8d83a5252edaadc65120bf5d` wires the existing Dashboard
projection into `manualProjectedEntries` without adding a timer or Review
owner. Its regression begins with an otherwise complete empty response plus a
local stopped manual entry, then delivers the same canonical entry and proves
the completed total and row remain once.

`d69f6a8be6ed94f55d7f07ed6b2887f9e5ed3148` scopes terminal evidence by
account and backend, permits only a strictly later same-backend canonical
`open` record to clear it, treats `missing_review` as lookup evidence rather
than a Review status, and removes the unreachable schema branch. Store and
shared regressions cover backend isolation, delayed/equal-age non-revival,
later canonical reopening, and lookup-missing evidence.

At correction code head `d69f6a8be6ed94f55d7f07ed6b2887f9e5ed3148`, focused
mobile/shared/web suites passed. `npm run lint`, `npm run test` (mobile 138
files / 1,191 tests; web 134 passed files plus one intentional skipped file /
909 passed tests plus two intentional skips; shared 16 files / 251 tests),
`npm run build`, `npm run check:brand-assets`, and `git diff --check` passed.
All plan validators passed using only disposable data: both SQLite validators;
Review mutation and Location V2 database validators against fresh base and all
ordered PostgreSQL 17 schemas on loopback databases ending in `_test`.
`npm run typecheck` still fails only at the unmodified baseline
`ConnectivityStatusStrip.tsx(27,43)` `expo-symbols` resolution; web and shared
typechecks complete after that mobile failure. The temporary PostgreSQL server
contains only synthetic validator fixtures and is stopped after validation.

This fixes findings from the review of `b724de2`; it is not an independent
approval of the descendant. Re-review, exact-head Preview/staging smoke, the
ordinary signed staging build, and owner physical-iPhone acceptance remain
separate gates.

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

Draft PR #196 remains unmerged. Its Ready Preview for
`4d931dd8afb0cb3a2a05612931b8b14b5306c048` was promoted to
`https://dayframe-staging.vercel.app`; the staging root returned 200 and an
unauthenticated `POST /api/review/presentation` returned the expected
private/no-store 401 boundary. That earlier Preview cannot establish deployment
evidence for the later correction head. This is a deployment and anonymous
auth-boundary smoke only: no authenticated staging user, Health or Location
data, or physical device was used.

The identified ordinary signed staging build and owner physical-iPhone
acceptance remain separate from the completed local checks. An attempt to
create the ordinary `preview` iOS build stopped before a build was created:
this host has neither an authenticated Expo account nor an `EXPO_TOKEN`.
Accordingly the signed-build and physical acceptance results are **NOT RUN**,
not inferred from diagnostics. None of these gates is claimed until recorded
with the actual SHA, backend identity and result.
