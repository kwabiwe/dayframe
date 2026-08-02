# Web Calendar Compact Editor

Date: 2026-08-02
Status: In progress on `codex/web-calendar-compact-editor`
Baseline: `a669102` (`origin/main`, including PR #152's Calendar block visual system and PR #154's staging-first workflow)

## Problem

The web Calendar's single-click selection still opened an in-flow bottom action card. That card was visually detached from the selected time block, exposed a redundant Edit action instead of the common lightweight fields, and could not meet the required fragment-specific placement, mobile overlay, discard, timestamp-fidelity or active-timer mutation contracts.

Older Calendar notes also described a persistent selection outline and selection/focus-visible inline Play. PR #152 superseded those details with fill-led selection, keyboard-only focus and pointer-hover-only inline Play. This change preserves PR #152 and replaces only the bottom card.

## Implemented Contract

- One fixed `document.body` portal is anchored to the exact selected `entryId:dayKey` block fragment.
- Single click/tap opens without moving focus; Space opens and focuses Description; Enter and double click retain `EditTimeEntryDialog`.
- Editable fields are Description, Category, Start and completed-entry Finish. Duration/Elapsed is read-only; compact overlap copy and cross-date context are derived from the draft.
- Icon-only actions are Start again for completed entries, Delete and Close. Save remains a coral text action. Every action keeps a 44px target and an accessible name.
- Close, Escape and outside pointerdown discard. Close/Escape restore block focus. Category owns the first Escape. Selecting another visible block replaces the draft; an empty Calendar click only dismisses.
- Completed saves send only changed compact-owned keys. Untouched timestamps retain their stored seconds; edited times normalize to `:00` while retaining the timestamp's original local date, including separate Start/Finish dates across midnight. No-change Save sends no request.
- Running saves use the `AppShellRuntime` mutation gate. The optimistic bootstrap projection and persistent timer draft receive the same values together, hidden tags/place/legacy metadata is preserved, one partial PATCH and one forced refresh reconcile authoritative `updatedAt`, and failure restores the exact data and draft snapshots.
- Placement prefers 8px below, flips above, clamps to 12px, and becomes a bounded 12px-gutter phone card. Resize observers, a DOM-removal observer, scroll/resize/visual-viewport listeners and the Calendar zoom key drive measurement. `top` and `left` never animate.
- Entrance is 140ms opacity plus at most 4px translation; exit is 90ms. A close token prevents stale completion, busy saves block dismissal, and Reduce Motion removes spatial movement.

## Automated Coverage

Focused coverage lives in:

- `apps/web/src/lib/calendar-entry-compact-editor.test.ts`
- `apps/web/src/lib/timer-runtime.test.ts`
- `apps/web/src/components/calendarEntryActions.contract.test.ts`
- `apps/web/src/components/calendarReadabilityRestart.contract.test.ts`

It covers initial/no-op drafts, clear-to-null, owned payload keys, seconds preservation/normalisation, cross-midnight dates, invalid/future/reversed input, running elapsed time, below/above/phone/clamped placement, viewport visibility, outside-path classification, gated active optimistic projection, one request/refresh, hidden metadata, authoritative version application and exact rollback.

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

## Remaining Validation

- Automated validation passed: `npm run lint`; `npm run typecheck` across mobile/web/shared; `npm run test` with 1040 tests (314 mobile, 589 web, 137 shared); `npm run check:brand-assets`; and the optimized `npm run build` with 32 static pages generated and all dynamic routes compiled.
- System-theme resolution, Reduced Motion, failure injection/rollback, scroll interruption and rapid concurrent Save checks.
- Draft PR, Vercel Preview, stable staging-alias promotion, staging browser parity and preview-profile iPhone validation. Keep the PR draft and unmerged.
