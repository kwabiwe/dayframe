# Web Focus, Spacing And Control Foundation

Date: 2026-07-23

Branch: `codex/web-focus-spacing-foundation`

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

## Deferred Review Findings

- Dedicated timer composition, control balancing and later timer-specific geometry.
- Timeline/Calendar block layout, resize-handle hit geometry and architecture.
- Reports in-flow expansion/popover redesign.
- Timeline grouped-list work.
- Global historical Search.
- Any mobile, schema, migration, hosted rollout or production deployment work.
