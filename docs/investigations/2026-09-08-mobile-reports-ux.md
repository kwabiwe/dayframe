# Mobile Reports UX — Stage A

## Scope and baseline

- Plan: `dayframe_reports_implementation_plan.md`, revision 1, prepared 2026-09-08.
- Baseline: `origin/main` at `439601c64880fe7bc4bc4618920149b0ce85e341`.
- Branch/worktree: `codex/reports-stage-a` in an isolated worktree.
- Pull request: #194, open and not merged.
- Scope: mobile Reports polish, category filtering, small chart/control primitives, and additive bounded bootstrap coverage metadata only.
- Explicitly unchanged: Today, Calendar, Review mutations/presentation, Health and Location capture, timer mutations, durable queues, native code, persistence, and roadmap Stages B–D.

## Verified starting defects

- Category presentation truncates after eight categories and the donut renormalises the retained subset.
- Daily bars attribute an entry's full duration to the local day on which it starts.
- The 100/300/2,000 bootstrap entry caps have no completeness descriptor.
- Reports range/chart state is owned by the retained Dashboard provider and schedules a global layout transition.
- The two segmented selectors use different light/dark treatments and target geometry.

No material product, ownership, privacy, or safety conflict was found between revision 1 and the baseline code. The cache snapshot sanitizer spreads additive bootstrap fields, so coverage metadata does not require a cache schema or state-machine change.

## Calculation and selection contract

- Category identity is the stable category ID; null category IDs use `uncategorized`.
- One explicit All/include selection drives logged time, unique covered time, additional overlap, category bars, and current-week Daily bars.
- Pie geometry and percentages use all eligible category time in the selected period. Excluded slices retain their geometry and are dimmed. The centre and summary totals use selected entries only.
- Coverage is recomputed from selected intervals through the shared `analyzeTimeIntervals` contract. Review-needed entries and Review suggestions remain excluded.
- The projected active confirmed entry is deduplicated by ID and included through the same captured `now` in every Reports calculation.
- Daily durations clip half-open intervals into calendar-advanced local-day windows. No day is assumed to contain 24 hours.
- Missing coverage metadata is `unknown`; known capped/gapped coverage is `partial`; filtering never upgrades completeness.

## Motion contract

- Trigger: the first focused, foreground, populated Pie presentation for the authenticated backend/workspace/user owner; later range, source, selection, and view changes are updates.
- Owner: the extracted React Native Reports/chart layer using Reanimated UI-thread values. Native tabs continue to own tab navigation; the filter modal owns only its own presentation.
- Entrance/update/exit: one restrained 260 ms numerical donut reveal; keyed arcs interpolate on data/range updates; filtering fades emphasis without changing context geometry; separately keyed Pie/Bars owners use a local opacity/layout transition. Closing the filter modal uses the established modal surface owner.
- Surrounding layout: Reports-local transitions only; no global `LayoutAnimation.configureNext` call.
- Interruption: a newer keyed target replaces the current Reanimated target. Blur/background settles decorative work to current data, preserves filters, and prevents stale entrance completion from replaying.
- Async outcome: no network mutation or Undo path exists. Filter Apply commits one local selection atomically; Cancel, backdrop dismissal, route blur, or owner replacement discards the draft.
- Accessibility: Reduce Motion applies final geometry immediately (optional short opacity only); VoiceOver uses native category controls rather than tiny SVG slices; focus returns to Filters after ordinary close; Dynamic Type may grow/wrap cards and headers, and the donut measures its available width before enlarging its frame and centre with the system font scale; opacity is supplemented by checked/selected state and text.

## Source limits and validation evidence

The implementation keeps the existing entry-array limits and fetches only one additional row per bounded window to derive `hasMore`. Large datasets can remain partial; Stage A does not add pagination or an unbounded report endpoint.

### Automated and host evidence

