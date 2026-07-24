# Web Manual-Entry Popup And Control Polish

Date: 2026-07-24

Branch: `codex/web-manual-entry-popup-polish`

Base: `77fac9a` (merged PR #107)

Status: Merged in PR #108 at `7997b28`; visual-regression follow-up active

## Scope

This focused follow-up applies KB's post-merge visual review:

- show only complete task-suggestion rows with a hard visible limit;
- anchor manual-entry Tags beneath the tag icon instead of above/full-width;
- preserve the Add time dialog's rounded silhouette and remove native focus chrome;
- remove visible borders from manual Category, Start and Finish controls;
- use the timer Category option presentation in Add time;
- apply the Dayframe surface, type, radius, hover and theme treatment to web
  date/time controls while preserving native click-to-select behaviour;
- anchor Delete running task below More and keep it inside the viewport.

No API, database, mobile, timer mutation, range-query or persisted-data contract
changes are in scope.

## Evidence And Root Cause

1. PR #107 passed six Suggestions into a surface whose 260 px manual override
   could not always contain its header, border, padding and six 44 px rows.
   The final row therefore appeared partially clipped.
2. Manual Tags overrode the shared picker geometry with `bottom: 100%`,
   `left: 0` and `width: 100%`, placing it above the entire Description field
   instead of beneath the tag trigger.
3. Add time still used `SelectField`, so its Category control could not match
   the timer's category dot, selected tint and compact option rows.
4. `overflow: visible` allowed the manual dialog's square header/footer
   backgrounds and browser-default dialog focus outline to escape the intended
   rounded presentation.
5. The running actions menu had offsets but no explicit `position: absolute`,
   so its placement could resolve beside More and protrude beyond the workspace.
6. Date/time inputs inherited generic bordered control styling. PR #108 styled
   the closed controls, but the opened browser-native picker remained outside
   Dayframe's styling control.

## Implementation

- One `TASK_SUGGESTION_LIMIT` of five is used by timer and manual filtering.
  PR #108 gave each result one exact shared touch-row height.
- Manual Tags uses the shared picker width and anchors below/right of the tag
  trigger on desktop; the established phone bottom-sheet rule remains.
- Add time renders the same Category trigger and `CategoryOption` rows as the
  timer, including dots, selected tint, Escape and arrow/Home/End navigation.
- Shared selectors style the closed native date/time controls; they do not
  control the browser-owned calendar/time popup.
- Manual dialog header/footer own matching top/bottom radii and the dialog
  suppresses browser-default focus outline while active controls retain focus.
- The running Delete menu is explicitly absolutely positioned below/right of
  More with a viewport-bounded maximum width.

## Motion Contract

- Trigger: Description focus, Tags, Category and More open their existing
  floating surfaces.
- Owner: each existing component remains the single state owner; CSS owns the
  established 140 ms surface presence transition.
- Entrance/update/exit: unchanged restrained opacity/four-pixel translation;
  filtered Suggestions replace rows inside a fixed five-row budget.
- Surrounding layout: every affected panel is out of flow; no dialog or timer
  geometry moves.
- Interruption: outside click/Escape closes the active surface; Category and
  More restore trigger focus.
- Async outcome: no mutation behaviour changes. Delete retains optimistic
  removal and exact failure rollback from PR #106.
- Accessibility: Reduced Motion removes translation; labelled triggers,
  listbox/menu roles, complete 44 px rows, keyboard navigation and visible
  active-control focus remain.

## Post-Merge Visual Findings

KB's authenticated review found two failures not caught before merge:

- exact 44 px Suggestion rows compressed the two-line title/metadata layout,
  causing overlap in both the persistent timer and manual entry;
- the opened native `datetime-local` picker retained browser styling and did
  not match Dayframe despite the closed field looking themed.

The follow-up branch `codex/web-popup-regression-date-time` must use content-safe
complete Suggestion rows and a Dayframe-owned calendar/time popover. Browser
evidence is mandatory before its PR opens.

## Success Criteria

- No partial final Suggestion row at any required viewport or theme.
- Manual Tags is directly beneath its icon on desktop and fully viewport-safe
  on phone.
- Add time Category is visually/behaviourally consistent with the timer picker.
- Start/Finish preserve click-to-select date/time behaviour and match Dayframe
  in Light, Dark and System, including the opened picker surface.
- The Add time silhouette is rounded with no random blue dialog outline.
- Delete running task opens below More and remains inside the page workspace.
- Focused contracts, lint, typecheck, all tests, optimized build, brand check,
  `git diff --check`, and available browser evidence pass before review.

## Rollback

Revert the focused PR. No migration, release, hosted configuration or data
rollback is required.

## Validation

### Automated

- 26 focused timer/manual-entry/popup contracts passed.
- Full lint and all workspace TypeScript checks passed.
- 766 tests passed: 245 mobile, 427 web and 94 shared.
- Optimized Next.js production build passed.
- Brand asset contract and `git diff --check` passed.
- The first full test pass found one stale contract that explicitly required
  six Suggestions; it was updated to protect the new shared five-row limit and
  the complete suite then passed.

### Browser

The Codex in-app browser runtime was not exposed in this session. The managed
browser also rejected navigation to both loopback and LAN local-development
URLs by policy. This limitation is recorded rather than treating source tests
as visual evidence. Vercel Preview review remains required before merge.

### Follow-up evidence

The follow-up branch was reviewed against an optimized local production build
with seeded current-schema data:

- manual Suggestions passed at 1440x900 Light, 1280x720 Dark, 390x844 Dark and
  720x450 compact-height/200%-zoom equivalent;
- every rendered suggestion row was 56 px with `scrollHeight` 56 px, no row
  overlap, no partial row and no viewport escape;
- the Dayframe-owned date/time surface passed the same four viewports with no
  native `datetime-local` control and with the complete calendar, hour/minute
  selectors and Done action inside the viewport;
- timer Suggestions passed desktop, compact-height and phone geometry checks;
- focused contracts, 766 tests, all workspace typechecks, lint, optimized
  production build, brand asset contract and `git diff --check` passed.

The connected managed browser remained policy-blocked for local addresses, so
the matrix used local Chromium automation against the rendered optimized app.
