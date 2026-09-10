# Reports Revision 3 implementation evidence

V3 supersedes V1/V2 presentation on existing PR #194 only. Starting main:
`439601c64880fe7bc4bc4618920149b0ce85e341`; PR/head:
`11fb899de88458a98b541dc90e0efafdf2d3f09c`. Fetched both; worktree clean.

## Evidence and hypotheses before changes

The owner's attached private image shows clipped headings, controls and STAGING
badge, plus old summary cards and `Total logged`. That is older presentation than
the inspected V2 source. Do not commit the personal image or infer its SHA.
The paired iPhone 17 Pro is reachable and has `com.layereight.dayframe.staging`
0.1.0 (1). That reused build number does not attest source/API. Mirroring initially
requires the owner to unlock the Mac login. Exact installed-source reproduction
and physical cause remain unproved until the runtime can be inspected.

Hypotheses: (1) old binary/different text implementation, verified by runtime
identity and same-head comparison; (2) effective glyph metrics exceed measured
Text/parent boxes, verified by native layout at normal/MAX text. The installed
repository RN is 0.85.3; its RCTTextAttributes scales explicit line height with
effectiveFontSizeMultiplier, so static line-height inspection alone cannot prove
the physical cause. Existing V2 stacked rows/wrapping numbers and unbounded
duplicate Total independently conflict with V3 and will be removed.

## Scope and motion contract

Retain aggregate schema/SQL/API, eight-range mounted cache, captured session and
request generations, coalescing, exact active-ID replacement and Dashboard clock.
No timer, Review, Health, Location or sync ownership change; no dependency/schema.
The one popup calendar consumer is FloatingDatePicker in ActiveTimerEditSheet
(running, stopped and Add Time modes); preserve date callback/time-of-day handling.
Reports gains a separate draft/Done owner using the shared 42-cell presentation.

Local caps: headings 1.5; controls/actions 1.3; names 1.35; numeric/centre/badge/axis
1.2; calendar 1.25. Explanatory copy retains system scaling. Category rows never
stack: name-only ellipsis, reserved numeric columns and a bounded readable numeric
size. This is an owner-approved density trade-off, not full enlargement compliance.

Motion: existing modal owns sheet entrance/exit; shared calendar owns same-frame
month fade; donut owns previous/current visual IDs and interruptible arc updates,
with generation-scoped cleanup and outgoing interaction disabled immediately.
Rows own presence/reflow; removal returns accessibility focus to the filter.
Activity owns fitted height/axis and one positioned tooltip, replaced by key but
not remounted on timer ticks. Plot-level taps partition slots; adjustable and
44-point Previous/Next provide precise alternatives. No expanded invisible targets.
Blur/background settle current desired visuals; Reduce Motion removes travel and
sweep while preserving all state and focus. Cancel discards only presentation
drafts; async request failures retain exact-range truth without changing owners.

## Validation plan / current evidence

Run focused Reports/donut/picker suites, retained client/shared/endpoint SQL tests
using disposable localhost PostgreSQL, UTC/London tests, full lint/typecheck/test/
build/docs/brand/iOS-config, Review/Location SQLite and native storage checks.
Then clean Simulator and signed staging builds, exact Preview/alias and physical
width/MAX text/Bold Text/VoiceOver/motion/timer/shared-picker matrix. Record exact
results and identities here/PR. No physical PASS inferred from mock renderers.
Independent Claude via OpenClaw must read V3 and review the final frozen whole diff.
Stages B–D and automatic merge remain prohibited.

### First physical baseline and V3 build checkpoint

On 10 September at approximately 18:05 BST, Mirroring reached the iPhone 17 Pro.
The installed isolated staging 0.1.0 (1) showed the V2 preset-row surface. At
maximum accessibility text, Reports headings/pills and the staging badge cropped
into fragments; category names enlarged and the duplicate total expanded below
the donut. This reproduces the failure class on an identified bundle/build, but
does not identify its source SHA or prove a particular native measurement cause.
No original-image SHA is asserted. No screenshots or user records are committed.

The owner reclaimed iPhone 17. Larger Accessibility Sizes was switched off, but
Mirroring slider restoration was unreliable; the owner was told explicitly to
restore their preferred notch. Mirroring was quit. All subsequent native builds
and physical checks target the owner's connected iPhone 11 instead.

First V3 checkpoint: PASS mobile typecheck; PASS focused Reports/donut/picker
selection (9 files, 80 tests). New pure contracts include clock durations through
100000 hours, numeric reservation at 320/375/390/430 widths and maximum scaling,
42-cell bands, draft invalid-range rendering, fitted slot mapping and generation
cleanup. These are not physical layout or animation evidence. Full repository,
new native binary and independent review are still NOT RUN at this checkpoint.
Canonical documentation updates remain part of the unfinished V3 implementation.
