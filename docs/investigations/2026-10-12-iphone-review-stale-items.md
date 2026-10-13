# iPhone Review: stale superseded cards, "Couldn't log a moment" and deck glitches (12 Oct 2026)

Evidence record. Owner report on production TestFlight 0.1.0 (116) from `c4c3484`, server `66cad18c`, iPhone 17 Pro on iOS 27.2 beta. No place names are recorded here.

## Symptoms

- Swiping a Review card: "All framed" flashes, the Log-as row jumps taller, the same card seems to come back, and ghost copies of cards and the Undo toast appear.
- The footnote alternates between two reasons.
- Sync help lists 8 "Couldn't log a moment" items on a good connection.
- Lag in Review and Settings; one phone-wide freeze at about 19:45 BST.

## Findings

- At the time of the report, production had **0 open Review items** for the workspace, while the phone's deck showed "9 of 34". Every card was a stale copy.
- All 8 failed actions were confirms of Commute suggestions that location replay superseded on 4–7 Oct. The server answered 409 `resolution_conflict` with canonical status `ignored`; one went through reconcile and got `conflict`. Several shared a window with sibling items (×2, ×3), so "the card comes back" was the next stale copy. Where a sibling was accepted, the moment was already logged.
- R1: `review_item_cache` is only ever upserted from open items in bootstrap and presentation reads, never evicted on omission. Terminal evidence comes only from targeted lookups. Every presentation response already carries the complete `outstanding.openReviewItemIds` (`completeness.outstandingCounts`), unused for eviction.
- R2: the deck appends every cached item not in the backlog page after it, even when the backlog is complete.
- R3: 409 `resolution_conflict` / reconcile `conflict`/`missing` became `needs_attention` (web drops them quietly).
- R4: `load()` commits the server's capped bootstrap list while every store change commits the cached projection, and each decision runs sync then `load()`. With the stale cards: 34 → 0 ("All framed") → 34 per swipe.
- R5: the same item is cached from three shapes (live bootstrap, whitelisted bootstrap, presentation with `rawPayload: null`), so `locationReviewReasonCopy` alternates.
- R6: the Log-as row has a taller layout on the top card than below it (re-measure on promotion), and the Undo toast is rendered in three different parents, so the empty flash remounts it (ghost).
- Device reports (iPhone 17): CPU-resource report 22:17 (48 s CPU in 60 s, app in background, footprint 932 MB); Jetsam 20:56 with Dayframe largest at 678 MB resident. The freeze and lag are not yet attributed; Instruments on the iPhone 11 is pending.

## Freeze and lag: Instruments on the iPhone 11 (13 Oct)

Staging build of the merged fixes (`3f02796d`) on an iPhone 11 signed in to a staging copy of the production workspace (1,961 Review items, 1,122 entries, one block running), driven by deep links: launch, Review, Settings, 60 s in the background, foreground. Time Profiler + Hangs (`run2`): no hangs or hang risks; the JavaScript thread used about 50 ms per second steadily, in the foreground and the background alike. The Dashboard set its clock every second unconditionally, re-rendering Today, Calendar and the always-mounted Reports tab every second, also while location kept the app alive in the background; about 5 % of JS time was `Date#toLocaleDateString` inside Reports' per-day labels, which builds a new `Intl.DateTimeFormat` per call. The Play orb ring kept its own 1 s clock in the background. Allocations (`run3`) is saved for interactive inspection; the 678–932 MB footprint on the owner's phone is not yet attributed. Traces are local in `.codex-dayframe-qa/review-glitch-2026-10-12/instruments/`.

## Live timer after time away (TestFlight 117, 13 Oct)

The owner left the app 28 s after starting Lunch (14:48:10.8 BST) and came back at 15:01: the timer showed 0:00:28, then 0:04:02 at 15:02. Production (read-only) and Vercel logs fix the timeline: no request between 14:48:44 and 15:01:12 (the app was suspended), then a bootstrap about every 6 s and six queued location uploads. The Play orb's ring, which keeps its own clock, puts the screenshots at 15:01:48.8 and 15:02:12.7. The second screenshot is the true elapsed time, 0:14:02, with only the tens-of-minutes digit wrong; the first matches the clock as it stood when the app went to the background. So the label was right but odometer digits that changed around the return kept old positions until they next changed. The exact mechanism inside Reanimated is not proven: the Simulator (also with a 3.5 s JS stall after return) and the Staging app on the iPhone 17 with lighter data recovered within seconds.

Fix (mobile only): the odometer rolls only for an ordinary one- or two-second tick; any other jump, and every return to the foreground, remounts the digits at rest from the time they show in the same commit, so the first frame back comes from React's own props whatever state a roll was left in, and the Dashboard's clock reads the time in that same render. `useAppForeground` reads the state again after subscribing, so a change between the first render and the subscription is not missed. A regression test drives the real foreground hook, Dashboard clock and odometer through background → foreground with a running block and checks the first commit after the return.

Main-thread cost found on the way (Time Profiler, Staging on the iPhone 17, block running, Today in front): about 40 % of a core on the main thread, of which 54 % is Reanimated committing the shadow tree every frame (the breathing ring's opacity loop and the odometer's rolls) and 34 % is React Native re-drawing the ring's border on the CPU (`RCTGetBorderImage`: a bordered view that does not clip is drawn as an image, and an opacity change invalidates it). The animations keep running under Settings, which competes with the Settings push. Separate PR.

## Fix order

1. Settle moments decided elsewhere quietly (this note's first PR).
2. Evict cached items absent from a complete open set on every successful read.
3. One Review data owner with coalesced change notifications; stable reason fields.
4. Deck motion: one Log-as geometry, one toast host, no transient "All framed".
5. Performance, from the Instruments trace: background-aware, live-only per-second clock; minute time and memoisation for Reports; cached date formatters.

## Clearing the owner's 8 stuck items

Kept as evidence. The PR 1 client re-checks rows parked as `resolution_conflict`/`canonical_missing` once and settles them, which also proves the fix on the real queue. Sync help › Discard remains a safe local-only alternative.
