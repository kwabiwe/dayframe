# Reports Revision 2 implementation evidence

Revision 2 supersedes the Revision 1 design and acceptance evidence for PR #194.
Starting head: `09e7e2012ea440dc9b0847e4edf45f4b2135079c`; fetched main:
`439601c64880fe7bc4bc4618920149b0ce85e341`. Worktree initially clean.

## Scope and decisions before implementation

- Preserve the extracted Reports tab, stable donut identity and authenticated
  Dashboard projection. No timer, Review, Health, Location or sync ownership changes.
- Replace the R1 summary cards, coverage calculations, Pie/Bars switch and fixed
  week chart. Reports totals count concurrent confirmed entries independently.
- A bounded, personal authenticated aggregate read serves every range. Bootstrap
  remains bounded and is not a year-history transport. Reports-only R1 coverage
  metadata is removed. No schema, native dependency or durable cache is required.
- The aggregate includes a minimal active-entry contribution (identity, category,
  start and bucket seconds), enabling Reports to replace that contribution with
  the existing projected timer without introducing a timer owner or polling loop.
- Exact-range results live only in the mounted account-keyed Reports owner.
  An uncached failed read never borrows a different range's totals.
- Current canonical staging identity is `com.layereight.dayframe.staging`, not the
  obsolete shared-identity wording in earlier instructions. Older merge-first
  release checklist wording does not override pre-merge signed staging acceptance.

## Motion contract

The existing Reports owner consumes first populated foreground/focused entrance
once. Donut slices own numeric arc interpolation and selected opacity; the centre
owns its short opacity reveal. Stable category IDs survive filters and ticks.
Rows own local layout changes; no global LayoutAnimation or screen remount.
Each bucket owns current-to-next height. Tooltip presence is local opacity, one
latest selected bucket, dismissed on filter/range/outside press. Modal owns picker
entrance/exit, with immediate selected-day fills. Cancel preserves the committed
range/filter. Requests are abortable and generation/session checked; old results
cannot replace a new range or account. Reduce Motion settles geometry immediately
and disables nonessential entrance/reflow. Background/unfocus settles the chart.

## Validation

Implementation and validation are in progress. Physical iPhone acceptance,
signed staging identity/API checks, final-head independent review and staging
browser checks are NOT RUN for Revision 2. Revision 1 results are not R2 evidence.
