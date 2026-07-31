# Web Timeline header density follow-up

Date: 2026-07-31
Status: implemented and validated
Scope: Web Timeline Calendar and List sticky headers

## Inputs and preflight

- Reviewed the annotated follow-up PDF and its two screenshots in full.
- Fast-forwarded local `main` to `origin/main` at `745b24f` before creating `codex/web-timeline-header-density-followup`.
- Read the required PRD, tracker, regression, brand, debugging, component, style, validation, release, and motion references before changing application code.
- Confirmed the unified Timeline workspace implementation from PR #145 is present on `main`.

## Evidence and root-cause hypotheses

### Calendar heading

The Calendar corner still renders a separate visible `Time` label beneath the 44px zoom controls, and the follow-up stylesheet raises both sticky header cells to a 66px minimum height. The day heading also renders the logged duration on a second line with the word `logged`. These three choices account for the excess grey heading height shown in the supplied screenshot.

### List sticky seam

The column header cells use content-driven height with `10px 12px` padding, while the sticky day heading is independently pinned at `top: 43px`. The primary cause was that the fixed offset was taller than the rendered column heading, exposing scrolling table content between the two opaque surfaces. A secondary risk was a subpixel/table-painting seam between separately sticky table row groups. Browser validation confirmed the mismatch and the final implementation uses one explicit shared height plus a semantic divider seam.

## Motion contract

- Trigger and owner: unchanged; the existing per-view scroller remains the only scroll/sticky-position owner.
- Entrance, update, exit, surrounding layout, interruption, and async rollback: not applicable because this is a static header geometry and paint-order correction with no new state transition or animation.
- Accessibility: zoom controls retain their 44px targets and accessible labels. The visible Calendar total becomes compact while retaining an explicit accessible `logged` label. Reduce Motion behavior is unchanged because no motion is added.

## Intended validation

- Protect the compact Calendar markup and shared List sticky offset with a focused contract test.
- Run the focused web Timeline tests, web typecheck, and the repository-wide lint/typecheck/test/build/brand checks.
- Browser-check Calendar and List at desktop and phone widths in light and dark appearance, including scrolling, sticky opacity, zoom controls, no horizontal document overflow, and no runtime overlay.

## Browser evidence

- Validated the real local app at 1440x900 and 390x844 in both Midnight Core dark and its light companion.
- Calendar corner and day headings measured 53px including their divider. Both zoom controls remained 44x44, the visible `Time` label was absent, and each duration sat inline with its date. Day and Week headings remained readable; the Week grid retained its internal horizontal scroller without creating document overflow.
- After 180px of vertical Calendar scrolling at phone width, the corner and day headings stayed pinned to the same y-coordinate with opaque semantic backgrounds.
- List column headings measured 40px. The sticky day heading began exactly at the column-heading bottom before scrolling and after 118px of phone-width scrolling: measured seam `0px` in both states. Scrolling entry rows painted behind the two opaque heading layers without visible text bleed-through.
- At both widths `documentElement.scrollWidth === window.innerWidth`. The intended Calendar/List scrollers retained their own horizontal and vertical overflow where content exceeded the viewport.
- Browser console inspection returned no warnings or errors, and no runtime overlay appeared.

## Automated validation

```text
npm run lint
PASS

npm run typecheck
PASS: mobile, web, and shared TypeScript

npm run test
PASS: mobile 44 files / 311 tests; web 89 files / 548 tests; shared 8 files / 133 tests

npm run test -w @dayframe/web -- src/components/timelineRangeToolbar.contract.test.ts
PASS after final divider-colour refinement: 1 file / 8 tests

npm run build
PASS after final refinement: Next.js 16.2.9 optimized production build; 32 static pages generated

npm run check:brand-assets
PASS: Brand asset contract OK

git diff --check
PASS
```
