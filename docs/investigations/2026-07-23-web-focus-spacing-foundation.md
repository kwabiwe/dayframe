# Web Focus, Spacing And Control Foundation

Date: 2026-07-23

Branch: `codex/web-focus-spacing-foundation`

Draft PR: [#100](https://github.com/kwabiwe/dayframe/pull/100)

Baseline: `origin/main` at `85e513a49524238a73cee965c3e191d76112fadb` (merged PR #99)

## Scope

This is the shared foundation PR requested by the second web review. It is limited to focus ownership, shared field/control geometry, route-level spacing/text containment, and platform-neutral Search shortcut copy.

It does not redesign the timer, change Timeline/Calendar architecture, change Reports expansion behaviour, add grouped lists, broaden Search into global historical search, touch mobile, change an API contract, add a migration, deploy, or merge.

## Reproduction

The optimized PR #99 production build reproduced the supplied review evidence:

- ordinary bordered inputs kept their one-pixel grey boundary and added a two-pixel blue outline with a two-pixel offset;
- the password input focused the inner input while its reveal action sat inside a separate visual wrapper;
- the task/tag editor outlined only the nested input instead of the full compound control;
- place search already used `focus-within`, but stacked the new external outline outside its existing border;
- Reports field-like summaries and description search used the same external-ring rule;
- the sidebar advertised only `⌘K`, although the key handler already accepted both Control-K and Command-K;
- the Dashboard Day/Week segmented actions were 40 px high while the shared ordinary target is 44 px.

The root cause was the broad `input:focus-visible`, `select:focus-visible` and `textarea:focus-visible` selector combined with separate route-owned borders and late component overrides. Compound controls did not share a single reusable owner.

## Before And After Evidence

Before the change, the reproduced login and Reports fields showed a grey control border plus a separate blue outline and offset. The task description highlighted only the nested input portion of a wider task/tag control, and place search stacked its `focus-within` outline outside the existing border.

After the change, measured focused fields had one two-pixel blue perimeter and no outline. The password, task and place wrappers retained their 44 px, 56 px and 48 px outer heights. The Reports multi-select initially measured four pixels taller when its reserved border was added; its existing vertical padding was reduced by the same amount and the second build restored the 54 px baseline.

Screenshots and rendered PDF pages were used as local QA evidence, visually inspected, and then moved to Trash. They were not staged because generated review artifacts do not belong in the repository.

## Implemented Contract

### Focus ownership

| Surface | Focus owner | Nested control treatment |
| --- | --- | --- |
| Text, date, time, number, select and textarea fields | The field's reserved two-pixel border | No offset outline; invalid focus keeps an internal danger cue |
| Password field | `.auth-password-field:focus-within` | Input border/outline removed; reveal action keeps an inset focus ring |
| Task description/tag field | `.inline-tag-input-anchor:focus-within` | Input fills the wrapper without its own perimeter; tag action remains keyboard-visible |
| Tag picker search | `.inline-tag-picker-search:focus-within` | Nested search input has no competing perimeter |
| Place autocomplete | `.place-search-control:focus-within` | Nested combobox input has no competing perimeter |
| Reports multi-select trigger | The summary's reserved transparent two-pixel border | No external field halo |
| Search palette | Its existing bottom divider changes colour in place | Search input outline remains suppressed |
| Buttons, links, icon actions and ordinary disclosures | The existing two-pixel offset ring | Selected fill, disabled opacity and destructive colour remain independent |

All reserved borders use border-box geometry or compensate their existing padding/min-height, so focus changes colour without changing layout.

### Shared geometry

The existing fill-led web token block now owns the ordinary control height, compact height, inline padding, border width, focus border, icon target, field gap, small/medium/large layout gaps, panel padding, dialog inline padding and table-cell padding. Existing primitives, dashboard segmented controls, Reports panels/tables and dialog chrome consume those tokens. This extends the current system rather than creating a second primitive layer.

The broad external field-focus selector was split at its original definition rather than shadowed by a new override block. Existing `.ui-control`, `.industrial-field`, Reports, place-search, timer-category and inline-tag rules were edited at their owning locations. The previous place-search external outline was removed, Reports padding was compensated for its reserved border, segmented-control overflow was made focus-safe, and the Dashboard Day/Week control now consumes the shared 44 px height. Dialog header/action gaps and padding, Reports panel/table padding, Settings text wrapping and action containment now reuse the shared values.

### Shortcut safety

The visible and Help copy now use `Ctrl/⌘ K`. The handler is factored into an executable helper that accepts either modifier. The existing typing-target guard remains ahead of Search, `?`, `N`, Shift-Space and date navigation, so letter shortcuts do not fire while the user is typing.

## Motion Contract

No navigation, presentation, gesture, reflow, Undo, feedback or timed motion behaviour changed. Existing 140 ms colour transitions remain owned by the focused control. Reduce Motion continues to collapse those transitions through the global reduced-motion rule without hiding the final focus state.

## Visual Pass One

The optimized branch build was inspected in the real browser:

- light desktop: Dashboard, Calendar, List, Timesheet, Categories, Tags, Reports, Places, new Place, Review and Settings;
- dark phone at 390 × 844: the same route matrix;
- login password, task/tag input, place autocomplete, Reports selector, Search palette, selected segmented control, mobile Search/Help/Profile dialogs, and synthetic long Reports filter text;
- both Control-K and Command-K opened Search and moved focus to the search input;
- every audited route had zero document-level horizontal overflow and no Next.js runtime overlay;
- all ordinary audited form/action controls met the 44 px minimum. Calendar's existing 12 px resize-edge handles remain deferred to the dedicated Calendar interaction work because changing their gesture geometry is outside this PR.

Measured compound controls retained their previous outer heights: password 44 px, task 56 px and place search 48 px. Their nested inputs had no border/outline while the wrapper had one two-pixel focus-colour perimeter.

## Visual Pass Two

The compensated Reports selector was rebuilt and remeasured at 54 px, matching the reproduced baseline height. Its two-pixel focus border changes colour in place with no outline or document overflow. The Reports description search remained 44 px with the same single-perimeter treatment.

The complete route matrix was repeated at 390 × 844 in the light theme. Every audited route again had zero document-level horizontal overflow, no runtime overlay and no undersized ordinary control after excluding the intentionally deferred Calendar resize edges. The phone manual-entry dialog stayed at 12 px viewport margins, its compound description wrapper remained 44 px, and its focus indicator was fully visible without clipping.

## Files Changed

- `apps/web/src/app/globals.css`: shared tokens, focus ownership, control geometry, padding and text containment.
- `apps/web/src/components/AppShell.tsx` and `apps/web/src/lib/keyboard-shortcuts.ts`: shared platform-neutral Search shortcut copy and executable modifier detection.
- `apps/web/src/components/AuthForm.tsx`, `InlineTagInput.tsx` and `PlaceSearchCombobox.tsx`: compound wrapper ownership.
- `apps/web/src/components/ui/Primitives.contract.test.ts`, `focusSpacing.contract.test.ts` and `keyboard-shortcuts.test.ts`: focused contracts and executable shortcut cases.
- `docs/brand-style-guide.md`, `docs/dayframe-regression-checklist.md`, `docs/feature-fix-tracker.md`, `.codex/reference/style.md` and `.codex/reference/components.md`: durable focus/geometry guardrails and current evidence.

## Padding And Alignment Audit

- Shared ordinary fields and icon actions align to a 44 px minimum.
- Dashboard Day/Week moved from 40 px to the shared 44 px target.
- Password, task, place and Reports compound/field-like controls retain their reproduced outer geometry when focused.
- Dialog headers/actions reuse the same small, medium and large gaps and inline padding.
- Reports range/filter panels, analysis panels and data-table cells consume the shared panel/table padding.
- Settings labels/details can wrap unbroken text without forcing action columns or the document wider.
- Synthetic long Reports filter copy remained contained at 390 px with zero page overflow.

## Database, API And Mobile Impact

No database or Supabase migration is required. No query, session, route-handler, API schema, shared package or mobile source changed. Existing web/mobile timer, bootstrap, time-entry, event and bearer-session contracts are unchanged.

## Validation

Completed:

- focused focus/shortcut contracts: 10 tests passed;
- `npm run lint`;
- `npm run typecheck`;
- `npm run test`: 690 tests passed across mobile (237), web (359) and shared (94);
- `npm run build`;
- `npm run check:brand-assets`;
- `git diff --check`.

The supplied PDF was rendered and inspected locally. Generated review renders and browser screenshots remain local QA artifacts and are not part of the change set.

## Limitations And Manual Checks Before Merge

- Local optimized-build browser QA is not hosted Vercel Preview evidence, a screen-reader audit, or a second browser-engine check.
- Vercel started automatically after the draft PR opened; its pending result was observed but no hosted deployment action was taken.
- Before merge, review PR #100's final checks, then keyboard-tab through Login/Signup, the shell timer, manual entry, Reports filters, Places search, Categories, Tags and Settings in current Chrome plus Safari/WebKit.
- In both themes, confirm focused fields have one perimeter, standalone actions retain one unclipped ring, selected/error/disabled states remain distinct, long labels do not overflow, and Search opens with both Control-K and Command-K but not while typing.
- Recheck Search, Help and Profile dialogs at a phone width, including close controls, internal scrolling, Settings and logout reachability.

## Rollback

There is no data rollback. Before merge, close the draft PR or revert its commits. After merge, revert the PR normally; the focus, token and documentation changes are self-contained and require no migration reversal, feature flag, cache flush or mobile release.

## Deferred Review Findings

- Dedicated timer composition, control balancing and later timer-specific geometry.
- Timeline/Calendar block layout, resize-handle hit geometry and architecture.
- Reports in-flow expansion/popover redesign.
- Timeline grouped-list work.
- Global historical Search.
- Any mobile, schema, migration, hosted rollout or production deployment work.