- Focused Reports/component/model/cache/session checks: **PASS**, 8 files and 40 tests after the final route-blur, one-presentation, source-qualification and overnight/invariant additions. Focused web query checks: **PASS**, 6/6.
- Workspace typecheck: **PASS** for mobile, web and shared.
- Controlled workspace tests: mobile **PASS**, 110 files and 1,022 tests; shared **PASS**, 14 files and 236 tests. Web ran 128 passing files, one skipped file and one unrelated failure in `categoryPicker.dom.test.tsx` while waiting for an existing creation dialog; its single isolated rerun then passed 1 file/6 tests. Both the first result and rerun are retained rather than calling that controlled invocation wholly green.
- Lint/docs/iOS-config: **PASS** with 0 errors and two pre-existing `_values` warnings in `apps/web/src/lib/event-service.test.ts`. Production Next.js build: **PASS**, 38 pages. Brand assets, Review SQLite (21 tests), Location V2 SQLite and `git diff --check`: **PASS**.
- Disposable local PostgreSQL check: **PASS**. A fresh database received event-first synthetic rows inside a rollback transaction. Day fetched 101 and returned 100; week 301/300; history 2,001/2,000; all three set `hasMore=true`. The scoped query exposed 0 rows from the other workspace and equal timestamps stayed ID-descending. The transaction was rolled back and the disposable database removed.
- Warm pure-model aggregation on this Mac, 40 post-warm iterations: 50 entries averaged **2.274 ms**; 300 entries averaged **28.908 ms**. These are host aggregation measurements, not iPhone paint or interaction timings.
- Clean unsigned iOS simulator build: **PASS** with Xcode 26.6 against generic iOS Simulator after a local `pod install`; the tracked Podfile lock remained unchanged. The host app and extension compiled and the output identity was `com.layereight.dayframe`, so this is not signed staging evidence.
- Claude-review correction checks: **PASS**, 2 focused component files and 11 tests. Coverage pins a filtered zero-time selection with retained dimmed context, distinct keyed Pie/Bars owners, 1.25×/1.5×/2× donut sizing bounded by measured width, and independent hatch pattern IDs. The complete mobile suite subsequently passed **111 files and 1,030 tests**; workspace typecheck, lint, documentation alignment and iOS configuration checks also passed. Lint retained only the two pre-existing `_values` warnings in `apps/web/src/lib/event-service.test.ts`.

### Staging and device evidence

- Local iOS simulator interaction: **NOT RUN to acceptance**. The app shell rendered on the iOS 26.5 Dayframe Sheet QA SE simulator, but the unsigned app could not recover or clear its session because Expo SecureStore reported a missing Keychain entitlement. Reports therefore had no authenticated projected bootstrap; no chart/filter or motion claim is made from that run.
- Vercel PR Preview: the first committed implementation head `a40a4ee0ad33607b8315831a8f4001f7a192bdb9` produced a successful Preview at `https://dayframe-r7vzs3ur0-dayframeworkshop.vercel.app`; unauthenticated HTTP smoke returned 200 for `/`, `/reports`, `/timeline` and `/review`, and the expected 401 for `/api/bootstrap`. This is not authenticated browser or mobile evidence. The stable staging alias was **NOT PROMOTED** because independent review was not complete.
- Independent Claude review: **REQUEST CHANGES** at `fe6b1f5bf4985f4445836e5b8f6a370fb5b8e910` on 2026-09-09. It identified one blocker (the selected-zero Pie state omitted its required explanation) and two important code issues (fixed donut geometry under Dynamic Type and unkeyed Pie/Bars crossfade owners). Independent read-only re-review of correction commit `a36a2e69715465902ad235c4d348812d40e267d8` returned **APPROVE / no code blocker** after verifying all three corrections and the ownership, denominator, filtering, source-coverage and running-timer boundaries. The reviewer could not independently execute tests or read the external plan path in its sandbox, so this approval does not replace the recorded test evidence or physical-device acceptance. A subsequently noted unfiltered Bars empty-copy inconsistency was also corrected and covered before the final PR head.
- Signed `com.layereight.dayframe.staging` build and signed host/extension audit: **NOT RUN**.
- Physical-iPhone acceptance matrix, VoiceOver, Dynamic Type, Light/Dark/System, scroll/touch/motion recordings, filter-to-paint and warm-paint timings, timer/Review/Health/Location/sync regression: **NOT RUN**. Xcode listed the available physical iPhone targets as offline during this implementation session.
- Browser smoke against the exact Preview at desktop and phone widths: **NOT RUN** pending Preview.

The remaining large-dataset limitation is intentional: a capped history source stays partial and Stage A adds no pagination/read-model redesign. Stages B–D remain outside this change.
