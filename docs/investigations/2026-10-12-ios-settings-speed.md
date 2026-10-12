# iPhone Settings speed and offline "needs your attention"

Date: 2026-10-12
Scope: audit step I1 (owner Trello card 208). Settings takes 1–2 s to open from the Today avatar, each sub-page about 1 s, Back sometimes doesn't respond; much snappier in Airplane mode. Offline shows "Something needs your attention".

Status: static investigation plus first fix PR (`agent/ios-settings-speed`). Device timing was **not** measured here (no physical iPhone in this session); the PR body carries the before/after phone checklist. Line numbers below refer to `origin/main` at `4d4fcc47`.

## How Settings is built

- Every Settings page is the same 3,000-line `SettingsScreen` route (`apps/mobile/app/settings.tsx`). The index and each sub-page (Your day, Activities, Location, Apple Health, Sync help, Account, About) are separate **pushes of the whole screen** with a `section` param (`settings.tsx:994-996`, `router.push({ pathname: "/settings", params: { section } })`). Opening a sub-page therefore mounts a second full instance with every effect below; the index underneath stays mounted and keeps its subscriptions.
- First render already uses a module-level cached snapshot (`settings.tsx:324-371`, `cachedSnapshot?.data`), so nothing awaits the network before the first frame. The cost is what runs **during and right after** the push animation on the JS thread.

## What ran on every mount (before this PR)

| # | Where | What | Cost estimate (phone) |
|---|---|---|---|
| 1 | `settings.tsx:579-597` | `refreshQueueLatest()`: two SecureStore owner reads + AsyncStorage queue read + JSON parse | 10–50 ms, grows with queue |
| 2 | `settings.tsx:630-632` and `:718-725` (focus) | `load()` whenever the snapshot is older than 30 s (`settingsRefresh.ts:1`): `drainNativeShortcutQueue`, **`fetchBootstrap()` (network)** + `getLocationVisitDiagnostics()` (six native permission/task reads, `geofence.ts:1016-1026`), then `setData` (full re-render of the 3,000-line tree), `configureLocationIntelligence`, `syncShortcutCatalog`, location-v2 diagnostics (native), and the three outbox diagnostics below again | Network RTT + large JSON parse + one or two full re-renders: **300–1,500 ms of JS work landing inside or just after the transition** |
| 3 | `settings.tsx:634-655` | Review (SQLite, two queries), time-entry outbox (AsyncStorage ×2), timer-Stop outbox (AsyncStorage) diagnostics | 20–80 ms |
| 4 | `settings.tsx:671-677` | Review reminder state + dynamic import of the notification module + permission read | 10–40 ms (first time: module load) |
| 5 | `settings.tsx:711-716` | Motion & Fitness authorisation (native) | 5–20 ms |
| 6 | `settings.tsx:727-752` (index, Apple Health) | HealthKit availability, automatic-sync flag, import preferences, mapping writer refresh | 20–100 ms native + bridge |
| 7 | `settings.tsx:754-772` (index, Location) | **`refreshGeofencesForPlaces()` on every mount and on every new `data.places` array** (each bootstrap creates a new array): rewrites the capture catalogue and re-registers monitored regions natively (`geofence.ts:524-548`), then re-reads location diagnostics | 50–300 ms, plus a second run after the bootstrap lands |
| 8 | `settings.tsx:808-810` | Location "needs iPhone Settings" permission read (native) | 5–20 ms |
| 9 | `settings.tsx:718-725` | Activities always forces `load()` + archived activities (network) on open | Network + re-render |

Why Airplane mode feels faster: with no network `fetchBootstrap()` fails at once (transport failure), so step 2 never parses a bootstrap or re-renders the screen, and step 7 runs once instead of twice. Online, the bootstrap usually lands 300–800 ms after the tap, exactly while the push animation runs, and its re-render plus the second geofence refresh compete with the animation and touch handling on the JS thread.

Why Back could be unresponsive: `BlocksNavHeader`'s Back is a JS `Pressable` (`BlocksNavHeader.tsx:46-62`) calling `router.back()` (`settings.tsx:990-992`) — no async guard, it is disabled only while signing out. When the JS thread is busy (step 2 re-render, step 7), the press is queued, not dropped, and fires late; a second tap can then pop twice or appear to do nothing. Popping back to the index also re-ran the focus effect (`:718-725`), which started `load()` (if > 30 s since the last one) and `reloadThemePreference()` during the pop animation. Every mounted Settings instance (index plus the sub-page) also re-rendered on each queue/outbox tick, because both kept their subscriptions.

No lock or pending promise blocks navigation: the refresh coalescer (`createOwnerSyncCoalescer`, `settings.tsx:375`) and the activity change gate only serialise data work.

## Offline "Something needs your attention"

