# Web Timeline Grouping And Delete Undo

Date: 2026-07-31

Branch: `codex/web-timeline-grouping-delete-undo`

Status: Ready for review

## Scope

This focused web Timeline PR restores normal grouping for blank uncategorized activities and replaces separate Calendar/List deletion paths with one immediate-delete, five-second Undo controller. It preserves PR 1's fixed timer/timecard, route toolbar, internal Calendar/List/Timesheet scrollers, and saved view/scope state.

It does not change mobile, Reports, APIs, database schema, Supabase migrations, category/task-first fields, or grouping identity beyond removing the blank-uncategorized regression.

## Root Cause

`timelineEntryGroupKey` returned `entry:<id>` for an uncategorized entry with no category-name or description before it reached the established category/description/tag fallback key. Blank entries therefore became unique even when their tags also matched. The regular fallback already safely represents uncategorized, no-description, and no-tags identity.

Calendar held the only delayed-delete timer and notice; List still used a confirmation dialog and performed deletion locally after confirmation. Neither arrangement could preserve one undoable transaction across Timeline views or make a replaced deletion race-safe.

## Motion Contract

- Trigger: Delete from a Calendar quick card, List row/group/occurrence menu, Undo, five-second expiry, a second deletion, pagehide/unmount, or an API failure.
- Owner: one Timeline-level controller owns the pending transaction, monotonic token, hidden IDs, timeout, replacement, commit, reconciliation, and rollback. Calendar and List only request deletion; CSS owns the notice entrance and the existing restrained table/block visual treatment.
- Entrance/update/exit: affected rows and blocks leave the rendered collections immediately and remaining content reflows within its existing scroller. The fixed bottom-right notice enters with a 160ms opacity/short-rise transition, then uses a controller-owned 160ms exit after Undo or commit. Undo restores the original collections through their normal deterministic grouping. Reduced Motion removes the spatial notice animation.
- Surrounding layout: the persistent timecard, Timeline toolbar, fixed titles, and page viewport do not move. Only Calendar blocks, List groups/occurrences, Timesheet totals, and their internal scroll content update.
- Interruption: replacing a pending deletion clears its timer, starts the older commit once, and installs a new token/notice. Expired timers and old success/failure callbacks only address their own token, never the newer notice.
- Async outcome: no mutation is sent until expiry, replacement, pagehide, or unmount. Undo cancels only the current pending transaction. Success stays optimistically hidden until refreshed data excludes the exact IDs; failure restores only that transaction and shows a separate error without replacing a newer Undo notice.
- Accessibility: the notice is a polite live region, its Undo button receives focus after deletion, remains keyboard reachable, and has a 44px target. Failure uses a separate alert. Reduced Motion retains the full five-second opportunity and all state semantics.

## Validation Record

- Focused Timeline tests: `40` passed across grouping, controller, Calendar action, grouped-settings, toolbar, and primitive contracts.
- Full validation passed: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, and `npm run check:brand-assets`.
  - Mobile: `44` files / `311` tests passed.
  - Web: `87` files / `525` tests passed.
  - Shared: `8` files / `132` tests passed.
- Browser validation used isolated, fixed-ID records in the local development database; all records were removed after the check. At desktop and a 390px phone viewport, verified:
  - matching blank uncategorized entries form one two-occurrence List group;
  - List grouped deletion disappears immediately and commits after the five-second window;
  - List individual and expanded-occurrence deletion restore on Undo;
  - Calendar quick-card deletion restores on Undo;
  - replacing a pending deletion commits the older request once, shows the newer notice, and Undo restores only the newer entry;
  - the mobile Undo notice remains inside the viewport and browser console logs are clean.
- The available browser surface captures screenshots but does not provide screen-recording export or request interception. Failure rollback, exact timing, pagehide/unmount, stale timers, and out-of-order completion are covered by the framework-neutral controller tests.
