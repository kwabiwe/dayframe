# Dayframe Product Requirements Document

## 1. Executive Summary

Dayframe is a personal time-intelligence product that combines manual task tracking with privacy-conscious automatic activity capture. It has two interfaces: an iOS mobile app that can read location and HealthKit signals, and a web app for timer control, review, reporting, category management, and longer-form analysis.

The core value proposition is to reduce manual time-tracking friction without losing user trust. Dayframe should capture manual timer actions, trusted-place automation, HealthKit sleep/workout summaries, and mobile offline activity signals, then sync them into a clear web/mobile timeline. Ambiguous or low-confidence signals should be reviewable instead of silently becoming incorrect time entries.

The MVP goal is to make Dayframe reliable for personal use and a small friends beta: hosted on Vercel, backed by Supabase Postgres/Auth, iOS-only for mobile, offline-capable for hours or days, and privacy-conscious around health and precise location data.

This PRD is deliberately stable product intent. `docs/feature-fix-tracker.md` is the source of truth for delivery, release, Watch, and decision state; `docs/architecture.md` is the source of truth for runtime/data ownership. Do not copy build numbers or active-branch snapshots into this document.

## 2. Mission

Dayframe helps people understand where their time goes by combining intentional timers with privacy-conscious automatic context from location and health signals.

Core principles:

- Trust first: automatic tracking must be explainable, editable, and easy to correct.
- Event-first: raw signals become activity events before they become time entries.
- Personal by default: optimize for one person's productivity, not team billing.
- Privacy by design: granular health and location data must be scoped, exportable, and fully deletable.
- Offline resilient: mobile capture should work when the network is unavailable.

## 3. Target Users

Primary users:

- Personal productivity user: wants a faithful record of focused work, admin, exercise, sleep, walks, chores, and recurring routines.
- Early tester/friend: accepts a beta-quality tool but expects login, sync, and editing to be reliable.
- Quantified-self user: wants location and HealthKit summaries to enrich time tracking without manually entering everything.

Technical comfort level:

- Primary user is technically comfortable enough to sideload an iOS app and configure hosted services during early use.
- Future testers should only need a hosted web URL and an iOS build/invite.

Key needs and pain points:

- Manual time tracking is easy to forget.
- Location apps show where time went but not task/category context.
- Health apps show sleep/workouts but do not connect that data to a productivity timeline.
- Fully automatic time tracking can be wrong, so corrections and review matter.

## 4. MVP Scope

### In Scope

Core Functionality:

- ✅ Web and mobile manual timer start/stop/switch with live active timer sync. Mobile Stop is accepted only after an exact, account-owned Stop intent is durable on device; server delivery is entry-scoped, idempotent, bounded, and safe to replay after relaunch. Already-started durable timer saves receive best-effort finite iOS background time, while offline, expiry and force-quit continue through the same durable recovery path.
- ✅ Description, category, place, source, confidence, and review status on time entries.
- ✅ Calendar and List review views (Timesheet removed 11 Oct 2026, owner decision: Reports covers weekly totals and the CSV export).
- ✅ Review inbox for ambiguous geofence/health/location suggestions.
- ✅ Auto-start for trusted places only.
- ✅ Conservative suggestions for broad/ambiguous places.
- ⚠️ Home and Work place roles: two pinned slots (one Home, one Work) that name a saved place "Home" or "Work" everywhere, whatever it was saved as. The role belongs to the place, so moving house keeps past entries on the old place, which I can rename (for example "Previous home"). Set on web and iPhone Places and during onboarding (delivery state in the tracker).
- ✅ HealthKit summaries for sleep and workouts/walks as automatic entries or reviewable high-confidence events, with real-device background behavior and mapping defaults still watched after TestFlight validation.
- ✅ Mobile activity-event fallback and offline Review mutation queues include durable storage, bounded retry, diagnostics, and idempotency. Real-device background/reconnect/conflict behaviour remains under Watch.
- ⚠️ Time-entry edit/delete/export paths exist, but full account/workspace deletion and stronger privacy controls for raw Health/location payloads remain future work.

Technical:

- ✅ Vercel-hosted web app and API routes.
- ✅ Supabase Postgres as production database.
- ✅ Supabase Auth as production identity provider.
- ✅ Dayframe app session token for web cookie and mobile bearer auth.
- ✅ Postgres/PostGIS schema for places, geofences, activity events, and time entries.
- ✅ Signup allowlist for personal/friends beta.

Integration:

- ✅ iOS HealthKit sleep and walking/workout summaries.
- ✅ iOS geofence monitoring for known places.
- ✅ Location Intelligence V2 implements an ordered temporary evidence journal, deterministic stay/commute segmentation, native iOS visit/significant-change anchors, private map review, and atomic correction actions. Its live server mode remains rollout-gated: the repository fails closed to `v2_shadow`, while `v2_review` and narrow `v2_enabled` require separately recorded operational approval and evidence.
- ❓ Automation outcome measurement is a decision item. Review outcomes are stored, but no dedicated anonymized analytics product or telemetry contract is approved.

Deployment:

- ✅ Hosted SaaS direction.
- ✅ No App Store requirement for MVP; the current lane is internal TestFlight.
- ✅ No monetization or billing.

### Out of Scope

- ❌ Team time tracking, approvals, seats, roles, or billable SaaS workflows.
- ❌ Non-iOS mobile support.
- ❌ App Store optimization/review as a launch blocker.
- ❌ Billing/subscriptions.
- ❌ Full calendar integration.
- ❌ AI classification as a required MVP feature.
- ❌ Native push notification system beyond basic local reminders or future hooks.

## 5. User Stories

1. As a personal productivity user, I want to start a timer from web or mobile, so that I can track focused work without switching tools.
   - Example: Start "Deep Work" on mobile, see the same active timer ticking on web.

2. As a user entering work context, I want to type an optional task description and choose an optional category, so that the final time entry has useful context.
   - Example: Type "Draft Supabase auth plan", choose "Work", stop timer later, and keep that description.
   - On web, the idle/running timer, Add Time, Timeline List entry editor, and Calendar create/edit category pickers can create a category in place. Creation is an independent catalogue write: it previews an automatic Dayframe colour by default, lets the user optionally choose another colour from the canonical Dayframe palette, leaves the category unpinned, selects it in the current draft, and never submits, dismisses, starts, stops, restarts, or otherwise mutates the surrounding entry. The category remains available after the entry draft is discarded.

3. As a user moving between trusted places, I want Dayframe to auto-start known activities only for trusted locations, so that routine places save effort without creating noisy entries.
   - Example: Arriving at Gym starts a Gym/Health entry if explicitly configured as trusted.

4. As a privacy-conscious user, I want ambiguous location signals to become review items, so that Dayframe does not silently guess wrong.
   - Example: Town Centre creates a "Review visit" item instead of auto-starting.
   - Stay evidence should let me answer `Where were you?`, `What did you do?`, and `When?` in one correction flow. For every stay, including a saved-place match, Dayframe automatically offers up to five Apple Maps points of interest within 400 metres as nearby places under the empty place search, ranked for the place I was most likely at and at the scale I'd say it (venue resolver v2, location v3 PR 7: the supermarket rather than its pharmacy counter, the shopping centre rather than a shop inside it, with the places inside listed under it; bus stops and car parks never lead), from distance against the venue's size and the readings' accuracy, the kind of place, how long I stayed and the time of day; it must not claim popularity or certainty Apple does not provide. I can use a selected name once, explicitly save it for future location learning, choose an existing Dayframe place, search for another place, choose an existing category, and adjust the start/end time before one atomic confirmation. Commute evidence should show an honest approximate route with explicit Start and End markers, then ask only what I did and when. Transit is a best guess on the iPhone only (owner decision 21 Oct 2026, option A): for a Move that is driven or of unknown mode, Location evidence checks its two ends against Apple's places and, when both are stations, says "Looks like public transport · A → B" and offers a "Public transport" chip that fills the name and chooses Getting around; nothing changes until I tap it, nothing is logged automatically, no server field stores it and titles elsewhere still read "Drive".