- The text comes from `syncHelpStatus()` (`apps/mobile/src/lib/settingsSyncDiagnostics.ts:40-95`), shown on the Settings index Help row and in Sync help. It turns to `attention` whenever **any** Review outbox row is in `needs_attention` (`listReviewSyncIssues`, `reviewSyncStore.ts:2178-2202`).
- Review rows enter `needs_attention` with `resolution_status = 'resolution_unknown'` when the outcome is merely unknown: a reconcile request that times out or gets no proof (`reviewSyncStore.ts:1920-1929`, `:1964-1965`, `:1973`). That is exactly what happens when connectivity drops while a Review choice is in flight (row left `in_flight` → next pass reconciles → request times out instead of failing fast). These rows were then only re-checked on a *forced* pass (`:1904`, `state='needs_attention' and ?=1`), and they cannot be discarded (`discardReviewSyncIssue` refuses them, covered by `reviewSyncStore.sqlite.test.ts`). So going offline at the wrong moment produced a sticky "needs your attention" with nothing for the person to choose.
- The other inputs are correct: queue `permanentFailedCount` only counts 400/413/422 or explicit permanent kinds (`api.ts:2114-2119`); time-entry and timer-Stop issues only count `failureKind === "permanent"` (`timeEntryOutbox.ts:247-292`, `timerStopOutbox.ts:96-115`). The Today avatar badge uses its own `useSyncAttentionCount` context and was not implicated.
- Uncertainty: without the device's outbox state we can't prove this was the owner's exact trigger; it is the only path in the code where connectivity alone produces `attention`. A Sync help export from the phone would confirm (`resolution_unknown` rows).

## Fix in this PR

1. **Transition first, reads after.** `useSettingsTransitionReady()` waits for the screen's native-stack `transitionEnd` (opening, not closing) with a 650 ms timer fallback (`afterSettingsTransition`, `src/lib/settingsTransition.ts`; on RN 0.85 `InteractionManager` no longer waits for navigation). Work is cancelled on unmount/blur and discarded if the account changed. It gates steps 1, 3, 4, 5, 6, 7 and 8. Outbox/queue *subscriptions* still register at once, so no change is missed; only the opening reads wait.
2. **Focus refresh after interactions, cancellable.** The focus effect (open and Back) now schedules `load()`, theme reload and archived activities through the same transition gate and cancels when the page loses focus before it ran. The separate mount-time `load()` effect was removed (the focus effect covers the same "stale snapshot" case, through the same coalescer).
3. **Geofences re-registered only when the places change.** A module-level key (`settingsGeofenceKey`, `settingsRefresh.ts`) of user, workspace and every field of every saved place (so catalogue-only changes such as name or default activity still refresh) skips identical refreshes for the rest of the app session; cleared on sign-out; recorded only after a successful refresh that monitors at least one place. Launch and place edits keep their own refresh paths.
4. **Unknown is not attention, at the durable owner.** `reviewSyncStore` treats `needs_attention` rows with `resolution_unknown` (or an interrupted `reconciling`) as unknown everywhere: excluded from `needsAttentionCount` and `listReviewSyncIssues`, counted in `checkingCount`/`waitingCount` with `nextRetryAt` = updated + 5 min (so the durable-work monitor schedules them), shown on Review cards as waiting, and never discardable. A cancelled or 401 re-check restores `resolution_unknown`. Review's Fix appears only for real rejections, matching Sync help, and the card copy names Sync help. The Review lane now re-checks such rows on ordinary passes once they are 5 minutes old (`REVIEW_UNKNOWN_RECHECK_MS`), so they settle on their own; a still-offline re-check goes to normal `retry_wait`. Nothing is cleared, discarded or inferred from reachability; forced passes behave as before.

Regression tests: `settingsSpeed.contract.test.ts` (no await before first effect, deferred reads, subscriptions immediate, focus refresh deferred/cancellable, geofence skip, Back unguarded), `settingsSyncDiagnostics.test.ts` (offline-only work is "waiting"; every real rejection is still "attention"), `settingsRefresh.test.ts` (geofence key), `reviewSyncStore.sqlite.test.ts` (unknown outcome re-checked only after the pause; offline re-check keeps the row and waits).

## Deferred (follow-ups)

- Split `SettingsScreen` into per-section components so a sub-page mounts only its own state and effects, and pause covered instances' subscriptions while unfocused.
- Reuse Today's in-memory bootstrap for Settings instead of a 30 s TTL refetch.

## Proposed wording (less technical, follow-up)

| Now | Proposed |
|---|---|
| Something not syncing? (Help row / Sync help title) | Sending your changes |
| Something needs your attention / Choose what to do with each change below. | A change couldn't be saved / Choose what to do with it. |
| N changes waiting to send / They send on their own when you're online. | N changes will send when you're back online |
| Nothing is waiting / All your changes are saved. | All changes saved |
| Everything is up to date | All changes saved |
| Sign in to send your changes | Sign in again to finish saving |
| Unreadable records (quarantine rows) | Some saved changes couldn't be read |
| Export diagnostics | Send a report |
