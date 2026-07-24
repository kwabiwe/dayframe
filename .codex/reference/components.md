# Component Guidelines

Use this when working on frontend components.

## Component Structure

- Keep components focused on one responsibility.
- Prefer existing UI primitives and local component patterns.
- Keep data fetching, mutations, and presentation responsibilities clearly separated.
- Use accessible labels, semantic HTML, and keyboard-friendly controls.
- Keep Dayframe timer surfaces category/task-first. Avoid exposing projects/clients in primary timer UI.
- On web, Dashboard and Timeline must consume the one timer runtime mounted by `AppShell`. Route components must not mount an independent active-timer poll, store, API client, mutation queue, shortcut handler or manual-entry owner; navigation between those routes must preserve the same optimistic state and active-entry identity.
- Keep the persistent web timer on one explicit measured track: a flexible `minmax(0, 1fr)` task compound control, bounded Category and time tracks, and shared icon-action footprints for Plus and Play/Stop. Idle/running swaps must preserve outer geometry; compact layouts may reflow the task field to its own row but must not shrink or overlap the remaining actions.
- Timer-owned Suggestions, Tags, Categories, and start-time surfaces must use the shared floating-surface treatment and escape the timer panel's clipping boundary. Keep their lists internally scrollable, their triggers visually connected, and phone-width variants fully inside the viewport; do not substitute a scrimmed modal for an anchored timer editor.
- For positioned web Calendar blocks, degrade content by rendered-height priority: title, duration, category/place context, then tags. Running state must not reduce whole-block text opacity.
- A positioned Calendar container must not itself be an interactive wrapper around actions. Give selection/details one primary action, keep restart and pointer-resize as siblings, provide keyboard and touch equivalents for hover actions, and define a minimum rendered height before mounting direct resize handles.
- Calendar and List restart actions must reuse the shell-owned timer runtime and its mutation gate. Copy only category, description, and tags unless the timer contract is deliberately expanded in a separate change.
- Keep the iOS dashboard focused on logo/header, active timer, start task, quick category actions, and Today summary.
- Move location and HealthKit permission controls to onboarding and Settings.

## State And Forms

- Prefer controlled form state only where it adds clarity.
- On web, use the shared field/control classes before adding route-local geometry. Inputs with nested reveal, clear, tag or search actions must use one compound wrapper focus owner; do not stack wrapper and input perimeters.
- Validate at the boundary before persistence.
- Show loading, empty, success, and error states for user-facing actions where they help the user understand the state.
- For normal mobile timer mutations, loading UI should be invisible: start, stop, edit, delete, and suggestion-apply actions should update optimistically, then reconcile silently. Do not add spinners, progress bars, or layout-moving loading rows for these paths. Keep visible spinners for deliberate pull-to-refresh only.
- Task title is optional. Category is optional and should be editable while a timer is running.
- Running-timer suggestions are metadata completion for the existing active timer. Empty Play starts one bare timer then opens the running edit sheet; Play while a timer is already running should open the same suggestion/edit flow. Applying a suggestion must update that active timer, not create a second timer.
- Surface friendly, actionable permission messages; never display raw native exception strings to users.
- Treat route state as the source of truth for same-route mobile sub-settings. Do not mirror the active route section into local state or intercept native back gestures to repair duplicated navigation state.
- For inline iOS forms near the bottom of a scroll view, keep the focused input mounted, apply the native keyboard inset, and reveal the complete required control group—not only the text field—above the keyboard at normal and Dynamic Type sizes.
- When timer state is mirrored to a native system surface, serialize reconciliation and make the latest requested state win; optimistic and persisted entry updates must not race separate native lifecycle calls.

## Motion Ownership And State

- Read `.codex/reference/motion.md` whenever a component introduces visible movement or changes layout over time.
- A moving component must expose or own a complete state sequence: entrance, update/reflow, exit, cancellation, and async rollback where applicable. Do not leave a parent to animate one half while a child mounts or disappears abruptly.
- Prefer an existing motion primitive and `MOBILE_MOTION` token over local duration constants. Local list, notice, picker, confirmation, and expansion motion should stay on the UI thread when possible.
- Keep stable keys and deterministic replacement rules so rapid actions do not replay stale exits, dismiss newer feedback, or restore obsolete state.
- Do not add a Swift component to repair ordinary React Native presence or layout motion. Choose native ownership only for a documented platform interaction need.

## Native iOS View Boundaries

- Use a standard local Expo module for a targeted Swift/SwiftUI view that lives inside the existing Expo app. Export an `ExpoView`, retain one `UIHostingController` for its SwiftUI hierarchy, and update its observable model through typed Expo `Record` props/view events. Do not use the experimental inline-module path, create a second app target, or migrate unrelated screens in the same PR.
- React Native remains responsible for authenticated bootstrap data, API mutations, active-timer truth, selected route state, and presentation of the existing timer/entry/Review sheets.
- Pass the native Calendar a serializable presentation model: selected/today day keys, week days, total, entries with timestamps and state flags, category display metadata, resolved theme roles, and accessibility/reduced-motion preferences.
- Emit semantic actions such as select day, change day/week, open active timer, open completed entry, and open review item. Swift must not fetch Dayframe APIs, write the offline queue, or own a second copy of the timer/domain model.
- Preserve native view identity across ordinary React prop updates so ticking time, bootstrap refreshes, and optimistic reconciliation do not reset zoom or scroll unexpectedly.
- Give the timeline one gesture and vertical-scroll owner. A SwiftUI Calendar may wrap `UIScrollView` with `UIViewRepresentable` for continuous focal-point-preserving zoom; do not nest a competing React Native pinch/pan handler around it.
- Map stable entry/review identifiers through callbacks and add contract tests for serialization, callback routing, and no duplicate mutation path.

## Review Checklist

- [ ] Component follows existing naming and folder conventions.
- [ ] Props and types are explicit.
- [ ] Error and loading states are handled.
- [ ] Mobile and desktop layouts are checked.
- [ ] No text overflow or overlapping UI.
- [ ] Web fields have one focus owner and shared geometry; compound nested actions remain independently keyboard-visible.
- [ ] The persistent web timer keeps equal control heights, identical Plus/Play/Stop footprints, stable idle/running geometry, truncating Category text, and no horizontal overflow at desktop, compact, phone, or 200%-zoom-equivalent widths.
- [ ] Positioned Calendar blocks preserve title-first density, normal-opacity Running text, valid sibling interaction semantics, keyboard/touch action parity, and the documented direct-resize height policy at every zoom.
- [ ] Timer mutations feel immediate and do not show non-refresh loading indicators.
- [ ] Dashboard changes preserve the core timer/start-task flow.
- [ ] Permission controls are not placed on the dashboard.
- [ ] Native iOS views preserve the React data/mutation boundary and do not reset interaction state during ordinary prop refreshes.
- [ ] Moving components cover entrance, reflow, exit, interruption, async rollback, and Reduce Motion states that apply.