5. As an iOS user, I want sleep and walk/workout summaries imported from HealthKit, so that health activity appears in my day timeline.
   - Example: Sleep from 23:20 to 06:45 creates a Sleep entry or high-confidence review item.

6. As a mobile user, I want offline capture to sync later, so that timers and geofence/health events are not lost when the network is unavailable.
   - Example: A walk captured offline syncs when the phone reconnects.
   - A persistent passive notice explains confirmed offline state; a temporary notice says when transport returns without claiming all saved work has synced.
   - Pending saved work and active transmission are distinct: waiting/backoff is static, while motion is reserved for a live delivery attempt.
   - Offline-capable actions remain enabled and commit to their existing durable owners. Connectivity-dependent actions retain their bounded, explicit failure path instead of being silently replaced or globally disabled.
   - Example: I tap Stop and immediately force-quit; reopening still shows that exact timer stopped locally and safely retries the same event without stopping a newer timer.
   - Example: Review opens from the last account-owned snapshot, cached private Location Evidence remains usable for up to seven days, and every resolving/structural Location action (including save-place, record-once, split and merge), Confirm, Dismiss, or complete Edit-and-confirm disappears after its account-owned SQLite commit while Dayframe retries the canonical server mutation later.
   - Nearby/search lookup and the compatibility-only pure place-change action require a bounded live connection. Resolving and structural corrections preserve the exact selected action in the account-owned outbox; offline support must never substitute a different action or expose another account's cached Review/location evidence.

7. As a user reviewing time, I want Calendar and List views, so that I can edit precise entries and understand daily/weekly totals (the Calendar head shows the day's framed time and the week's total).
   - Example: Resize/edit a time block, delete an accidental entry, and review weekly totals by category.

8. As the product owner, I want an explainable way to assess automation quality without exposing sensitive context.
   - Example: An owner-only accepted/ignored report may be appropriate, but external telemetry requires a separate privacy decision.

9. As an iOS user, I want navigation, gestures, sheets, list changes, and action feedback to transition consistently, so that every state change feels connected and understandable rather than jumpy.
   - Example: Swiping to delete an entry moves continuously into an animated list reflow and Undo state, including dismissal, restoration, failure, and Reduce Motion behaviour.

## 6. Core Architecture & Patterns

High-level architecture:

- `apps/mobile`: Expo/React Native iOS app for manual timers, geofences, HealthKit import, offline queue, and sync, with targeted Swift/SwiftUI native modules where a platform interaction needs native ownership.
- `apps/web`: Next.js App Router web app and API routes for timer/review/reporting/auth.
- `packages/shared`: shared schemas, event normalization, palette/types, and state-machine behavior.
- `packages/db`: ordered Postgres/PostGIS migrations, seed/setup scripts, import/export utilities.
- `supabase/migrations`: hosted Supabase-specific RLS and production policies.

Key patterns:

- Event-first ingestion: every signal becomes `activity_events`.
- Derived entries: `time_entries` are created from explicit or trusted high-confidence events.
- Review-first ambiguity: uncertain signals become `review_items`.
- Workspace scoping: every user data table is scoped by workspace and protected through app session checks and Supabase RLS.
- Mobile offline queue: mobile writes local queued events, then syncs to API when available.
- Hybrid iOS boundary: React Native owns authenticated data, API mutations, route state, and shared sheets. A native SwiftUI surface receives a serializable presentation model and emits semantic actions back to React Native; it does not create a parallel API, session, timer, or persistence layer.

### Saved-place detection quality

Automated saved and accepted learned visits need at least five minutes of evidence-supported effective dwell, measured in milliseconds after departure resolution. A completed native Visit cannot waive that floor for a clipped fragment; elapsed processing time alone cannot turn a passing fix into attendance. Raw capture evidence remains retained under the existing privacy policy.

Being near a saved place is a suggestion, not proof I was there. A stay is that place only when its still readings centre inside the circle I set, or iOS itself placed me inside during that visit before I left: a genuine geofence entry not followed by an exit, or a Visit whose estimate lies wholly inside the circle. Otherwise it is an unknown stay with the place as a candidate, even when individual readings fall within the matching tolerance or an arrival was corroborated (corroboration shapes timing, not the place); without any still reading, only those iOS signals make a stay the place. A parked phone whose still readings all fall just outside the circle is not split or shortened because the place exists: its silence, nearby still readings and departure are handled as they would be with no place saved. A Visit elsewhere, a stop on the far side of the circle or driving through it ends the stay; the place's own geofence callbacks do not. Its start and end can differ by about a minute from the unsaved case, because beyond the matching tolerance only still readings join it.

A same-place exit callback is a departure candidate. Strong same-place re-entry within five minutes can cancel an uncorroborated callback; genuine different-place or corroborated outside evidence still separates visits. Compatible finite native Visit intervals can support silence. Without interval support, distinct strong saved-place endpoints may bridge at most thirty minutes, with uncertain continuity and confidence capped at medium. Unsupported longer gaps remain separate. One exception reflects how a still phone behaves: when an arrival-only native Visit at the saved place is corroborated by that place's geofence entry or an accurate inside observation, silence alone no longer ends my presence: the next observation goes through the ordinary departure rules within eighteen hours, and the stay ends at the departure evidence rather than at the middle of the silence. An ongoing stay counts its dwell up to now, but not while an exit or outside observation is unresolved. An exit, confirmed outside or other-place observations, or the Visit's reported departure still end it. When iOS later reports that same visit's departure, often from the background long after I've left and with a vaguer location, the report can only end my presence at that time; it never undoes the arrival, so the stop and the journeys either side are not lost, and a departure reported a little after I actually left does not move the end away from the first departure evidence. Without a corroborated arrival, a completed visit ending within five minutes of the first departure evidence still ends the stay at that evidence, while one far beyond contradicting evidence does not extend my presence. This lets a journey end when I actually arrive instead of at the next reading, which can be much later. Estimated boundaries remain bounded; approximate native Visits do not establish precise building-door times.

An accepted finite native Visit with accuracy strictly above the existing high-quality cutoff and no greater than the existing accepted ceiling (`65m < accuracy <= 200m`) may support a saved-place interval only when two distinct strong standard/significant observations establish arrival within 300,000 ms and an independent later strong cluster establishes the same episode. Contradictory movement, outside or competing-place evidence vetoes that support. The Visit coordinate is never used as a precise centre, sample or speed point; the inferred stay is medium confidence with uncertain continuity, and affected commutes are low confidence so the existing medium automatic-commute exception cannot apply. If the full interval is not justified, a corroborated early-arrival witness suppresses only the conflicting spanning commute; it never creates a hidden stay or changes global thresholds.

For an unknown-place native Visit, its reported arrival remains the estimated stay start unless stronger evidence contradicts the episode. A broad completed Visit following recent independent accurate movement displaced from its centre does not establish an exact arrival instant: the last relevant movement bounds the estimate below, and the Visit's reported departure bounds it above without claiming that departure was observed parking. For an unambiguous arrival-only/completed pair, evaluate that movement once against the callback centre with better horizontal accuracy; equal accuracy favours the arrival-only callback. The completion's own accuracy still governs whether it is broad, and its reported departure remains the upper bound. Spatial accuracy does not measure arrival-time accuracy. An arrival-only callback leaves the upper arrival bound unavailable only when that movement witness exists; otherwise it retains the existing exact estimate. A single later slow fix does not move the estimate or prove stationary dwell. The same uncertainty flows to the inbound commute endpoint; its measured route remains limited to actual route observations. An uncertain unknown stay may remain a Review suggestion under the unchanged estimated-duration gate, with its duration labelled as an estimate rather than confirmed stationary time. Supported Visit departure handling, saved-place matching, candidate/Review thresholds and automatic policy are unchanged.

