# Web Calendar Compact Editor

Date: 2026-08-02
Status: Draft PR [#155](https://github.com/kwabiwe/dayframe/pull/155), unmerged
Baseline: `a669102` (`origin/main`, including PR #152's Calendar block visual system and PR #154's staging-first workflow)

## Problem

The web Calendar's single-click selection still opened an in-flow bottom action card. That card was visually detached from the selected time block, exposed a redundant Edit action instead of the common lightweight fields, and could not meet the required fragment-specific placement, mobile overlay, discard, timestamp-fidelity or active-timer mutation contracts.

Older Calendar notes also described a persistent selection outline and selection/focus-visible inline Play. PR #152 superseded those details with fill-led selection, keyboard-only focus and pointer-hover inline Play. This change preserves PR #152, keeps inline Play visually quiet until pointer hover or keyboard focus, and replaces only the bottom card.

## Implemented Contract

- One fixed `document.body` portal is anchored to the exact selected `entryId:dayKey` block fragment.
- Single click/tap opens without moving focus; Space opens and focuses Description; Enter and double click retain `EditTimeEntryDialog`.
- Editable fields are Description, Category, Start and completed-entry Finish. Duration/Elapsed is read-only; compact overlap copy and cross-date context are derived from the draft. Field focus uses the neutral control-border treatment and the Description placeholder is `Enter task description`; the redundant original-date footer sentence is absent.
- Icon-only actions are Start again for completed entries, Delete and Close. Save remains a coral text action. Every action keeps a 44px target and an accessible name.
- Close and editor-level Escape remain explicit discard actions; Close/Escape restore block focus and Category owns the first Escape. A clean outside pointer dismisses. If any exact draft value changed, the outside pointer and its following click are blocked and the stable footer asks `Discard unsaved changes?`: Go back or Escape restores the exact prior field focus and draft, while Discard exits without saving. This guard also prevents a navigation or another block selection from leaking through the decision.
- Completed saves send only changed compact-owned keys. Untouched timestamps retain their stored seconds; edited times normalize to `:00` while retaining the timestamp's original local date, including separate Start/Finish dates across midnight. No-change Save sends no request.
- Running saves use the `AppShellRuntime` mutation gate. The optimistic bootstrap projection and persistent timer draft receive the same values together, hidden tags/place/legacy metadata is preserved, one partial PATCH and one forced refresh reconcile authoritative `updatedAt`, and failure restores the exact data and draft snapshots.
- Placement prefers 8px below, flips above, clamps to 12px, and becomes a bounded 12px-gutter phone card. Resize observers, a DOM-removal observer, scroll/resize/visual-viewport listeners and the Calendar zoom key drive measurement. `top` and `left` never animate.
- Entrance is 140ms opacity plus at most 4px translation; exit is 90ms. The editor alone owns the discard transition: the normal and confirmation footer layers share one grid cell and crossfade over 120ms without changing editor or Calendar geometry; Go back/Escape reverses that state and Discard hands off to the existing 90ms exit. A close token prevents stale completion, busy saves block dismissal, and Reduce Motion removes spatial movement and reduces the footer opacity transition to 1ms.

## Automated Coverage

Focused coverage lives in:

- `apps/web/src/lib/calendar-entry-compact-editor.test.ts`
- `apps/web/src/lib/timer-runtime.test.ts`
- `apps/web/src/components/calendarEntryActions.contract.test.ts`
- `apps/web/src/components/focusSpacing.contract.test.ts`
- `apps/web/src/components/inlineTagInput.contract.test.ts`
- `apps/web/src/components/calendarReadabilityRestart.contract.test.ts`

It covers initial/no-op drafts, exact draft-change detection, clear-to-null, owned payload keys, seconds preservation/normalisation, cross-midnight dates, invalid/future/reversed input, running elapsed time, below/above/phone/clamped placement, viewport visibility, outside-path classification, the discard decision/focus contract, shared selected-tag markup and CSS, gated active optimistic projection, one request/refresh, hidden metadata, authoritative version application and exact rollback.

## Local Browser Evidence

Disposable database: `dayframe_calendar_editor_qa_test` on local Postgres only. No hosted or production data was used.

Observed PASS so far:

- completed pointer open without input focus;
- Close discard and reopen from canonical values;
- no-change Save closed with no PATCH in the local server log;
- completed Description + Start save emitted one partial PATCH, normalized edited seconds to zero, retained untouched Finish, and preserved the existing place and tag relation;
- running Description + Category save updated the Calendar block and persistent timer together, retained tag/place metadata, and produced exactly one PATCH plus one `/api/bootstrap` refresh;
- Space opened and transferred focus to Description; Escape closed and restored exact block focus; Enter opened the advanced editor;
- double click opened the advanced editor;
- directly selecting another visible block replaced and discarded the prior draft;
- closing one editor and immediately reopening the same or another block left the newer editor mounted after the prior 90ms exit window, proving stale exit work is cancelled and parent dismissal is session-scoped;
- completed, running, long-description, overlap, tiny and cross-midnight continuation editors rendered; cross-midnight date context showed separate dates;
- desktop above-anchor placement held an 8px gap; 1440x900, 1280x720, 1024x768 and 768x900 had no page overflow; 390x844 and the 640x720 zoom equivalent used `left: 12px`, `right: 12px`, stayed within the viewport and bounded the Category list internally;
- Light and Dark editor surfaces were legible, with no browser console/runtime warnings;
- existing future-dated rows remained valid no-op drafts, while an edited invalid `25:00` value retained the exact draft and inline error;
- Delete reached the shared five-second notice and Undo restored the exact tiny fixture;
- Start again ignored an unsaved compact Description and restarted from the canonical persisted Description through the shell timer owner.
- Follow-up browser validation confirmed the neutral compact field focus, `Enter task description` placeholder, removed footer copy, clean outside dismissal, changed-draft decision, blocked underlying Timeline navigation, exact Go back/Escape draft-and-field-focus restoration, and Discard closure. The decision stayed inside a 390x844 viewport with 12px side gutters and produced no page overflow.
- Edit time block and the persistent timer both rendered the shared selected tag as plain `#manual` text with a thin `X`, transparent default fill and `6px` radius; clicking the tag removed it. The persistent-timer add/remove check ran only against the disposable local database and the tag was removed again. No browser console/runtime errors were present.

### Visual-consistency follow-up

- Root cause: the persistent timer's more-specific `.swiss-timer-description-control .ui-compound-control:focus-within` selector still resolved to `--web-focus-border` after the compact editor had been neutralised. The shared tag button itself owned the 32px visual box at weight `750`, so its hover fill could not be shorter than its interaction target. The footer grid track was intrinsic-width, leaving the default action layer at `284.94px` inside a `334px` inset, and the confirmation actions inherited 10.5px text plus danger fill.
- Focus root cause and durable rule: the shared `focus` semantic still resolved to bright blue in both themes, so every global standalone focus selector—and a more-specific Calendar navigation selector that used `accent` directly—could reintroduce blue after local field overrides. The shared `focus` token now matches neutral `controlBorder` in web CSS and shared theme data; fields, buttons, links, Calendar blocks, header icons, options and compound controls all consume that single reusable focus semantic. Selected/active accent remains separate, and invalid focused fields retain an inset danger cue. Contract coverage scans focus selectors and fails on blue `info`/accent focus values.
- Selected tags: each removable button is 44px high with a separate 24px-high `inline-selected-tag-visual` at weight `400`. Only that inner rectangle receives the accent hover fill; keyboard focus uses the neutral inset indicator without borrowing the hover accent. The hidden measure reuses the same label-plus-thin-X wrapper; the `+N` wrapper uses the neutral muted treatment. Browser checks on the preceding visual-consistency head covered one, several, long/hidden and `+1` states in the persistent timer and full Edit time block; the temporary local timer tag was removed again.
- Feedback geometry: one `--calendar-compact-horizontal-inset` owns fields and one fixed-height footer. Normal actions, validation/server error, overlap information and discard confirmation switch in the same grid cell with priority `discard > error > overlap > normal`; Save remains reachable for overlap and retry states. At <=350px every state uses the same reserved two-row geometry, and long overlap copy wraps or scrolls only inside its message track without resizing the editor.
- Motion contract remains one editor owner: validation, overlap and outside-pointer discard state are triggers; the fixed footer layers crossfade without changing the editor, fields or Calendar geometry; Go back/Escape reverse discard and restore field focus; Discard hands off to the existing 90ms exit; rapid replacement remains token-gated; mutation success/failure/rollback ownership is unchanged; only the active message mounts alert/live semantics; Reduce Motion keeps the state change and reduces opacity transition to 1ms. Height, top and left never animate.
- Finish validation root cause and fix: the route validator returned without comparing a `stoppedAt`-only PATCH because `startedAt` was absent, while persistence updated the row without resolving the stored opposite timestamp. The transaction now locks and reads the scoped entry, resolves supplied and stored Start/Finish values, rejects future Finish and non-positive windows, and then writes. Client and route validation still fail early; cross-midnight original-date anchoring remains unchanged.
- Standalone restart root cause and fix: the inline Calendar Play path discarded unsuccessful `startEntryAgain` outcomes after its former `actionError` rendering was removed. Inline restart now clears stale feedback, preserves the existing busy/mutation gate, clears the duplicate shell timer error after an owned failure, and surfaces failure through the established fixed assertive feedback region without moving Calendar layout. The visually quiet action remains pointer-hoverable and is now also keyboard-focusable with the same neutral focus treatment.
- Rendered desktop measurement at 1440x900: Description, Category and Duration right edges `691px`; Save right edge `691px`; Save/Go back/Discard `44px`; selected Calendar/List/Timesheet segment button remains the pre-existing compact-desktop `38px` while the compact editor intentionally keeps the requested 44px touch action. At 390x844 the selected segment and Save are both `44px`, and field/Duration/Save right edges are all `367px`.
- The current review follow-up's rendered tokens resolve focus to neutral `rgb(100, 113, 138)` in Dark and `rgb(125, 135, 151)` in Light across Description, Category, Start, Finish, Save, Go back, Discard, header actions, category options and the standalone restart action. Selected/coral fills remain distinct, while invalid focused time fields retain a separate red inset danger cue.
- The earlier `bf0e991` visual-consistency head passed explicit Light, explicit Dark and System-resolved Dark at 1440x900, 1024x768, 390x844, 640x720 and 320x700, covering desktop/phone compact Save alignment, overlap-expanded content, stable dirty-decision height, one-row 390px and reserved two-row 320px footer, horizontal overflow and console/runtime warnings. This is retained only as preceding evidence, not claimed as rendered validation of the current review-fix head.
- Current-head untracked QA captures: `.codex/qa/pr155-review-followup/dark-1440-overlap-focus.png`, `light-1440-invalid-focus.png`, `light-1024-invalid.png`, `dark-1024-overlap.png`, `dark-390-overlap.png`, `light-390-discard.png`, `light-320-discard-two-row.png`, `light-320-long-overlap.png`, `dark-320-invalid-two-row.png`, and `dark-1440-inline-restart-failure.png`.

## Review Follow-up Validation

- PASS: focused review contracts (123 web tests and 10 shared theme tests), including neutral focus scanning, fixed feedback geometry, invalid-focus danger cue, client/API partial timestamp validation and visible standalone restart failure.
- PASS: `npm run lint`; all-workspace `npm run typecheck`; `npm run test` with 1,054 tests (314 mobile, 602 web, 138 shared); optimized `npm run build` with 32 static pages; `npm run check:brand-assets`; and `git diff --check`.
- PASS: rendered Light/Dark current-head matrix at 1440x900, 1024x768, 390x844 and 320x700. At 1440px, overlap, validation and discard all retained a `374.0625px` editor and `72px` footer; at 390px the editor/footer remained `380.390625px`/`72px`; at 320px overlap, validation and discard retained the stable two-row `412.390625px`/`104px` geometry. No state changed the editor's x/y position, fields, Calendar or document width.
- PASS: the deliberately long overlap description at 320px remained inside a `32px` internally scrolling message track (`57px` scroll height) with zero document overflow. The fixed assertive standalone restart failure left both the `157.546875px` timer panel and the `645.453125px` Calendar workspace exactly unchanged before/after; no duplicate shell error rendered.
- PASS: the clean optimized-build Calendar load had no console warnings/errors or runtime overlay. Reduce Motion ownership remains covered by the CSS/contract check; no height, top or left transition was introduced.
- Pending at this point in the repository record: exact-head staging-backed Preview deployment and stable staging alias promotion. Final deployment identifiers and verification belong on draft PR #155 after the commit exists.
- Authenticated staging Calendar parity and preview-profile physical-iPhone validation remain separate evidence. Keep the PR draft and unmerged.

## Hosted Preview Evidence

- Draft PR #155 was opened from `codex/web-calendar-compact-editor` without merging.
- Code commit `672064e` deployed as Vercel Preview `dpl_J4SK7amPr8RgNEbjeHqaKytCXQfm`; Vercel reported target `preview` and status `Ready`.
- Follow-up commit `d865fec` deployed as exact branch Preview `dpl_HpNerqmW1qDYuJ1rN4PDts87iDxB` (`https://dayframe-c2kedc6wk-dayframeworkshop.vercel.app`); the GitHub Vercel check and direct Vercel inspection both reported target `preview` and status `Ready`.
- `dayframe-staging.vercel.app` was explicitly reassigned to that follow-up Ready Preview. A separate inspection still resolved `dayframe-web.vercel.app` to its pre-existing Ready production deployment `dpl_ALXRvmHJUSvmfHLxRARgPsG5HpBM`; production was not changed.
- The exact branch Preview and stable staging `/login` routes rendered the Dayframe provider login surface with no browser runtime errors. No staging credentials were available in this environment, so authenticated Calendar parity, staging workspace identity/badge confirmation and data mutations were not claimed.
- The in-app browser blocked direct navigation to the anonymous `/api/bootstrap` endpoint with `ERR_BLOCKED_BY_CLIENT`; its expected hosted `401` response was therefore not re-claimed for this PR.
