# Running Timer Suggestions And Elapsed-Time Drift

Date: 2026-07-14

## Reported symptoms

- PR #63 placed mobile task suggestions below the Today tab task field after empty Play.
- The list read as a static dashboard card instead of part of the running-timer completion flow.
- TestFlight could show different elapsed values on the Active timer card and Edit timer sheet.

## Baseline evidence

- Local iOS reproduction showed empty Play creating a timer while leaving a large six-row suggestion panel in the Today `Start task` section.
- Opening Edit timer showed no suggestions.
- A captured state showed the Active timer card at `00:44` while the sheet showed `00:47`.
- The web implementation already opened suggestions from the task-description field and behaved like an autocomplete.

## Root cause

- `DayframeDashboard` calculated elapsed time from the active entry's exact ISO `startedAt` timestamp.
- `ActiveTimerEditSheet` converted that timestamp to editable `HH:mm` text, parsed it again, and calculated elapsed time from the minute-level value. Discarding seconds created a 0-59 second drift and saving an untouched running timer could also truncate the server timestamp.
- PR #63 used Today-only visibility state and row rendering, so the suggestions could not participate in the running edit flow.

## UX decision

- Keep empty Play immediate: create the bare timer first, then open `Edit timer` for that running entry.
- Put one compact `SUGGESTIONS` box in the running sheet above Description, Category, and Start time.
- Use one-line rows with dividers and category metadata only when available. The full row applies the suggestion; no Play glyph is shown because the timer is already running.
- Hide the box on an outside sheet interaction or Description focus. Do not add a dismiss button.
- Keep web suggestions anchored to focus/click on `What are you working on?`.

## Implementation guardrails

- Calculate active elapsed seconds once from the exact active entry and the dashboard `now`, then pass that value to the running sheet.
- Only calculate a sheet-local preview after the user explicitly edits Start time.
- Do not send `startedAt` when saving a running timer unless the user changed it.
- Applying a suggestion uses the existing time-entry PATCH path; it must never call timer start.
- Suggestion history requires explicit manual provenance and confirmed review status, and still excludes automatic event types.

## Validation record

- Unit and source-contract tests cover shared elapsed time, running-sheet placement, max six, PATCH-only application, focus-triggered web behavior, pinned-only quick actions, and automatic/unconfirmed exclusions.
- iOS simulator evidence confirms the running sheet title, live elapsed sync, compact rows, outside/manual-entry dismissal, and suggestion application without another timer.
- Desktop and phone-width web evidence confirms the compact panel opens from the field without horizontal overflow.
- Lint, typecheck, all unit tests, web build, brand assets, diff check, and the native iOS simulator build pass.
- `npm run testflight:preflight` ran. Xcode, the active developer directory, bundle metadata, and CocoaPods checks passed; release preflight stopped because this machine does not have the Apple Distribution identity, App Store provisioning profile, or local App Store Connect API env file. No archive was attempted.