This improves suggestion quality without activating automatic logging. Existing rollout, cutover, commute qualification and unknown-place thresholds remain unchanged. Replay may replace obsolete open suggestions, but must preserve explicit accepted, ignored and manual decisions even when corrected segmentation changes client IDs.

Whether I stopped is decided from physical evidence, separately from naming the place or showing it as a Review. A stop needs accurate slow observations spread over time with movement observed on both sides; a native Visit can corroborate it but never sets its length, because iOS can report several minutes for a 30-second kerbside stop. The exception is a parked phone, which records one reading and then nothing until it moves: a Visit lasting at least 10 minutes after my last observed movement can carry that stop to its reported end when I am seen driving away within 5 minutes of it and no geofence crossing happens in between. Brief or uncorroborated pauses stay inside the journey. A corroborated stop shorter than the unknown-visit Review threshold is part of one trip: the trip carries the stop and its time is not described as travel. When every leg to and from the stop is itself a real journey, the trip through it is real even if its total route is shorter than the round-trip minimum. When place matching splits or shortens a stop that physical evidence shows was one, by five minutes or more, the physical stop's time wins and the place applies only if its readings place me there. Time at a saved place still never starts before I was observed there, and the stop never claims a longer silence, before, after or between the pieces it replaces, than a saved place itself would. A stop long enough to be its own visit separates the journeys either side and is offered as a visit, with any nearby saved place as a candidate rather than proof of attendance. Trips containing a stop always need my review before logging.

Motion & Fitness, when I allow it, tells Dayframe whether I was still, walking, running, cycling or driving. It never says where I was, never forms a visit and never logs time by itself. It sharpens journeys: a visit ends and the journey starts when I actually set off, inside the time the location evidence already allows; the journey ends when I stopped moving, though time at the destination still starts when I was observed there; and a journey is labelled by car, on foot, by bike or running. When GPS saw nothing between two places at least 800 metres apart, or too few fast readings on a drive under three minutes, one clean drive, ride or walk between them, starting and ending in stillness and fast enough for the distance, is offered for Review at low confidence. Two separate bursts of movement mean I may have stopped somewhere unseen, so nothing is offered. Motion never makes a journey more eligible for automatic logging: one it timed or found always needs my review, and motion never removes a journey location evidence found. Motion data is private like location: it is kept with my location evidence, expires and is deleted with it, is included in exports, and is never sent to analytics. Permission is offered in Settings (onboarding later).

