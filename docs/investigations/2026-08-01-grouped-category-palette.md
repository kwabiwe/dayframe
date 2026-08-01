# Grouped category palette

## Report

The 30 category shades were available on web and iOS, but their visual layout
did not consistently preserve the intended hue families. Web forced six
columns and iOS allowed the flex container width to decide its column count,
so related light, medium and dark shades could appear separated.

## Constraints

- Preserve every stable palette key and HEX value.
- Preserve all existing category assignments and legacy HEX resolution.
- Preserve deterministic fallback assignments for unknown or legacy values.
- Use the same presentation order everywhere on web and iOS.
- Arrange shade families light-to-dark without changing category/chart colour
  semantics.

## Fix

- Keep `DAYFRAME_PALETTE` in its established deterministic fallback order.
- Add a separate shared picker presentation sequence containing every palette
  key exactly once.
- Render both pickers in five columns. This produces two blocks of five hue
  families, with three shades running light-to-dark down each column.
- Keep category creation's automatic unused-colour selection on the existing
  deterministic palette, so this visual-only change cannot rewrite behaviour
  or stored data.

## Validation

- Shared tests assert the exact picker matrix, completeness and absence of
  duplicates while retaining the established fallback-order test.
- Web and mobile contract tests assert that both category pickers consume the
  shared presentation sequence; the web test also locks the five-column grid.
- Focused shared/web/mobile tests passed: 3 files, 20 tests.
- Repository lint and all workspace typechecks passed.
- All 1,016 automated tests passed: 313 mobile, 566 web and 137 shared.
- The optimized Next.js production build, brand-asset contract and
  diff/whitespace checks passed.
- A clean iOS simulator build passed on iPhone 17e / iOS 26.5 with dependency
  warnings only. The first attempt referenced a removed simulator UUID and was
  rerun against the current installed destination.
- Rendered web and iOS verification remains required in Light/Dark, narrow
  widths, Dynamic Type and VoiceOver. The in-app browser validation surface was
  unavailable in this session, so no manual visual check is marked passed. A
  new TestFlight build is required after merge because the mobile picker code
  changes.