Time away from a saved place: when the phone clearly leaves a saved or accepted learned place and comes back to it, is away for at least five minutes (and at most the journey maximum), and no journey qualifies for that absence, Dayframe offers one Review item, a round-trip Move such as "Trip · Round trip from Home, 12:00–12:10" (PRD D19; before Location v3 it read "Time away from Home"). "Clearly leaves" means either a short unnamed stop in between (an unknown stop under 10 minutes; a stop at another saved place, or one of 10 minutes or more, is its own visit, so no time away is offered across it), or at least two distinct accurate readings at least 150 metres (or the place's radius, if larger) beyond the place, net of their accuracy; geofence callbacks alone never count. The item covers only the absence and claims no route; under D19 it suggests Getting around (Errands, when the workspace has it, if it had a stop) and keeps no generated description. It can be confirmed (with a category, a description or changed times) or dismissed, and it is never logged automatically, in any rollout mode. A journey that qualifies always wins: time away never replaces or absorbs a qualified journey or leg. Without an observed return (the phone silent at the place afterwards, with no Visit or reading there) nothing is offered.

### Automatic logging decisions

This section describes the shipped policy. D19 (Location v3, decided 16 Oct 2026) widens it for Moves between known places with a clear mode and a per-user "Log trips automatically" switch; each part replaces the matching row here when its PR lands.

Normal automatic confidence is `medium_high` or `high`. Location additionally requires a finalised segment, server `v2_enabled`, same-mode client acknowledgement/cutover and no earlier Review or terminal decision. Start and stop bounds are independently complete, finite, ordered, contain the unchanged detected estimate, and each span at most five minutes. Missing or invalid bounds fail closed; never round or move detected times to pass a guard.

| Candidate | Additional requirements | Overlap policy |
| --- | --- | --- |
| Health sleep/workout | Enabled type preference, supported type, complete valid window, existing duration/plausibility thresholds, sample/session safeguards | May coexist with every activity type |
| Trusted stay | Logging-enabled saved place or accepted learned place linked to one; normal confidence; supported continuity including a bounded `uncertain_gap` | Manual/Health allowed; commute or a different location stay allowed only up to five minutes |
| Standard commute | At least three minutes; normal confidence; two verified saved endpoints; at least two accepted route samples; significant endpoint displacement or meaningful same-place round trip; actual maximum internal observation gap at most twelve minutes | Every confirmed/accepted activity allowed only up to five minutes |
| Medium commute exception | At least three minutes; `medium`; distinct verified saved endpoints; at least three accepted route samples; significant endpoint displacement or significant route distance; same gap/boundary guards | Same commute overlap rule |
| Other signals | Unknown endpoints, weak/endpoint-only routes, trips containing a stop, journeys Motion & Fitness showed or timed, time away from a saved place, missing linkage, disabled logging, invalid window or failed thresholds | Review |

Strong-evidence short journeys are Review-only, including in `v2_enabled`. A positive sub-three-minute candidate must retain independently formed stays at distinct endpoints at least 800 metres apart and have at least three independent, accurate (at most 65 metres) faster GPS point observations (at least 2.8 m/s) with `isSimulated: false` within its actual window. When both endpoints are different saved or learned places, each identified as itself rather than an ambiguous match, two such observations are enough: both stays already show the device was at each place, so the route only has to show movement. A single observation is never enough (5 Oct: iOS delivered just two readings on a 100-second school-to-home drive). On iOS, Expo Location does not supply Android's `mocked` indicator, and Dayframe normalises that absent signal to `false`; the value is not independent proof that an iOS sample was not simulated. Native callbacks that omit `isSimulated` still fail closed, but simulated iOS/GPX/Xcode input is not reliably rejected by this field. Duplicate deliveries, source mirrors, broad/invalid/implausible samples cannot supply proof. Unknown endpoints retain their existing dwell rules and need not create their own visit Review. No confidence, estimated bounds, same-place-round-trip, ordinary-duration or maximum-duration rule is relaxed.

This eligibility change can admit retained evidence after the unchanged semantic cutover; it is not restricted to evidence captured after deployment. Existing retention, earlier Review, terminal/manual decisions and replacement protections remain authoritative. No bulk historical replay is implied.

Thresholded overlap is the maximum intersection with any single confirmed/accepted entry, not a sum. Exact touching is zero; a running entry is intersected only through the candidate's finite end. Choose a blocker deterministically by largest overlap, earliest start, then ID. Entry provenance determines activity kind; a manual entry's name/place does not make it a Location stay. Preserve source idempotency and unsafe logical Sleep collision/user-edit guards independently. Total logged remains the sum of complete durations; Time covered remains their clipped union.

Overlapping saved radii select one deterministic best existing saved match using the established hint, continuity, distance and priority rules plus stable ID tie-breaks. Retain bounded alternatives; do not enlarge radii or call Apple POI search from matching/replay.

For exactly one saved and one accepted learned candidate with near-coincident centres, two high-quality strong matches retain the saved identity when no learned active-place input is supplied and the saved candidate's computed priority is at least the learned candidate's. Otherwise the existing deterministic order applies. An isolated low-accuracy Visit or plausible overlap is ambiguous in this pair. The Visit may join a saved episode with independent high-quality observations near both ends. A plausible approach observation may join the saved arrival when two later strong saved observations support it within the existing arrival and continuity windows, without an intervening contradictory high-quality point or saved-place exit. Distinct nearby candidates and learned-only matching keep their existing deterministic behavior.

## 7. Tools / Features

Manual timer:

- Start/stop from web and mobile.
- Live ticking duration.
- Description can be edited while running.
- Optional task description and category selection.
- Contextual web category creation from timer, Add Time, Timeline List, and Calendar create/edit pickers without leaving or submitting the current draft.
- Active timer sync across interfaces.

Timeline/review:

- Calendar view with time blocks.
- List view with chronological grouped entries and edit/delete/start-again actions.
- Weekly grouped totals live in Reports (the Calendar Timesheet view was removed on 11 Oct 2026).
- Web Reports shows one total everywhere (hero Total, Daily average, Best day, change against the period before, the day columns, the donut centre and the daily trend): time logged, every block counted in full, overlaps included, so a day can pass 24h (owner decision UIA-305, 12 Oct 2026). There is no second "covered"/"framed" total on web Reports; a footnote under the hero tiles says overlaps count in full only when the range has overlap. Days on goal keep goal coverage semantics.
- Review inbox for suggestions, ignored items, and rule creation.

Mobile Reports:

- One compact mobile Reports surface has one range chooser and one funnel/count action. Today / Week / Month / Year are equal compact targets directly below the shared date sheet's swipe handle; there is no permanent preset strip, duplicate range heading, visible Cancel/Clear action or dismiss-to-Today reset. Date changes remain drafts until Done. Both Reports sheets use the shared swipe-dismiss owner; handle swipe, backdrop, escape, blur and account/lifecycle invalidation discard, while Done/Apply commit exactly once and retain the presentation until its coordinated exit finishes.
- The donut centre shows Total: summed confirmed logged activity clipped to the selected range. Concurrent entries count independently; there is no Time covered card or overlap explanation in mobile Reports. Web/Today goal coverage semantics are unchanged.
- Only selected positive categories appear in the donut and compact divider list, ordered by exact unrounded duration descending and stable category key ascending for ties. The donut uses that same ordered array. Angles, totals and percentages use the selected denominator, including spoken values. All/include/none stays reversible through the full category catalogue; None is valid and explains No categories selected. Bare ticks/dashes show filter selection, including mixed All. Uncategorized, duplicate names and unavailable stable IDs remain distinct.
- The filter sheet is the only category-selection surface: Apply commits and shared dismissal routes discard. Donut slices and category rows are informational, never filter/remove actions or extra popups; each row speaks its complete name, selected-time percentage and duration without moving focus.
- Custom ranges use inclusive device-local dates, reversible endpoint selection, no future dates and a maximum of 366 calendar days. Presets use whole local calendar periods, Week begins Monday, and portions after the captured current instant remain visible with zero contribution rather than truncating the preset.
- Activity over time follows the same selected range and filter. Today/custom one day use one full local-day bucket and one centred bar, including 23/25-hour DST days; Week uses seven daily bars; Month uses one per calendar day; Year uses twelve monthly bars; longer custom ranges keep clipped calendar-week/month buckets. Labels are period-aware: weekday plus `DD/MM` for one day and every Week day, only first/last `DD/MM` for Month/custom, and Jan/Mar/May/Jul/Sep/Nov at normal Year widths. The entire plot fits without horizontal scrolling, with zero-height zero buckets, three nice axis ticks and one bounded moving tooltip. One plot-level nearest-slot target supports zero buckets; adjustable accessibility and 44-point Previous/Next actions replace overlapping invisible per-bar targets.
- Confirmed active timer contribution follows the existing projected timer through one current instant; Review-needed entries and suggestions never contribute. Month/Year/custom use bounded authenticated aggregates rather than raw history. An unavailable uncached range says Connect to load this report range; cached results never masquerade as another range.
- Donut geometry follows available width, never font scale; show its clock total once, in the centre when it fits or in one bounded companion line. Durations use unbounded-hour HH:MM:SS, flooring only final labels, with natural spoken durations. Category rows form a zero-gap informational list with a 38–42-point ordinary measured pitch and minimum-only height; they remain one line at every supported width/text size, only names ellipsise, and percentages/durations remain complete. Dense roles have explicit local scaling caps, not global suppression. The Reports calendar shares the entry picker's 349-point inner cap (308 points at a 320-point host) while keeping six 44-point rows and seven equal columns.

Mobile Today and integrated Review:

- Today's top (Blocks parity step 2a-1) is the brand lock-up with the account avatar (opens Settings, where account and logout live), the date, and the goal frame: today's framed total (covered time: time that overlapping blocks share counts once, so it never passes the day's real length — D14, superseding UIA-305 for Today's hero; the running timer up to now) against the daily goal from the profile, one cell per goal hour filled with covered time in activity colours in the order the time happened, and the percentage capped at 100 while the total keeps counting. Suggestions never count. Time in an activity switched off "Counts toward goal" (Sleep by default, D13) stays in the total but leaves the cells and percentage; the line then reads "framed · Xh toward 8h".
- "Today's blocks" lists today's entries with a block as tall as each entry's time; swipe right to start one again, left to delete it (with Undo); repeats stay grouped. The mosaic heading reads "Start a block" (owner, 7 October 2026).
- The timer card follows the prototype: idle it asks "What are you working on?" with a coral "Start a block" pill and an "Add past time" pill; running, it shows the activity, the description, a rolling H:MM:SS timer, the start time, Add past time and Stop. A coral Play orb sits beside the tab bar on every tab: tap to start a block (or stop the running one); hold it to fan out up to nine activities and slide to one. Pulling the running card left opens "Pick up something recent" (up to six recently finished blocks) to switch in one tap. Stop flies the block into Today's list. The block's sheet is headed like the prototype ("Running block" / "Edit block") and ends with Discard and Stop, or Delete and Start again. Stop has no Undo (owner decision 7 October 2026): a stopped entry is edited or started again instead.
- A 24-hour ribbon shows today's logged time and, hatched, the time waiting in Review, with a now line; dragging along it scrubs through the day and tapping a block opens it. The ribbon card ends with "Where today went" (D15): today's covered time per activity as a proportional bar and a 2×2 legend that adds up to the hero, and one tap opens Reports on Today.
- "Earlier this week" lists the six days before today with a mini ribbon and the day's covered total (overlaps once, as the hero showed that day; D14); tapping a day opens it in Calendar. Today lists nothing older.
- One "moments to review" card opens Review. It shows a number only when the count is exact, and disappears only when nothing is left to review. Today has no Review rows, Quick Confirm, "Incomplete time" list, donut or logged/covered summary (the "Where today went" strip, D15, is the one per-activity summary); confirming a suggestion happens in Review.
- The Review presentation read, its account-owned cache and the Review outbox are unchanged: a bounded partial/cached presentation never claims zero or completeness, a locally saved Review decision never becomes a synthetic entry, and Quick Confirm envelopes keep their freshness precondition for the Review deck. Today keeps the established Dashboard/timer, Review outbox, Health, Location, auth, and sync owners.

Blocks prototype parity (owner decision 7 October 2026; built screen by screen):

- Every iPhone and web screen, Settings included, is rebuilt to match the Blocks prototype (`docs/brand-style-guide.md`, Dayframe Blocks). The rules above stay in force for each screen until the PR that rebuilds it updates them.
- Kept through the rebuild: grouped repeat rows in history; the Review Location evidence editor; the entry sheet's start/end date and time editing, historical description suggestions and rounding shortcuts; free-text tags with autocomplete; Retry/Discard for rejected changes; every export and delete path; logout on every width.
- On iPhone Today the Review donut gives way to a "moments to review" card that opens Review (built in step 2a-1), with pending time shown in a Today ribbon (step 2a-3). The owner confirmed on 7 October 2026 that Quick Confirm leaves Today (suggestions are confirmed in Review) and that the goal frame replaces the logged/"covered" summary.
- Connectivity direction: the indicator should show only offline and a brief "back online", with syncing silent; rejected changes badge the account avatar, which opens Sync help for Retry/Discard. Built in Blocks step 10c; `AGENTS.md` carries the rule.

Decisions where the prototype is ambiguous or drops a function:

| # | Decision |
| --- | --- |
| D1 | Theme names are "Midnight · Daylight · System" on both platforms. |
| D2 | At most six pinned quick-start activities on both platforms; keys 1–6 start them on web. |
| D3 | "Week starts on" is a real stored preference that Calendar, Reports and weekly goals honour (the quick-start mosaic keeps sizing tiles by the last seven days). |
| D4 | The weekly goal shows in Reports (hero and streak). |
| D5 | Notifications and Motion & Fitness get rows under Settings › Automatic tracking. |
| D6 | Review drops "Always ignore" and "Make rule" everywhere (owner decision 8 October 2026, replacing the 7 October choice of a More menu): Accept and Skip / Ignore once remain. Existing automation rules keep applying at ingest, but no screen or API creates new ones. |
| D7 | Review's "Edit before logging" opens the existing evidence editor, restyled; the activity is chosen with the activity picker. |
| D8 | A Blocks Places screen (list, editor, learned places, Home and Work) fills the prototype's gap. |
| D9 | Reports uses Week · Month as the main control; Today, Year, custom ranges and the activity-over-time chart stay under a More range sheet. |
| D10 | Activities are archived with Restore, never deleted, so history is kept. |
| D11 | iPhone tags stay free text with autocomplete, shown as chips. |
| D12 | iPhone shows the daily goal (ribbon and goal frame) from the existing goal settings, edited with steppers under "Your day". |
| D13 | Every activity has a "Counts toward goal" switch in its editor on iPhone and web ("When off, time here still shows in your day but doesn't fill the goal."), off for Sleep by default and on for everything else (owner decision UIA-043, option c, 11 October 2026). A new activity named Sleep also starts off (the editors follow the name until the switch is touched; the API defaults an omitted value the same way); linking an existing activity to the Sleep starter keeps its switch. One rule drives all goal progress — Today's goal frame and Reports' days on goal / goal streak on both platforms: time in an activity that doesn't count is left out, time without an activity counts, and an archived activity keeps its switch for its history. Goal time is covered time (overlapping blocks count once) on both platforms. That time still shows as framed time everywhere else (totals, ribbons, blocks, reports). |
| D14 | iPhone Today's hero and the day totals in "Earlier this week" count covered time (owner decisions 14 Oct 2026, superseding UIA-305 for those totals only): time that overlapping blocks share counts once, so a day's total never passes the day's real length (23–25 hours across a clock change), the running block counts up to now, and the hero matches web Today's hero, web "Where today went" (#409) and the iPhone strip (D15). The goal cells and percentage are the covered time of activities that count toward the goal only (D13): an activity that doesn't count is left out before overlaps are merged, so a goal-counting block that overlaps Sleep fills the goal in full and the goal time never exceeds the hero. Each "Earlier this week" row's total uses the same shared basis (`coveredDurationMs`, every activity included; the rows show no goal progress), so a past day reads what its Today hero showed. Today has no "vs yesterday" line; Reports (including Reports › Today and its "vs yesterday" pill) keeps logged time. |
| D15 | iPhone Today has a "Where today went" strip (owner decision 14 Oct 2026, option A of `.codex-dayframe-qa/where-today-went-options-2026-10-14/`), folded into the bottom of the Today ribbon card under one hairline (no new card; the timer, Stop and mosaic don't move): a 12-point proportional bar of today's covered time per activity, largest first (solid display colours, 4-point corners, 2-point gaps, 3-point minimum; the running segment carries the 2-point coral edge, the strip's only coral), over a 2×2 legend of the top activities with durations — with more than four activities, the top three and a neutral "Other" (matching web's Other bar). Every activity counts, Sleep and others that don't count toward the goal included, and overlapping time is shared equally among the activities running in it (the same algorithm as web #409, `coveredActivityTotals` in `packages/shared`), so the strip adds up exactly to the covered hero (D14). The whole strip is one button that opens Reports on Today through a one-time in-memory range request; Reports still opens on Week otherwise (D9 unchanged). An empty day shows no strip. |
| D16 | "Start at the previous end" (owner decision 14 Oct 2026, idea 1): when nothing is recording and today's last finished block ended between one minute and four hours ago, the web command timer offers a compact pill "← From 10:15" (the shared back-arrow glyph; owner, 15 Oct 2026), whose accessible name adds the previous block — its description, else its activity: "Start from 10:15, after {previous}". One tap starts the block with the bar's description, activity and tags and moves its start back to that end through the same start-time edit as "Set to last stop time", so the gap is not lost. The owner asked for the cheapest form: the end is worked out on the device from the blocks already loaded, once a minute — no new query, field, index or server check. Before moving the start, the loaded blocks are checked again: if a newer block has ended since, the block stays at now and the bar says so. A block another device added that this one hasn't loaded yet isn't seen, so the start can then overlap it; accepted, as for the existing "Set to last stop time" button. The chip is hidden beside a trailing duration (`45m` logs a finished block instead). On iPhone a tap on Play starts the block straight away, so the offer is in the running block's entry sheet instead: when the block started 1 minute–4 hours after today's last loaded finished block ended, the same compact "← From 10:15" pill directly under the START card (VoiceOver: "Start from 10:15, after {previous}") moves the start back to that end (saved with Done, like any start edit; a second tap returns it to the block's own start). The sheet checks the loaded blocks again when the chip is tapped and on Done, and refuses ("That gap has changed") if that end has moved. Add time does not default to the previous end (idea 2, not approved). |
| D17 | Per-place "Log automatically" (owner decisions 14–15 Oct 2026): a saved place's "Log automatically" switch (web place editor and iPhone place editor; only while "Suggest visits here" is on; off by default; a Home place shows a caution but may turn it on) makes the server log a finalised stay there as a block (`time_entries.source = location_auto_log`, labelled "Logged automatically · {place}") instead of a Review card, in the production `v2_review` mode. Conservative: only a stay that passes the trusted-stay policy (PR #186: `medium_high`+ confidence, supported continuity, five-minute boundaries), was never offered in Review, and overlaps no tracked time at all — a running timer included — is logged; a visit offered in Review before (even under an older segment ID) stays a card, anything else stays a Review card, and stays under five minutes are not offered at all. On the web the block's editor shows "Logged automatically · {place}" under its heading. The block is tied to its stay's event: replay moves an unedited block with its visit and removes it when the visit is gone; a block the person edited or deleted is never touched (a deleted one is never re-created). Event-first: the stay's `activity_events` row is written (confirmed) before its block. A visit at such a place that stays a Review card says why (location v3, 16 Oct 2026): "Not logged automatically · location was less certain than usual", "· it overlaps a block", "· this visit was logged once before" or "· it was offered in Review before"; a card at a place with the switch off says "Log automatically is off for this place". No Review card claims automatic location logging is off for the whole app. |
| D18 | A per-device 12/24-hour time format (owner decision 16 Oct 2026): Settings › Appearance › Time format offers System · 12-hour · 24-hour on web (kept in this browser's localStorage) and on iPhone (kept on the phone); System, the default, follows the browser's language or the phone's 24-Hour Time setting. Every clock time of day uses it through the shared formatters (`9:30 AM` or `09:30`; whole-hour axis marks `9 AM`; the day's end `12 AM`); durations and running clocks are unchanged, and the report CSV keeps 24-hour times so spreadsheets keep reading them. Typed time fields accept AM/PM in either mode (`9:30 pm`, `930p`). The iPhone time wheel shows an AM/PM column in 12-hour mode. No account setting or migration: two devices may differ. |
| D19 | Location v3: Stays and Moves, and when location logs itself (owner approval 16 Oct 2026 of the Location v3 design, A1–A10; being built as PRs 1–16, so until each lands the rows above and "Automatic logging decisions" describe what ships). Everything location finds is a **Stay** (time at one place) or a **Move** (travel between two Stays); "Time away from…", "Commute detected" and "Visit at an unknown place" go away: a round trip is one Move ("Drive · round trip from Home"), a short unnamed stop stays inside its Move, an unknown stay from 10 minutes is a Stay at an unknown place. Policy: **log automatically when the evidence is clear** — Stays at places with Log automatically on (D17), and Moves between two known places with a clear mode (Motion & Fitness or the speed rule), the existing commute guards (medium_high, or today's medium saved-route exception; at least two route readings; no internal gap over 12 minutes; bounds within five minutes; no stop; overlapping nothing by more than five minutes; not under a Health workout) and Settings › Automatic tracking › "Log trips automatically" on (A4, on by default; deleting an automatic Move offers "Don't log trips like this" for that pattern, and a deleted automatic block is never recreated). Unknown places, unclear trips, trips with a stop and motion-only Moves go to Review; an unknown Stay and the Moves either side of it are one Review card. Every Review card says why it is there. Default activity for Moves: Commute for Home ↔ Work, "Getting around" otherwise (A5; the starter was named "Travel" until the owner renamed it on 20 Oct 2026, with a route icon), until the user's own names take over. **Names the user types become suggestions, never rules** (A8: prefilled after one use in Review, naming the automatic block after two; Dayframe's own titles never feed them). Venue suggestions for unknown Stays are resolved on the iPhone with MapKit and a ranker (A6); the server stores only the suggested venue's Apple Place ID, never Apple names or addresses, and web shows only names the user confirmed (A7; see Risks 6). Today and Calendar group only named patterns ("School run · 36m", A9). Places gets "Archive place" and "Replace the old place" when Home moves under 300 m (A10). |
| D20 | A Start that reaches the server late is placed in its own slot (owner decision 22 Oct 2026, PR A option a, extending #403): a Start made in the iPhone app and queued while offline (or delivered after a block was started elsewhere) is placed the way a Shortcut Start is since 14 Oct — it ends the block that covered its moment there and itself ends where the next block starts (or at the earliest later Stop) — instead of replacing the running block, and the newer block keeps running. There is no conflict prompt. A Start at exactly a running block's own start, and a Stop earlier than its block's start, are refused as permanent (`422` with `timer_start_before_running_block` / `timer_stop_before_start`) and the phone restores the server's timeline; neither ever blocks the timer changes after it. |
| D21 | Location v4: two layers, confidence and scoring bars (owner acceptance 23 Oct 2026 of the Location v4 design, B1–B12 with changes C1–C6; built in small steps, so until each lands D17, D19 and "Automatic logging decisions" describe what ships). **Two layers**: the engine's timeline (places, trips with legs and stops, gaps, an open trip while travelling) is always built automatically, never needs approving and keeps the user's corrections over later replays; a **block** is made only when the activity is known — a saved place with an activity and Log automatically on (D17), a Home ↔ Work trip as Commute, and any other trip as "Getting around" (or a named pattern's activity), even with an unknown end, once trips of that kind pass their bar (B3). Home, places with Log automatically off, unknown places and open trips never log themselves; an unknown place stays off the blocks until the user names it or picks an activity, and the user's own blocks always win. **Confidence**: Sure (the kind has passed its bar; logs when the activity is known), Likely (good evidence but the kind has not passed, or one input is weak; does not log), Unsure (low confidence or a guess; never logs, gets a "?" when it matters) and You set this (corrected or confirmed; logs with the user's activity). **Scoring bars**: each kind is scored against the owner's Google Timeline export with the local harness (`packages/location-quality`; the export and results stay outside Git as times, counts and metres): a kind becomes Sure only when, over 28 days or more, the 90% Wilson lower bound clears its bar with no 30-minute phantom or miss in the last 14 days — saved-place stays and trips between known places 95%, trips with an unknown end 95%, a multi-leg trip as one block 90%, a leg mode shown as Sure 90%, an unknown place shown as Sure 90%. Every engine change is scored before and after; a fresh export is taken every two weeks during the build. Baseline at main `411366c0` (15–22 Oct): week score 89/100 (30 × kind + 20 × places F1 + 15 × boundaries within 5 min + 15 × trips F1 + 20 × mode). No mileage (C5). |

Mobile accessibility and Dynamic Type:

- Keep iOS system font scaling enabled. Assign local scaling roles only to compact presentation text: screen headings (1.5), section headings (1.5), items (1.35), controls (1.3), metadata (1.3), numerals (1.2), counters (1.2), and inputs (1.35). Explanations, warnings, help, errors, and ordinary body copy remain uncapped. Reports keeps its separately approved dense-layout roles and staging-badge exception.
- A scaling cap is not evidence that a layout fits. Measure intrinsic text against the actual available native width and reflow before content or actions become unusable. Preserve complete times, durations, counts, labels, destinations, and VoiceOver context; wrap or stack content while keeping interactive targets at least 44 points.
- History, Review, Settings, timer editors, location evidence, and native Calendar must preserve their existing data, mutation, navigation, accessibility-action, and gesture owners. Typography changes are presentation-only and must not write user data or create parallel state owners.
- Validate ordinary and maximum system text sizes, Bold Text, Reduce Motion, supported phone widths, VoiceOver labels/actions, and both themes. Separate simulator/diagnostic evidence from signed staging and physical-device acceptance; synthetic fixtures never constitute physical acceptance.

Automation:

- Trusted-place auto-start.
- Geofence enter/exit event capture.
- Broad/unknown place review suggestions.
- HealthKit sleep and workout/walk summary import.
- Stored Review outcomes that can support a future owner-approved quality report or privacy-reviewed analytics design.

Privacy/data controls:

- Export workspace data.
- Delete time entries.
- Future full account/workspace deletion must hard-delete raw location, motion and health payloads.
- Motion & Fitness activity is Location evidence: exported, retained for seven days and deleted with it.

## 8. Technology Stack

Web:

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- `pg`
- `@supabase/supabase-js`
- Zod

Mobile:

- Expo
- React Native
- Expo Router
- Expo Router Native Tabs backed by the iOS system tab controller
- Expo SecureStore
- AsyncStorage
- Expo Location / Task Manager
- `@kingstinct/react-native-healthkit`
- Swift/SwiftUI local Expo modules for targeted iOS surfaces; UIKit may be wrapped through SwiftUI when a system interaction such as continuous scroll-view zoom requires it.

Database/infrastructure:

- Supabase Postgres with PostGIS
- Supabase Auth
- Vercel web/API hosting
- npm workspaces monorepo

Optional/future:

- Supabase Realtime or another realtime channel for active timer updates.
- Sentry with PII scrubbing.
- An owner-approved automation-quality report or privacy-reviewed analytics design.

Exact dependency versions live in the package manifests and lockfile rather than this PRD.

## 9. Security & Configuration

Authentication:

- Production uses `DAYFRAME_AUTH_MODE=provider`.
- Supabase Auth verifies identity and passwords.
- Dayframe provisions a matching app user/workspace and issues a Dayframe session token.
- Web stores the app token in an HTTP-only `dayframe_session` cookie.
- Mobile stores the app token in SecureStore and sends it as a bearer token.

Authorization:

- API routes resolve a `RequestSession`.
- Data is scoped by `workspace_id` and `user_id`.
- Supabase RLS policies mirror workspace membership as defense-in-depth.
- Integration tokens are separate from user sessions.
- Location consent is specific to the authenticated backend/workspace/user. Signed-out, stale-generation and pre-binding observations cannot become the next account's history; a Visit starting before binding is discarded without clipping or replacing its arrival.
- Explicit logout warns that local unsynchronised Location evidence is removed and clears the signing-out owner's local Location data even without an active capture binding. Definitive involuntary authentication invalidation stops new capture but retains previously accepted evidence only for its original owner; offline operation and same-owner refresh do not sign the user out. Local journal rows expire after seven days. Queued/batched upload bodies, including acknowledged bodies with raw coordinates, and retained engine/account/segment context do not share that expiry. Signing back in and successful upload do not purge those copies. Explicit logout clears these local stores; Delete recent evidence clears the local journal, upload bodies and engine state, while account/segment context remains. Bounded expiry/deletion of these retained copies is a separate privacy/storage follow-up.
- Catalogue refresh requires the current owner, binding, generation and scoped consent and cannot grant capture. A fresh capture admission cutoff does not reset a valid same-owner/backend Review cutover. Preserve semantic eligibility through involuntary invalidation, opt-out and attributable upgrade; explicit logout and actual server mode transitions retain their reset rules. Ambiguous legacy attribution cannot establish an acknowledgement.
- A valid explicit Location opt-out remains scoped and durably off when logout or authentication invalidation overtakes queued capture work. A later authorised opt-in wins in intent order. Interrupted opt-out must reconcile monitoring while rejecting evidence; consent or OS cleanup failures must not be reported as success. Departing-session bootstrap cannot reactivate capture during final logout deactivation. After logout definitively fails, fresh reads for a still-valid session work while unresolved capture cleanup stays closed; previously stale responses remain rejected. Stored Location consent and effective capture are distinct: interrupted activation is shown as inactive with an explicit Settings retry, without erasing consent or automatically enabling a disabled binding.

Required hosted environment variables:

```bash
DAYFRAME_AUTH_MODE=provider
DATABASE_URL=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
DAYFRAME_ALLOWED_SIGNUP_EMAILS=you@example.com,friend@example.com
DAYFRAME_SIGNUPS_ENABLED=false
EXPO_PUBLIC_DAYFRAME_API_BASE=https://your-vercel-domain.vercel.app
```

Security scope:

- In scope: auth, signup allowlist, RLS migration, app sessions, export/delete groundwork.
- Out of scope for MVP: enterprise SSO, billing security, organization admin roles, formal compliance certification.

## 10. API Specification

Authentication:

- `POST /api/auth/signup`
  - Body: `{ email, password, name?, workspaceName? }`
  - Provider mode: creates Supabase Auth user, provisions Dayframe user/workspace, returns app session if confirmed.
  - If email confirmation is enabled: returns `202` with `requiresEmailConfirmation`.

- `POST /api/auth/login`
  - Body: `{ email, password }`
  - Provider mode: verifies credentials through Supabase Auth and returns Dayframe app session.

- `POST /api/auth/logout`
  - Revokes Dayframe app session and clears web cookie.

- `GET /api/auth/me`
  - Returns current user/workspace/session mode.

Core app:

- `GET /api/bootstrap`
  - Returns active timer, entries, categories, places, review items, stats, dashboard data, and legacy project/client compatibility data.

- `POST /api/categories`
  - Creates one workspace-scoped category. Name-only callers receive a deterministic Dayframe palette colour; callers may instead provide a canonical palette colour. Contextual picker creation remains unpinned, and active names are unique case-insensitively within the workspace.

- `POST /api/time-entries`
  - Modes: start, stop, manual entry creation.
  - Mobile may send `source: "mobile_app"`.

- `PATCH /api/time-entries/:id`
  - Edits category/place/description/start/stop, with legacy project fields preserved for compatibility.

- `DELETE /api/time-entries/:id`
  - Deletes an entry.

- `POST /api/events`
  - Ingests mobile/geofence/HealthKit/NFC/shortcut events.
  - Requires app bearer/cookie session or scoped ingest token.

- `POST /api/review/:id`
  - Accept or ignore once (structured envelope actions for Location items). "Always ignore" and "Make rule" were removed on 8 Oct 2026 and are rejected with `invalid_action` (400).

- `GET /api/export`
  - Supports workspace JSON and time-entry exports.

Example event payload:

```json
{
  "source": "health_workout",
  "type": "health_workout_import",
  "occurredAt": "2026-07-03T08:30:00.000Z",
  "description": "Outdoor walk",
  "rawPayload": {
    "provider": "healthkit",
    "workoutType": "walking",
    "startedAt": "2026-07-03T08:30:00.000Z",
    "stoppedAt": "2026-07-03T09:10:00.000Z",
    "durationMinutes": 40
  }
}
```

## 11. Success Criteria

MVP success definition:

Dayframe is useful as the owner's daily personal time tracker for at least two continuous weeks, with web/mobile manual tracking, iOS HealthKit sleep/walk/workout capture, trusted-place automation, review correction, and hosted login/sync working reliably.

Functional requirements:

- ✅ User can sign up/log in through hosted Supabase Auth.
- ✅ Only allowlisted beta users can create accounts.
- ✅ Web and mobile share active timer state.
- ✅ Mobile can queue events offline and sync later with retry and diagnostics; real-device reconnect/background/conflict behaviour remains under Watch before wider beta confidence.
- ⚠️ iOS provides one fixed-slot connectivity status plus an account-owned retry coordinator. Cached and fetched Dashboard truth is deterministically composed with durable Start/Edit/Delete/Stop work, so refresh/relaunch cannot erase offline changes; pending and actively transmitting work remain distinct but sync silently in the background (Blocks step 10c), and the brief "back online" notice follows only a confirmed offline-to-online transition. Signed staging and physical-iPhone network/background-transition evidence remains required before release confidence.
- ✅ Trusted places can auto-start entries.
- ✅ Ambiguous location events appear in review.
- ✅ HealthKit sleep and workouts/walks appear as time entries or high-confidence review items; duplicate/overlapping Sleep remains a tracked investigation.
- ✅ User can edit/delete entries from web.
- ✅ User can export data.
- ⚠️ Full account/workspace deletion and raw payload hard-deletion controls are not complete yet.
- ✅ Hosted deployment works on Vercel with Supabase database.

Quality indicators:

- No runtime error overlays during normal navigation.
- No React key/hydration warnings.
- Production build passes.
- Mobile typecheck/build path remains healthy.
- Sensitive raw data is not sent to analytics.
- TestFlight release evidence is captured before KB is asked to test mobile changes.
- Calendar pinch/scroll interactions remain continuous under the fingers, preserve the focal point, and do not snap through a second layout path when the gesture ends.

User experience goals:

- Timer start/stop feels immediate.
- Review items explain why they exist and why automatic logging did not apply.
- Timeline is readable and editable.
- Corrections are faster than manual re-entry.

## 12. Implementation Phases

### Phase 1: Hosted Auth And Deployment

Goal: make Dayframe accessible on Vercel with Supabase Auth.

Deliverables:

- ✅ Supabase Auth provider mode.
- ✅ Signup allowlist.
- ✅ Supabase RLS migration.
- ✅ Vercel/Supabase hosting documentation.
- ✅ Hosted environment variable setup.

Validation:

- Login/signup work on Vercel.
- `/api/auth/me` resolves hosted user/workspace.
- Mobile can log in against hosted API.

### Phase 2: Reliable Sync And Offline Mobile

Goal: make mobile/web timer state reliable.

Deliverables:

- ✅ Active timer sync path.
- ✅ Offline event queue reconciliation.
- ✅ Dedicated durable mobile Stop outbox with exact timer identity, original tap time, stable idempotency, and foreground/relaunch projection.
- ✅ Conflict handling for start/stop/switch events.
- ✅ Retry and auth-expiry behavior.

Validation:

- Start on mobile appears on web.
- Stop on web appears on mobile.
- Offline mobile events sync in order after reconnect.
- A locally accepted mobile Stop survives force-quit, remains scoped to its original timer/account, and clears silently after success, duplicate, or superseded acknowledgement.

### Phase 3: Health And Location MVP

Goal: turn iOS signals into useful personal time records.

Deliverables:

- ✅ HealthKit sleep summary import.
- ✅ HealthKit walking/workout summary import.
- ✅ Trusted-place auto-start.
- ✅ Broad/unknown geofence review suggestions.
- ✅ Learned-location evidence separates repeat place suggestions, significant one-off stays, and weak/pass-through noise.
- ✅ Learned-place details cache readable address/POI resolution and keep coordinates secondary.
- ✅ `location-v2.0` closes stays on accepted intervening-place evidence, sustained exits, or explicit gaps; preserves short saved-place endpoints; derives journeys from movement evidence; and exposes uncertainty instead of fabricating exact boundaries.
- ✅ Mobile and web consume one user-scoped `LocationReviewEvidenceDto` for map plus textual review, with atomic confirm, split, merge, place correction, record-once, one-time POI, and save-place actions. Mobile stays, including saved matches, use the native Apple POI boundary to load up to five nearby results (opaque ids until one is picked), enrich a repeated distinctive site context with at most one bounded local search, prefer a varied destination slate over duplicate tenants and utilities, retain explicit search and map fallback, and default selection to a one-time name unless the user enables `Save for future visits`. This ranking remains a nearby aid rather than a popularity or exact-venue claim. A one-time choice stores only its trimmed name on the derived entry and, since location v3 PR 8, the picked venue's Apple Place ID on its stay (`stay_segments.venue_place_id`); it retains no Apple address, coordinates or response payloads. Physical iPhone reliability and battery measurement are still mandatory before the rollout is considered settled.
- ⚠️ V2 rollout is server-authoritative: `v2_shadow` captures and replays without user-visible V2 semantics; `v2_review` permits review items only after a same-mode client acknowledgement; and `v2_enabled` applies the narrow automatic policy. See the automatic logging decision table above. Existing Review or terminal decisions are never silently promoted on replay; deletion cannot resurrect an entry, and shadow-era segments cannot be backfilled at cutover.
- ⚠️ Export path exists; account/workspace deletion and raw sensitive payload hard-deletion are still future work.

Validation:

- Sleep appears with correct duration/time window.
- Walking/workout entries have correct duration.
- Trusted place starts correctly.
- Unknown/broad places do not create silent incorrect entries.
- Two appearances at one venue separated by Home remain two stays; a 10–15 minute saved stop remains a journey endpoint; a corroborated short unknown stop stays inside one trip, and its Location Evidence lists it ("Stopped 13:22–13:28 · 6m", marked approximate when bounded by evidence), while a visit-length stop splits journeys; overlapping saved radii select one deterministic best saved place while retaining bounded alternatives; and Europe/London local-day grouping remains correct across BST/DST.

### Phase 4: Product Polish And Beta Hardening

Goal: make the product comfortable for daily personal use and friends beta.

Deliverables:

- ✅ Review inbox improvements.
- ✅ Reports.
- ❓ Automation accuracy measurement remains a decision item; stored outcomes are not the same as a shipped analytics surface.
- ⚠️ Settings for permissions and export exist; deletion/privacy controls still need the next-phase work tracked in `docs/feature-fix-tracker.md`.
- ✅ Internal TestFlight build workflow is active; exact release evidence lives in the tracker and release reference.
- ⚠️ Native SwiftUI/UIKit Calendar behavior remains under physical-iPhone Watch for creation, taps, day/week navigation, refresh, pinch/vertical pan, and accessibility settings.

Validation:

- Owner can use Dayframe for two weeks without data loss.
- Friends can sign in and test without developer help once the wider-beta invite/support path is approved; the isolated hosted Preview lane already exists.
- If automation-quality measurement is approved, it reports accepted/ignored outcomes without raw Health or location context.

## 13. Future Considerations

- Calendar integration for work meeting hints.
- Home Assistant/local bridge integrations.
- Realtime sync through Supabase Realtime/WebSocket/SSE.
- More advanced rule learning from accepted/ignored suggestions.
- Account deletion UI with full raw health/location deletion.
- Signed-device validation of the implemented separate staging iOS bundle, App Group, Keychain, URL-scheme, Live Activity extension, and APNs lane.
- App Store release if sideloading is no longer sufficient.

## 14. Risks & Mitigations

1. Health/location privacy risk.
   - Mitigation: minimize raw payloads, document retention, add export/delete controls, avoid sensitive analytics payloads.

2. False automation risk.
   - Mitigation: log automatically only when the evidence is clear (trusted Stays at places with Log automatically on; under D19, Moves between known places with a clear mode and the commute guards); route unknown places, unclear trips, trips with a stop and Home-like signals through Review; a deleted automatic block is never recreated, and "Don't log trips like this" and the "Log trips automatically" switch stop a pattern or all trips.

3. Background location reliability risk.
   - Mitigation: rely on iOS geofencing constraints, cap monitored regions, expose sync/review status, and avoid promising perfect tracking.

4. Hosted auth/data isolation risk.
   - Mitigation: Supabase Auth, signup allowlist, Dayframe session scoping, RLS migration, and workspace membership checks.

5. Offline conflict risk.
   - Mitigation: keep event timestamps, process events transactionally, close prior active timers on explicit starts, and surface ambiguous conflicts in review.

6. Apple map data licence risk (decided: the owner accepted the engineering reading on 21 Oct 2026; no external legal check).
   - The Apple Developer Program License Agreement, Attachment 6 (Apple Maps), as read for the Location v3 design: no derived database of Apple map data, no storage of it beyond temporary use, Apple Place IDs exempt and storable; Apple map data should be shown with the matching Apple map. This is an engineering reading, not legal advice.
   - What it touches: (a) the planned server copy of the suggested venue's Apple Place ID for unknown Stays (D19, A7) — the design stores Place IDs only, the iPhone resolves names next to an Apple map, web shows only names the user confirmed; (b) **existing practice**: a nearby result picked once is stored as the block's one-time `time_entries.place_label` (the trimmed name only, no Apple identifier, address or coordinate), and a nearby result saved as a place starts with that name in `places.name` (editable). Both are names the user chose, but they originate from Apple's data.
   - Mitigation (kept after the decision below): store no Apple names, addresses, categories or coordinates beyond what the user picks or types; keep venue lookups on the device.
   - Outcome (21 Oct 2026): the owner accepted the engineering reading above, without an external legal check. Apple Place IDs may be stored (PR 8a, #519: `stay_segments.venue_place_id` and `suggested_venue_place_id`); the server stores no Apple names, addresses, categories or coordinates beyond what the user picks or types. The existing practice is also accepted: a nearby name the user picks is kept as the block's one-time `time_entries.place_label` or as an editable `places.name`.

## 15. Appendix

Related documents:

- `README.md`
- `docs/architecture.md`
- `docs/documentation-governance.md`
- `docs/feature-fix-tracker.md`
- `docs/production-readiness.md`
- `docs/local-auth-and-hosting-plan.md`
- `docs/vercel-supabase-hosting.md`
- `docs/dayframe-regression-checklist.md`

Key repository structure:

```text
apps/web      Next.js web app and API routes
apps/mobile   Expo iOS mobile app
packages/db   Postgres/PostGIS migrations and scripts
packages/shared shared schemas, types, event normalization
supabase      hosted Supabase migrations
```

Important assumptions:

- The first hosted version is personal/friends beta, not public SaaS.
- iOS is the only mobile platform for MVP.
- Supabase email confirmation may be disabled initially for easier sideload/beta testing.
- HealthKit summaries are sufficient for MVP; raw detailed samples should be minimized.
- Precise location can be stored for geotracking but must be fully deletable.
