# Dayframe Brand and Style Guide

This guide defines the Midnight Core visual system for Dayframe across web and iOS, and the approved Dayframe Blocks direction that surfaces adopt as they are redesigned. It governs brand artwork, semantic colour, typography, spacing, component states, charts, motion and accessibility. Product behaviour remains defined by `docs/PRD.md`.

## Brand character

Dayframe should feel dark, calm, premium and useful. The dark theme begins with a near-black midnight navy rather than flat black. The light theme is a deliberately designed companion. Both platforms name them Midnight, Daylight and System (D1): the iPhone appearance setting, web Settings › Appearance (Midnight · Daylight · System, System the default) and the web shell toggle ("Switch to Daylight" / "Switch to Midnight"). Both modes stay compact enough for dense time data, use restrained elevation and make the next action easy to find.

The signature treatment is a vivid, unchanged six-colour symbol paired with a single-colour outlined wordmark on quiet navy or neutral surfaces. Coral identifies the primary action and live recording; it does not replace category colours or semantic success, warning and danger colours.

## Dayframe Blocks

The owner approved the Dayframe Blocks direction on 5 October 2026. Read the logo as a calendar: three columns, six blocks of different lengths, each its own colour. Blocks makes that the visual system. Entries become solid colour blocks with readable text on them, neutral midnight chrome steps back, and every action lands with the same motion and haptic.

Blocks keeps the product, data, storage keys, API contracts and the trust and privacy rules unchanged. It changes how time looks and how it feels to move it around.

Surfaces adopt Blocks one redesign phase at a time. Wherever an earlier visual rule or check conflicts with a Blocks rule (in this guide, `.codex/reference/style.md`, `.codex/reference/components.md`, `.codex/reference/motion.md`, `docs/dayframe-regression-checklist.md` or `.codex/reference/validation-matrix.md`), the earlier rule governs surfaces that have not been migrated and the Blocks rule governs migrated ones. The PR that migrates a surface updates that surface's contracts and checks. Do not mix the two treatments inside one surface.

Six decisions depart from the earlier Midnight Core rules:

| Decision | Rule | Where it is defined |
| --- | --- | --- |
| Coral means live | Coral marks recording, the single primary action on a screen and the selected tab in the iPhone tab bar (owner decision 7 October 2026: a neutral tint washed out over Liquid Glass when bright activity blocks scrolled beneath it). On the web the current page's *icon* is coral in the sidebar and the phone tab bar (owner decision 11 October 2026, matching the iPhone's coral selected tab); its label stays primary text and the sliding thumb or tab background stays neutral. Other selected navigation uses a neutral fill; durations, totals, chart marks and map pins never use coral. Text selection is never coral (UIA-314): web `::selection` is the secondary text colour behind surface-coloured text (at least 4.5:1 against the canvas and cards, and for the selected text, in both themes). The coral current-page icon uses `accentText` (5.09:1 on the selected neutral in Daylight), as the iPhone's selected tab does. One accepted exception (owner decision 11 October 2026): on idle iPhone Today the idle card's coral `Start a block` pill and the coral Play orb appear together; no other screen shows two coral primary actions. Today markers (audit UIA-013, 11 October 2026): coral may colour today's *text* (a weekday initial, a date number), never a fill or ring; today's ring, chosen dates, range bands, checks, secondary buttons and sheet Done pills are neutral (`textPrimary` fill with `background` text, or `surfaceMuted`). | Colour system |
| Colour is the data | Entries render as solid category blocks with measured text on them, using per-theme display values for the same stored keys. | Category and chart palette |
| One display face | Bricolage Grotesque for display roles only (screen and sheet titles, headline prompts, card titles, the timer and large totals; see Typography for the shipped list); the system font for everything people read or type. | Typography |
| Every action lands | Start, stop, log and delete share one landing spring with one small overshoot, one haptic each and an Undo. Migrated surfaces move the way the prototype moves (owner decision 7 October 2026): drop-ins, pops, rolling timer digits, the Stop flight into the list, row swipes, Review card throws and the Play orb bloom. The live block carries one slow breathing ring. Reduce Motion removes the springs and travel: hand-offs happen at once, Today's released row swipe or live-block pull returns in a short 120 ms timing, a released Review card resets at once, breathing rings (live block, Calendar) hold still while the running Play orb's seconds ring still advances in one-second steps, and presence changes use short opacity fades. | Motion; `.codex/reference/motion.md` |
| Activities | The interface says "activity" and "activities" where it said "category", on every surface (shipped app-wide 6 Oct 2026). Database columns, API fields, code identifiers, tests and the report CSV keep `category`. | `.codex/reference/product-model.md` |
| New layouts | Today gets a quick-start mosaic of pinned activities. Activities, Tags and Places merge into one Library page on web and Settings › Activities on iPhone. The press-and-hold Play orb with its activity bloom is approved (7 October 2026) and built on iPhone (parity step 3): it sits in the tab bar's own trailing slot, so it never covers the tabs, and VoiceOver reaches it through that native item. | The redesign phase PR for each surface |

Migrated surfaces so far: iPhone Today (Phase 2: live block, quick-start mosaic, row blocks, landings and haptics), and, through parity steps 2–10, every iPhone screen listed in `docs/feature-fix-tracker.md`. On web, the app shell (sidebar, phone top bar and tab bar; parity step 11a) is migrated and Bricolage Grotesque is bundled with the web app through `next/font/local`; the pages inside it migrate in steps 12–16. The interactive prototypes, review and phased plan live on the `agent/dayframe-redesign-concept` branch under `design/blocks/`. They are reference material, not production code.

### Prototype parity (owner decision 7 October 2026)

Every screen on iPhone and web, Settings included, is rebuilt to look and behave like the interactive prototype (`design/blocks/ios.html`, `web.html` and `onboarding.html`), one PR per screen. Each PR keeps the data, sync and Review logic and the safety rules in `AGENTS.md`, and either keeps every current function reachable or records the owner's decision to drop it. Where the prototype is silent (offline and error states, the Places editor, notification settings, editing a finished block's start), the PR designs the gap in the same language. The owner's decisions where the prototype is ambiguous or drops a function (D1–D12) and the functions kept are recorded in `docs/PRD.md` (Blocks prototype parity); delivery state is in `docs/feature-fix-tracker.md`.

## Brand assets

### Canonical and derived files

| File | Status | Use |
| --- | --- | --- |
| `logos/dayframe-colour-logo-transparent.svg` | Canonical symbol | The six-colour Dayframe mark on a transparent canvas. Do not recolour it. |
| `logos/dayframe-colour-mark.svg` | Derived artwork | The canonical symbol with its `viewBox` cropped to the blocks (`170 145 655 685`), for the header lockup: the mark then centres beside the wordmark (the full canvas has more space below and right of the blocks, so the mark sat about 1 px high and left). Nothing else differs. |
| `logos/dayframe-wordmark-outlined.svg` | Canonical wordmark | Source outline geometry with its original `#1D1E22` fill. It contains no font. |
| `logos/dayframe-wordmark-light.svg` | Derived artwork | `#F7F8FB` wordmark for dark surfaces. “Light” describes the artwork colour. |
| `logos/dayframe-wordmark-dark.svg` | Derived artwork | `#111827` wordmark for light surfaces. “Dark” describes the artwork colour. |
| `apps/mobile/assets/dayframe_app_icon.png` | Derived runtime icon | Opaque 1024 px canonical symbol on the Midnight Core `#050914` canvas for Expo/iOS generation. |
| `apps/mobile/ios/Dayframe/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png` | Native runtime mirror | Exact RGB mirror of the Expo icon; regenerated from the same canonical symbol. |

The same five SVG files under `apps/web/public/logos/` are runtime mirrors, not additional sources of truth. Regenerate or copy those files from `logos/`; never edit the public copies independently. The two iOS icon PNGs must also remain byte-identical, 1024 × 1024 and opaque RGB.

The light and dark wordmarks differ from the canonical wordmark only in the single group fill. Every path, transform, dimension, `viewBox`, proportion and transparent area must remain unchanged. Do not add a background rectangle.

### Arrangements

- **Symbol:** use alone for app icons, favicons, compact navigation and spaces where the wordmark would fall below its minimum size.
- **Wordmark:** use alone only where Dayframe is already visually established and the symbol would add clutter.
- **Horizontal lock-up:** place the symbol to the left of the wordmark, vertically centred, with an 8–12 unit gap from the spacing scale. This is the default for headers, authentication and public navigation.
- **Compact lock-up:** stack the symbol over the wordmark with an 8-unit gap when a narrow but taller brand area is available. Do not create a new combined asset.

Keep symbol and wordmark as separate component elements. Preserve the symbol’s square aspect ratio and the wordmark’s `1091:243` aspect ratio. Scale proportionally; never stretch either axis.

### Clear space and minimum size

Define `x` as one eighth of the rendered symbol width. Keep at least `x` of clear space around a symbol or lock-up, and never less than 8 px/pt in application chrome. Do not let borders, text, controls or crops enter this area.

| Artwork | Normal minimum | Notes |
| --- | ---: | --- |
| Symbol | 24 px/pt | Favicons and operating-system icon exports are exceptions designed for their platform slots. |
| Wordmark | 96 px wide | Use the symbol instead when the outline loses clarity below this size. |
| Horizontal lock-up | 24 px/pt high | Increase to 28–36 px/pt in primary headers where space allows. |

Minimums are rendering guardrails, not fixed component sizes. Respect Dynamic Type and narrow layouts by switching from a lock-up to the symbol rather than compressing artwork.

### Background and tone

- On dark Midnight Core surfaces, use the unchanged colour symbol and `dayframe-wordmark-light.svg`.
- On light surfaces, use the unchanged colour symbol and `dayframe-wordmark-dark.svg`.
- Resolve “System” to the active appearance before selecting the wordmark tone.
- The symbol’s light-grey block is intentional. If it loses definition, improve the surrounding surface or clear space; do not recolour or outline the symbol.
- App icons may place the unchanged symbol on an opaque platform-appropriate Midnight Core background. Do not include the horizontal wordmark, pre-round corners or leave iOS icon transparency.

### Accessibility treatment

A meaningful lock-up should expose one accessible name, “Dayframe”. Hide its child symbol and wordmark from assistive technology so they are not announced twice. A linked lock-up may use the destination label, such as “Dayframe dashboard”, as its single accessible name.

Decorative brand artwork must be hidden from assistive technology and use empty alternative text on the web. Do not rely on the logo to communicate status, navigation selection or an action.

### Incorrect use

Do not:

- redraw, simplify, reorder or recolour the six symbol blocks;
- recreate the wordmark as live text or approximate it with a font;
- apply filters, blend modes, strokes, shadows or gradients to manufacture variants;
- flatten the symbol and wordmark into a reusable banner image;
- stretch, skew, rotate, crop or change either asset’s proportions;
- place the artwork inside an unintended white rectangle;
- place the horizontal wordmark inside a favicon or app icon;
- edit the public runtime mirrors as if they were canonical files; or
- call a substitute typeface “Sofia Pro”.

## Colour system

Semantic tokens are the source of truth. Components should request a role such as `surfaceRaised` or `danger`, not hard-code a nearby colour. Shared TypeScript tokens and web CSS variables must remain contractually aligned.

Accessibility measurement added four role-specific companions without changing the approved identity colours: `controlBorder` for essential control boundaries, plus `accentText`, `warningText` and `dangerText` for small foreground copy. Fill, chart and icon roles continue to use the base semantic colours. The light `accentPressed` starting value was adjusted from `#D7452F` to `#E9523B`; the approved dark-on-coral content rises from 4.04:1 to 4.84:1 while the state remains visibly pressed. This is the only approved starting value adjusted in implementation.

Eight-digit HEX values below include alpha as the last two digits. RGB entries for translucent tokens use `rgba()`.

### Brand artwork colours

| Artwork role | HEX | RGB | Purpose and accessibility guidance |
| --- | --- | --- | --- |
| `wordmarkLight` | `#F7F8FB` | `247, 248, 251` | Fill-only derived wordmark for dark surfaces. Keep it on a sufficiently dark, quiet surface and never use it as live UI text. |
| `wordmarkDark` | `#111827` | `17, 24, 39` | Fill-only derived wordmark for light surfaces. Keep it on a sufficiently light, quiet surface and never recolour the symbol to match. |

### Dark mode (Midnight)

| Token | HEX | RGB | Purpose and accessibility guidance |
| --- | --- | --- | --- |
| `background` | `#050914` | `5, 9, 20` | Root canvas and deepest surface; never replace with flat black. |
| `surface` | `#151B27` | `21, 27, 39` | Primary cards and panels. |
| `surfaceRaised` | `#1B2230` | `27, 34, 48` | Menus, floating panels and sheets that need elevation. |
| `surfaceInset` | `#101622` | `16, 22, 34` | Inputs, wells and inset regions. |
| `surfaceMuted` | `#202838` | `32, 40, 56` | Selected or softly highlighted surfaces; retain a non-colour selection cue. |
| `border` | `#2A3345` | `42, 51, 69` | Hairline dividers and the faint edge of floating web chrome (command bar, phone tab bar, popovers, dialogs). Panels and cards are fill-led on both platforms: no outline. |
| `borderStrong` | `#3B465B` | `59, 70, 91` | Selected outlines where fill cannot communicate state. |
| `controlBorder` | `#64718A` | `100, 113, 138` | Essential web input/control boundary; at least 3:1 against dark surface and inset roles. |
| `textPrimary` | `#F7F8FB` | `247, 248, 251` | Main text and values; 18.73:1 on `background`. |
| `textSecondary` | `#8993A7` | `137, 147, 167` | Supporting copy; 6.44:1 on `background`. |
| `textMuted` | `#707B91` | `112, 123, 145` | Tertiary copy; 4.67:1 on `background` but only 4.05:1 on `surface`, so do not use it for small body text on cards. |
| `accent` | `#FF6248` | `255, 98, 72` | Primary action and live recording; `accentText` also tints the selected iPhone tab. Other Blocks navigation uses a neutral fill for selection. Do not substitute it for danger. |
| `accentText` | `#FF6248` | `255, 98, 72` | Contrast-safe accent foreground on dark surfaces. |
| `accentStrong` | `#FF6248` | `255, 98, 72` | Compatibility alias for existing consumers; new UI should use `accent`. |
| `accentHover` | `#FF745D` | `255, 116, 93` | Pointer hover only; retain focus treatment independently. |
| `accentPressed` | `#E94D35` | `233, 77, 53` | Pressed/active feedback. |
| `accentSoft` | `#FF62481F` | `rgba(255, 98, 72, 0.12)` | Low-emphasis selection background; pair with text or an icon. |
| `onAccent` | `#050914` | `5, 9, 20` | Text/icons on coral; 6.72:1 on `accent`. |
| `focus` | `#64718A` | `100, 113, 138` | Neutral grey keyboard focus across all web controls. Field-like controls turn their 1 px `controlBorder` line this colour and add a 1 px inset, reading 2 px without moving (WUI-017); standalone actions use one 2 px offset ring. |
| `success` | `#39D99A` | `57, 217, 154` | Completed/success state; always include copy or iconography. |
| `warning` | `#F2BA38` | `242, 186, 56` | Review and warning state; never colour alone. |
| `warningText` | `#F2BA38` | `242, 186, 56` | Contrast-safe warning foreground on dark surfaces. |
| `danger` | `#FF6B6B` | `255, 107, 107` | Destructive/error state, separate from primary coral. |
| `dangerText` | `#FF6B6B` | `255, 107, 107` | Contrast-safe danger foreground on dark surfaces. |
| `onDanger` | `#050914` | `5, 9, 20` | Text/icons on filled danger controls; 7.17:1 on `danger`. |
| `info` | `#4B93F5` | `75, 147, 245` | Informational state and supporting data cues. |
| `chartTrack` | `#252E40` | `37, 46, 64` | Donut and bar tracks behind data colour. |
| `disabled` | `#F7F8FB75` | `rgba(247, 248, 251, 0.46)` | Disabled foreground; pair with an unavailable cursor/state and stable readable labels. |
| `overlay` | `#0000008F` | `rgba(0, 0, 0, 0.56)` | Modal scrim; content beneath must not remain interactive. |
| `shadow` | `#00000052` | `rgba(0, 0, 0, 0.32)` | Restrained floating-surface shadow colour. |

### Light mode (Daylight)

| Token | HEX | RGB | Purpose and accessibility guidance |
| --- | --- | --- | --- |
| `background` | `#F4F6F9` | `244, 246, 249` | Root canvas. |
| `surface` | `#FFFFFF` | `255, 255, 255` | Primary cards and panels. |
| `surfaceRaised` | `#FFFFFF` | `255, 255, 255` | Elevated menus, popovers and sheets; on iOS elevation comes from canvas contrast and restrained shadow. |
| `surfaceInset` | `#F7F8FB` | `247, 248, 251` | Inputs and inset areas. |
| `surfaceMuted` | `#EEF1F6` | `238, 241, 246` | Selected and muted surfaces; retain a non-colour cue. |
| `border` | `#DDE2EA` | `221, 226, 234` | Hairline dividers and the faint edge of floating web chrome (command bar, phone tab bar, popovers, dialogs). Panels and cards are fill-led on both platforms: no outline. |
| `borderStrong` | `#BCC5D2` | `188, 197, 210` | Selected outlines where fill cannot communicate state, such as palette swatches. |
| `controlBorder` | `#7D8797` | `125, 135, 151` | Essential web input/control boundary; 3.63:1 against white. |
| `textPrimary` | `#111827` | `17, 24, 39` | Main text and values; 16.39:1 on `background`. |
| `textSecondary` | `#667085` | `102, 112, 133` | Supporting text; 4.97:1 on white `surface`. |
| `textMuted` | `#667085` | `102, 112, 133` | Tertiary text; use state/opacity separately rather than a paler inaccessible grey. |
| `accent` | `#F45D43` | `244, 93, 67` | Primary action and live recording; `accentText` also tints the selected iPhone tab. Other Blocks navigation uses a neutral fill for selection. |
| `accentText` | `#B73A26` | `183, 58, 38` | Small accent foreground; 5.76:1 on white and 4.87:1 on `accentSoft`. |
| `accentStrong` | `#F45D43` | `244, 93, 67` | Compatibility alias for existing consumers; new UI should use `accent`. |
| `accentHover` | `#E85038` | `232, 80, 56` | Pointer hover state. |
| `accentPressed` | `#E9523B` | `233, 82, 59` | Accessibility-adjusted pressed fill; 4.84:1 with `onAccent`. |
| `accentSoft` | `#FFE7E1` | `255, 231, 225` | Low-emphasis selected background. |
| `onAccent` | `#111827` | `17, 24, 39` | Text/icons on coral; 5.49:1 on `accent`. |
| `focus` | `#7D8797` | `125, 135, 151` | Neutral grey keyboard focus across all web controls. Field-like controls turn their 1 px `controlBorder` line this colour and add a 1 px inset, reading 2 px without moving (WUI-017); standalone actions use one 2 px offset ring. |
| `success` | `#20B978` | `32, 185, 120` | Completed/success state with copy or iconography. |
| `warning` | `#D9940A` | `217, 148, 10` | Review/warning state with a non-colour cue. |
| `warningText` | `#805600` | `128, 86, 0` | Small warning foreground; 5.71:1 on `surfaceMuted`. |
| `danger` | `#D94F4F` | `217, 79, 79` | Destructive/error state. |
| `dangerText` | `#B42318` | `180, 35, 24` | Small danger foreground; 6.19:1 on `surfaceInset`. |
| `onDanger` | `#050914` | `5, 9, 20` | Text/icons on filled danger controls; 4.91:1 on `danger`. |
| `info` | `#3B82F6` | `59, 130, 246` | Informational state and supporting data cues. |
| `chartTrack` | `#E5E9F0` | `229, 233, 240` | Donut and bar tracks behind data colour. |
| `disabled` | `#1118276B` | `rgba(17, 24, 39, 0.42)` | Disabled foreground; do not reduce whole controls to near invisibility. |
| `overlay` | `#11182752` | `rgba(17, 24, 39, 0.32)` | Modal scrim. |
| `shadow` | `#1118271A` | `rgba(17, 24, 39, 0.10)` | Floating-surface shadow colour. |

### Category and chart palette

The executable source of truth for category/chart keys, labels, HEX values, legacy resolution, deterministic fallback order, and picker order is `packages/shared/src/palette.ts`. Do not duplicate a second static HEX table in documentation; shared tests assert the complete 30-key contract and exact ordering.

Palette keys are storage/API compatibility values. Never rename them or replace stored keys with display HEX values. Legacy Midnight Core, Soft Pop, seeded, and imported HEX values continue to resolve to their intended current keys.

The current picker contains 30 choices in two five-column blocks. Each column is a hue family and each family runs light-to-dark. The first block contains green/yellow/orange/red/purple families; the second contains blue/sky/lime/pink/grey families. Picker presentation order is deliberately separate from `DAYFRAME_PALETTE`'s stable deterministic fallback order.

Changing the picker must preserve all of these independently:

- 30 unique keys and HEX values;
- `DAYFRAME_PALETTE` fallback order for existing deterministic chart/category assignment;
- `DAYFRAME_PALETTE_PICKER_KEYS` five-column visual order;
- legacy key/HEX normalization without rewriting stored category assignments;
- identical shared values on web and iOS.

On surfaces not yet migrated to Blocks, category colour appears as a small block marker, border, soft fill, hatch, or chart mark beside semantic text.

One activity marker shape (X3, owner decision 12 October 2026): wherever a small mark stands for an activity or category (legends, filter chips, pickers, report rows, review editor choices) it is a rounded-square block with a 30% corner (web `--activity-marker-radius`; iPhone `activityMarkerRadius(size)` in `@dayframe/shared`), never a round dot. Round dots remain only for non-activity meaning: status, the now line, goal progress, avatars and pagination.

On Blocks surfaces, an entry is a solid block filled with its category colour, with its text on the block:

- Each palette entry carries a display value per theme (`lightHex` and `darkHex` in `palette.ts`), more vivid than the stored identity `hex`. Every surface, migrated or not, uses the display value for the current theme, so an activity is the same colour everywhere. Live Activities and Shortcuts use the Midnight value. Stored keys and `hex` never change, so no data migration follows.
- On-block text is white or a deep ink, whichever measures higher contrast. It must reach 4.5:1 for normal text and 3:1 for large text in both themes. `onBlockTextColor` and `blockColorsFor` in `packages/shared/src/blocks.ts` make this choice for web and iOS, and `blocks.test.ts` checks every palette entry in both themes, together with separation between activity colours and from live coral. `DAYFRAME_BLOCKS` there also holds the on-block white and ink and the radius scale (chip 8, block 10, card 20 on the web, phoneCard 22 for ordinary iPhone cards as the prototype's ios.html draws them (the live/idle card and Review deck card keep 26 and 28), sheet 28, pill — also every 44-point round button). A display value that fails both options is adjusted; it is never shipped with failing text.
- Blocks in the Today ribbon (web and iPhone) never touch: neighbours sit 1 px/pt apart and each carries a very faint inner edge taken from the primary text colour (about 14 %), so it reads light on Midnight and dark on Daylight. A ribbon block never gets an outline darker than its own fill. The small per-day bars (web "This week", iPhone "Earlier this week" and the Calendar week strip) are not part of this rule, and neither are web Calendar blocks: they are flat fills with no inner edge, highlight or shade (Trello 213), kept apart by a visual gap.
- Never place text over a palette colour without that measured choice, and never assume a palette colour is accessible body text on another surface.

Colour remains supplementary: blocks still carry the activity name, duration and state as text.

## Typography

Everything people read or type uses system fonts. On iOS use San Francisco through React Native’s `System` family and favour its lighter regular/semi-bold hierarchy instead of uniformly heavy text. On web use the existing system-first stack: `-apple-system`, `BlinkMacSystemFont`, `"SF Pro Text"`, `"Segoe UI"`, sans-serif.

Blocks adds one display face, Bricolage Grotesque (SIL Open Font License). It is used only in display roles. On iPhone, as shipped: screen and sheet titles (Today, Calendar, Reports, onboarding step titles, sign-in, the Activities, Places and place-editor sheet titles, Location evidence), the idle card's `What are you working on?` prompt, the Play orb bloom's `Slide to a block` label, Review card titles, stamps and "All framed", the live timer (`LiveOdometer`), the duration dial's duration, the Reports hero total and donut centre value, Today's goal-frame total and the activity editor's preview name. Never body copy, labels, buttons, inputs or list rows:

- Bundle the font files with each app (on iOS, Bold and ExtraBold in `apps/mobile/ios/Dayframe/Fonts` with their OFL licence, listed in `UIAppFonts` and named by PostScript name through `MOBILE_DISPLAY_FONT`; self-hosted at build time on web). The apps must not request fonts from a third-party server at runtime.
- Body text, labels, buttons, inputs and lists stay on the system font.
- Display text still follows the Dynamic Type role caps below. Its fallback is the system font.
- Numerals that update in place, such as the timer, use tabular figures or fixed-width digit cells so they never shift.

Do not add Sofia Pro or any other font. The Dayframe wordmark is outline geometry and needs no font file.

| Role | Size | Weight | Line height | Letter spacing |
| --- | ---: | ---: | ---: | ---: |
| Screen title | 28–32 | 700–800 | 1.15–1.25 | `-0.02em` to `0` |
| Sheet title | 20 | 700 | 1.2–1.3 | `0` |
| Display prompt or card title (idle prompt 28, Review card title 30, bloom label 40) | 28–40 | 700 | 1.0–1.15 | `-0.03em` to `-0.02em` |
| Panel title | 17–20 | 700 | 1.25–1.35 | `-0.01em` to `0` |
| Body | 14–16 | 400–500 | 1.45–1.6 | `0` |
| Label | 11–13 | 600–700 | 1.3–1.45 | `0.01em` only for short labels |
| Button/navigation | 14–16 | 600–700 | 1.2–1.35 | `0` |
| Timer numerals | Live block odometer 58 on iPhone (scaled to the numeric Dynamic Type cap, shrunk only to fit the card); duration dial up to 38 | 700–800 | Odometer: each digit is laid out on a 1.2 em native text line, centred inside a 1.04 em visual digit cell (0.62 em wide); dial and web timers 1.0–1.15 | `-0.02em` |
| Report headline | Reports hero total 52 on iPhone; other report and goal totals 24–30 | 700–800 | 1.05–1.2 | `-0.04em` to `-0.02em` |

Web type tokens (audit WUI-036, 17 October 2026) carry these roles in px, never rem (the root is 14 px on desktop and 16 px on phones, so rem sizes drifted between them): `--type-label` 11, `--type-meta` 12, `--type-body` 14, `--type-panel` 17 and `--type-panel-lg` 18, `--type-sheet` 20, `--type-screen` 30. Web screen titles (Calendar, Reports, Review, Library, Settings, the Place editor and the 404 and error pages) are 30 px at every width. New Blocks rules size type with the tokens; existing literal sizes move to them as each family is touched.

Use `font-variant-numeric: tabular-nums` on timers, durations, clock labels and report figures. Write every duration one way, with the shared `formatDuration` (`packages/shared`): "6h 25m", "6h", "35m", "<1m" for a positive amount under a minute and "0m" for nothing (audit UIA-042/UIA-207); only a running clock ("0:04:09") and the duration dial keep the clock form. (Still to move: web's own duration helper and the native Calendar's block labels, which round to the nearest minute.) What people read or hear says block and activity — never timer, entry, time entry or task (UIA-100; guarded by `blockWording.contract.test.ts` on iPhone) — counts inside Review say moments ("Loaded 12 of 30 moments."), and paths read "Settings › Sync help" with a single-character ellipsis "…". Do not force monospace typography across the interface. Allow Dynamic Type to grow without clipping; labels may wrap before touch targets shrink.

### iOS Dynamic Type roles

System font scaling stays enabled. The shared mobile role helper applies only
these local caps to compact presentation roles:

| Role | Maximum multiplier | Layout contract |
| --- | ---: | --- |
| Screen / section heading | 1.5 | Wrap or stack within measured space. |
| Item | 1.35 | Keep the primary item readable before secondary metadata. |
| Control | 1.3 | Preserve a minimum 44-point hit target and visible action. |
| Metadata | 1.3 | Wrap or move to a second line when required. |
| Numeric | 1.2 | Measure the complete number/duration; never clip it. |
| Counter | 1.2 | Grow intrinsically and preserve the full spoken count. |
| Input | 1.35 | Keep user-entered text editable and fully visible. |
| Body / explanation / help / warning / error | Uncapped | Grow naturally; allow the owning surface to scroll. |

A multiplier cap alone never establishes fit. When sibling text/actions compete,
measure their intrinsic widths against the real available native width and reflow
before truncation or target collapse. Full times, durations, counts, destination
labels and accessibility names remain available. Do not globally suppress system
scaling or scale a value manually after React Native has scaled it. Reports retains
its explicit Revision 3.2 role contract and STAGING badge exception below; this
table does not change Reports or introduce a global style.

Mobile Reports Revision 3.2 is an explicit dense-layout exception: category rows
remain one line at 320–430-point widths and maximum text size. Only long names
ellipsise; complete percentages and HH:MM:SS values occupy reserved trailing
columns and retain full spoken names/durations. Use local caps of 1.5 for headings,
1.3 for controls, 1.35 for names, 1.2 for numeric/centre/filter-badge/axis roles
and 1.25 for calendar days. The small shared STAGING environment badge is capped
at 1.0 and must resist flex shrink so its complete one-line status remains visible;
its VoiceOver label remains `Staging environment`. Explanatory text retains system
scaling. This owner-approved
trade-off is not a claim of unrestricted Dynamic Type enlargement. Do not suppress
scaling globally, manually scale twice, or constrain glyphs with incompatible
line metrics. Capped headings still require explicit line-box safety at the cap.
The one-line Reports range control uses a locale-aware compact visual form for
custom ranges while exposing the complete range through its accessibility label.
Keep one bounded donut total, not duplicate enlarged values.
Place these informational rows in a zero-gap divider list and target a measured
38–42-point pitch at ordinary text size with minimum-only height; do not shrink
the 44-point targets of actual controls. Sort exact duration descending with
stable-key ties and preserve that order in the donut. Reports' full-width date
sheet centres the shared 349-point calendar-content cap and uses four equal
44-point preset targets with approximately 34-point visible fills. Done commits
the draft range; the handle swipe, backdrop, escape and lifecycle invalidation
discard it. There is no visible Cancel, Clear or dismiss-to-Today treatment.

## Interface consistency

Shared components own their internal typography, spacing, anatomy and states. A host may position or size a component's outer surface, but it must not apply broad descendant selectors that restyle nested fields or actions. Select the component's explicit role classes or its direct option rows instead. This keeps the same feature identical in the timer, dialogs and compact editors.

For compact embedded web forms, use these fixed semantic roles rather than nearby `rem` values:

| Role | Size | Weight | Line height |
| --- | ---: | ---: | ---: |
| Embedded form heading | 14 px | 650 | 1.35 |
| Section and floating-list head | 11 px uppercase, 0.06em tracking, muted | 700 | 1.3 |
| Field label | 12 px | 650 | 1.35 |
| Input, option and body | 14 px | 400–500 | 1.45 |
| Button | 14 px | 700 | 1.2 |
| Menu action | 14 px | 650 | 1.35 |

Use sentence case for headings, field labels and actions. Field labels sit above their field; the 11 px uppercase form is for section and floating-list heads, and for the time-box labels (START, END, DURATION) that sit above their boxes in the block editors and the timer's start panel, as on the iPhone entry sheet (owner, 21 October 2026); the box holds only the value. Preserve hierarchy through role, weight and colour; do not invent a one-off font size inside one host of a shared component. Floating lists under a field (the command timer's Suggestions, Tags and Activities) share one anatomy and head: the 11 px uppercase muted head naming the list with its plural noun (web UI audit WUI-018, owner 17 October 2026; what #391, #442 and the prototype ship), and 36 px rows (44 px on touch screens) with one neutral highlight.

Web fields (WUI-017, owner 17 October 2026) are one field: 44 px tall, radius 10, a `surfaceInset` fill and one 1 px `controlBorder` line at rest — at least 3:1 against every surface in both themes, because a fill alone is about 1.05:1 and fails WCAG 1.4.11 (Codex review of #472) — that turns the neutral focus colour and reads 2 px on focus through a 1 px inset inside it, so focus never shifts layout (compound fields put it on the wrapper and their inputs draw none; the palette search and the start panel draw it as inset shadows; a List inline edit, which reads as text at rest, shows only the ring while edited), with the danger cue for an invalid value. Text fields are 44 px on touch screens. Compound web fields put that perimeter on the wrapper with 12 px of content inset. A leading icon or colour action keeps at least a 44 × 44 px target while its visual mark remains independently sized. For the contextual category-create field, the visible swatch is 20 px: centred in the 44 px leading target, its edge is 14 px and its centre is 24 px from the field's outer edge. Category markers in closed fields and option rows remain compact, borderless and shadowless rounded-square blocks (the X3 activity marker rule), never circles.

List separators and rounded actions are separate layers. Use a 1 px semantic `border` line inset 12 px from the option surface, with 6 px of clear space before the independently rounded action row. Do not use a rounded button's border or inset shadow as the divider. Hover, selection and neutral keyboard focus remain independent states, and host-specific styles must not change the shared control's internal geometry.

At narrow widths, keep the same type roles, insets and minimum targets. Clamp the floating surface to the viewport and scroll its bounded content rather than compressing its component anatomy or making the surrounding editor scroll.

## Supporting system

### Spacing and shape

Use the shared spacing scale `4, 8, 12, 16, 20, 24, 32`. Web radius tokens (audit WUI-037): `--r-chip` 10 (controls and chips), `--r-block` the X3 30 % (`--activity-marker-radius`), `--r-card` 22, `--r-sheet` 24, `--r-pill` 999; new Blocks rules use them. Prefer 20–24 px/pt grouped surfaces, 14–18 compact cards and controls, and 24–28 floating navigation. Pills may be fully rounded. Keep interactive targets at least 44×44 px/pt.

Across signed-in web and iOS surfaces, icon-only buttons are circular and compact text buttons are pills. Avoid rounded-square button silhouettes. Separate panels from the canvas with `surface`/`surfaceRaised` fill, and use inset fills or hairline dividers for structure inside a panel.

### Borders, elevation and shadows

Borders are not the default grouping mechanism. Prefer canvas/surface contrast, inset fills and light internal dividers; reserve lines for semantic data structure, focus, validation, essential control boundaries, calendar grids and cases where fill cannot communicate state, such as a selected colour swatch. Reserve elevation for sheets, menus and floating navigation:

Row dividers never touch their container's edges (owner rule, 28 October 2026). A divider between rows, under a sheet or dialog header, above its actions, in a menu, popover or the profile panel is inset on both sides — by the row's horizontal padding, and on the leading side further, past the lead icon, where the list has one (Today's and Calendar › List rows start at 60 px and end 10 px short; Settings rows start at 46–52 px). Web draws every such hairline with one mechanism: a 1 px pseudo-element placed with `inset-inline: var(--divider-inset-start, var(--divider-inset)) var(--divider-inset)` (table rows: a background line sized by the same values; markup that isn't a list row: `.df-divider-top`), in the line's existing `line` or `border` token. Lines that are frames rather than dividers keep their full width: calendar grid lines, the sticky timer band's scroll edge, keycaps, and the signed-out landing page's section rules. Where a list scrolls sideways (Calendar › List on phones and beside the Places column), its scroll viewport is itself inset 10 px from the panel on both sides, so the clip edge the lines run into never touches the container. A list whose container already pads it (Library › Tags and Activities, Reports tables, dialog content) is inset by that padding. `apps/web/src/app/dividers.contract.test.ts` guards the web. The iPhone follows the same rule app-wide (Calendar › List, sheets, Settings, menus, Library lists, Today): every hairline is drawn with `<InsetDivider>` or `insetDividerStyle` (`apps/mobile/src/lib/insetDivider.ts`) in the `border` token, with logical start / end insets — 16 pt by default (the row's padding), 60 pt leading on Today's and Calendar › List rows (Calendar's end 14 short), 64 pt on Library rows past the tile, 18 pt in the overflow menu, 12 pt in the tag and suggestion lists. A line inside a card or sheet that already pads it names that padding (`paddedBy`) and may then reach the content edge. Frames keep full width: the Reports chart's tick lines, the native Calendar's hour grid line and the Review deck's labelled split. `apps/mobile/src/components/dividers.contract.test.ts` guards the iPhone.

- dark: `0 12px 32px rgba(0, 0, 0, 0.32)`;
- light: `0 12px 28px rgba(17, 24, 39, 0.10)`.

Use platform equivalents on iOS. Avoid glow, heavy gradients and stacked shadows.

### Icons

Dayframe has one icon geometry on web and iOS: Lucide's 24-point grid with 2-point round strokes, outline-led (a few glyphs, such as `palette` and `tag`, carry small filled dots that renderers must draw as given). `packages/shared/src/iconGlyphs.ts` holds every glyph in the shared set, with the Lucide (ISC) and Feather (MIT) notices; it is generated by `npm run generate:icons` from `lucide-react` plus Dayframe-drawn glyphs in the same geometry (the swimmer), and `npm run check:icons` (part of `npm run lint`) fails when it is stale. `packages/shared/src/icons.ts` maps interface roles (`DAYFRAME_APP_ICONS`) and the 55 activity icons (`DAYFRAME_ACTIVITY_ICONS`: 54 in six groups plus the neutral `other`, which belongs to no group) to glyphs.

- Activities store a Dayframe key such as `errands` in `categories.icon`, never a glyph name. With no stored key the icon comes from the name (`activityIconKeyForName`), and otherwise a neutral dot. Creating an activity by name stores the name's icon, else `other` (`suggestedActivityIconKey`). Activity icons always sit beside the activity name and are hidden from assistive technology.
- Sizes: 16 inline with text, 20 in lists, chips and blocks, 24 for navigation and icon buttons, 32 for empty states. Icon buttons keep 44-point targets.
- Selected state is a neutral fill or tint (the iPhone tab bar's coral selected tab, below, and the web navigation's coral current-page icon are the exceptions), never a filled glyph.
- Buttons with text carry an icon only when they are the screen's primary action (or a primary like Log it); every other text button is text only (owner, 11 October 2026: "Edit profile" has no icon). Icon-only buttons keep their icon with an accessible name. Navigation, search, pickers and field triggers, menu and list rows, chips and activity blocks are not text buttons and keep their icons; so does the Review deck's decision row (Log it, Skip, Edit name with their keys), as on the iPhone deck and the prototype. The Reports Filter button is the one named exception (owner staging feedback I3, 12 October 2026): it keeps the registry funnel before "Filter", as on the iPhone's funnel button and the prototype. Play and Stop are the only solid glyphs: on the coral control where it is the screen's primary action, and on the live block's on-block Stop control (in the block's text colour) on Blocks surfaces.
- The iOS tab bar uses Dayframe glyphs rendered as template images (`apps/mobile/assets/tab-icons`, generated with the registry) inside the system tab bar, so UIKit keeps Liquid Glass, tinting, the selection highlight and minimisation. Today is the sun, Calendar the calendar and Reports the column chart. The selected tab's icon and label use `accentText` (coral; deeper in Light for contrast on the glass) and unselected tabs `textSecondary`, so the selection stays visible whatever scrolls beneath the glass.
- Registry or lucide (owner decision 11 October 2026, audit UIA-212 option c): anything that stands for a Dayframe thing or action — navigation, activities, start/stop, pin, edit, delete, places and home/work, tags, Calendar, Review, Health and commute sources, export, split/merge — uses the registry glyph (`DayframeIcon` on web and iPhone); `lucide-react` stays allowed on web for generic controls only (close, chevrons, check, add, search, show/hide, the theme switcher). The Calendar List view, the workspace switcher's folder and the Filter funnel draw registry glyphs too (web UI audit WUI-016, 17 October 2026). Guarded on web by `iconRule.contract.test.ts`.
- Do not use SF Symbols, emoji or Unicode characters as icons, and do not add another icon package. On web the rule above applies everywhere (no surface keeps lucide for a Dayframe thing); on iPhone, surfaces not yet migrated may keep their mobile glyphs and SF Symbols (the duration dial) until those move to the registry; a migrated surface draws from the registry. The Live Activity and Dynamic Island are migrated (UIA-028): the Lock Screen is the live block itself (activity fill, on-block text, Bricolage digits, Today's Stop), the island marks the activity with a small block, and no SF Symbols remain. The native Calendar is migrated too (UIA-064): its view-menu (Day, List), place, trip, Apple Health, tag and time icons are registry glyphs bundled with the module by `npm run generate:icons`; the view menu's check is the system menu's own. Current exception: the iPhone connectivity slot (`ConnectivityStatusStrip`) still draws the SF Symbols `icloud.slash` (offline) and `checkmark.icloud` (back online) through `expo-symbols`, including in the headers of migrated Today, Calendar and Reports. It is accepted as is until a registry glyph replaces it; do not copy it to other icons.

### Component states

- **Primary:** `accent` background with `onAccent` content; use `accentHover` and `accentPressed`; retain a readable disabled label.
- **Secondary:** on iOS use a `surfaceMuted` pill or circle with no outline; on web use `surface` or `surfaceInset` plus the shared focus ring.
- **Buttons (web; audit WUI-011…015, 17 October 2026):** one pill family, `df-rbtn` — 44 px tall, 16 px sides, 14 px/700 (`--sm` is 36 px with 14 px sides; the older `ui-button` and Calendar editor buttons share the geometry). Secondary is `surfaceMuted`, Cancel is always the ghost (no fill), the primary is coral, destructive as below. Hover is neutral on everything but the primary and the live control: coral never appears on a hover of a secondary, ghost or icon button, a tag, a count chip or Start again. Desktop controls use the same 44 px scale as phones (no 38 px controls); an icon action drawn smaller than 44 px (34 px row actions, the Calendar's Start again, the List's repeat count) keeps an invisible 44 px hit area.
- **Tooltips (web; WUI-014):** every icon-only button names itself in the one tooltip (`TooltipHost`, an element's `data-tip`; `IconButton` sets it from its label): an inverse pill (`textPrimary` fill, `surface` text, 10 px radius, 6/10 padding, 12 px/600) after 400 ms of mouse hover or at once on keyboard focus, never on touch; Escape, a press or leaving hide it, and a scroll hides a hover tip but carries a focus tip with its button. It is decoration — the button keeps its own accessible name — sits in the top layer clamped inside the viewport, and fades over 120 ms (no fade under Reduce Motion). A text field's hint shows on hover only. Do not use native `title` tooltips for instructions.
- **Destructive:** `danger`, never primary coral; confirmation behaviour remains intact. Web (audit WUI-009/WUI-010, 17 Oct 2026): a destructive action that opens a question is quiet `dangerText` on no fill; the question is the one `ConfirmDialog` — a centred card over the scrim, a question for its title, one line of body, a neutral way back that takes focus and a solid `danger` button with `onDanger` text; Escape and the scrim go back. Never a pink tinted fill. An action that is undone instead of confirmed (Delete, Discard running block) acts at once and offers Undo in the toast.
- **Inputs:** on iOS use `surfaceInset`/`surfaceMuted` fill and keyboard focus. On web use the `surfaceInset` fill with one 1 px `controlBorder` line at rest that turns the focus colour and reads 2 px on focus (a 1 px inset inside it), so the field never moves; compound fields give that perimeter to the wrapper with `focus-within`. The web command timer's Description sits on the command bar with no perimeter at rest or after a click or tap; its wrapper shows the neutral perimeter only for keyboard, shortcut, programmatic or assistive-technology focus (Trello 213). Do not add a second halo. Placeholder text must remain readable.
- **Floating lists (web, Blocks):** a list under a field (the command timer's Suggestions, Tags and Activities, typed or opened from the activity block and the tag button, which add a search field at the top) uses one pattern: a raised surface with 6 px inside padding, a small uppercase muted header (11 px, tracked), 36 px rows (44 px on phones and touch screens) with a lead, the label and right-aligned muted metadata, a neutral `surfaceMuted` highlight inset from the edge, no divider lines, and one footer row of muted keyboard hints with the keys on a quiet fill. Focus stays the neutral grey ring.
- **Segmented controls (web; WUI-019, 17 October 2026):** one look, the Reports and Library `df-seg`: a `surface` track with an inset 1 px `border` and 4 px padding, 36 px pill items (44 px on touch screens) in 13 px/650 `textSecondary`, the chosen item on `surfaceMuted` in `textPrimary` — never an inverted or coral fill. Calendar's Day/Week and Calendar/List (card C, 25 Oct 2026: the round view-icon menu is the iPhone's only), Settings' Appearance and Clock, the date sheet's quick picks and the place radius all use it.
- **Selection:** use a clearly differentiated fill plus selected-state semantics. Add a check or outline only when the fill and label are not sufficiently distinct; category pills do not need a redundant checkmark.
- **Loading/empty/error:** use consistent surfaces and plain, actionable copy. Never display raw native exceptions. Web (audit WUI-030, 17 October 2026): empty is one 14 px `textSecondary` sentence inside its card ("No tagged blocks yet." plus a hint); page loading is Blocks skeleton cards, and inline loading one muted line; a page or panel error is the one `ErrorBanner` — a 14 px-radius banner on 12 % `danger` over `surface`, the sentence in `textPrimary` and a Dismiss icon action with a 44 px target; a field error stays under its field as 12 px `dangerText` (`ui-field-error`), linked with `aria-describedby`.
- **Rows (web; WUI-028/029/031, 17 October 2026):** list rows follow Today's entry row — transparent with 1 px hairlines inset past the 36 px block (X3 radius, 30 % of 36 px), a `surfaceMuted` fill on hover or keyboard focus, the title over one 12 px line in `textSecondary` mixed 15 % toward `textPrimary` (plain `textSecondary` is 4.39:1 on Daylight's hover fill), actions that appear on hover or focus (always on touch screens and up to 860 px) — Calendar › List, Reports' Matching blocks, Tags and More insights; management rows (Tags, Places, Settings) are 56 px.

### Focus and accessibility

Meet WCAG AA where practical: 4.5:1 for normal text, 3:1 for large text and essential non-text UI boundaries. Every keyboard-operable web control needs a visible neutral grey focus indicator, using the shared `focus`/`controlBorder` treatment rather than blue `info` or accent colour. Focus must remain distinct from selection, validation and disabled state; focused invalid fields retain error copy and a separate internal danger cue. Preserve VoiceOver labels, selected-state announcements, 44 px/pt targets, safe areas, keyboard avoidance, Reduce Motion and Reduce Transparency fallbacks.

### Charts

Use the shared palette, `chartTrack`, stable segment ordering and exact value labels. Donuts retain a centre total; bars retain text values. Handle zero totals and a single 100% segment explicitly. Colour is supplementary: legends, percentages, labels and state text carry the meaning.

### Calendar (v3, owner 24 October 2026)

Calendar follows Apple Calendar's structure in Dayframe's palette (`calendar-v3-mockup`; the iPhone's native Calendar and the web Calendar alike, with the web differences noted below).

- **Blocks:** a translucent tint of the activity colour (18 % on Daylight, 28 % on Midnight; suggestions 10 % / 14 %), so hour lines and any block underneath show through; opaque over the surface only under Reduce Transparency. A solid 3 pt bar in the full activity colour down the leading edge, 5 pt corners, no outline. Text is a darker shade of the same hue on Daylight and a lighter one on Midnight, meeting AA on its tint. Blocks never touch: 2 pt between neighbours side by side and below.
- **Overlap (Apple's hybrid):** blocks whose starts are within 20 minutes (or within the first one's title line) sit side by side in equal columns; a block that starts clearly inside a longer one nests, indented 14 pt from that block's left edge and drawn on top of it. Shared constants: `CALENDAR_V3_OVERLAP`.
- **Text:** the title always wins, in bold: compact 11.5 pt under 34 pt tall or 90 pt wide, otherwise 14 pt. When not even its first word fits, it is cut with an ellipsis ("Quart…"); a column under 22 pt shows colour only. With room in a block at least 120 pt wide, icon lines follow: the place (pin), a trip (route) or Apple Health, the tags, then the times (clock). A suggestion is a light warning tint with a dashed amber edge and the amber dot (see Calendar places and "?" below).
- **Now:** a red line exactly on the minute (the danger red: `dangerText` on Daylight, `danger` on Midnight) with the time in a red pill in the hour gutter, in place of the hour label it would cover.
- **Chrome:** the month as the title and one round 44 pt view button that opens the system menu with exactly two choices, Day and List (no Multi Day). No "framed" line under the week strip (card C, 25 Oct 2026: List's day heading already says "logged"). An hour label hides only where the time pill covers its digits (#255). No − / +: pinch to zoom, and VoiceOver's adjustable action on the timeline.
- **Web:** the same blocks, overlap (laid out in px across the measured day column, so the 14 px indent is exact), text, icon lines (registry `DayframeIcon` glyphs) and now line (`--calendar-now`, the danger red, drawn above the blocks as on the iPhone). The Calendar head is one compact toolbar row (#259, owner 27 Oct 2026): ‹ period › (with Today when away from today, never in List), the week strip with each day's total under its date (#256) and the week total (a link to the week's report), Day | Week, then a visible Calendar | List switch in the same segmented style (card C: the round view-icon menu is the iPhone's only; the web keeps "Calendar" because its Day / Week scope sits beside it). It wraps only where the row runs out of room; on phones the period, the strip and the two switches each take a line. There is no separate "framed" line. An hour label hides only where the now pill actually covers its text as drawn (#255): a wide gutter shows "06:00" beside a 05:57 pill. "Start again" is the filled Play glyph on every web surface (#257); a running block's Restart keeps its arrow. The web keeps its − / + zoom buttons: it has no pinch, and they are the single-pointer way to zoom. A nested block is its own tint over the surface at 88 % (tints never stack, so its text keeps the single block's contrast).
- **List (owner choice A, 24 October 2026):** Apple's List layout with Dayframe's block markers (never a thin colour bar; the #341 rule): each row leads with Today's activity block and its icon, its height following the block's length; then the bold title, a second line with a pin and the place (a route for a trip) or a tag and the tags (none when neither), and the start over the end on the right in tabular figures; a row that asks something keeps its own icon with the amber dot (see below).

### Calendar places and "?" (owner approval, 28 October 2026)

- **One signal:** a row (or a Grid item) that asks something keeps its own icon (the place's pin, Home's house, Work's briefcase, a trip's route, Apple Health's heart) in the usual filled tile and adds one small amber dot (`warning`) at the tile's top-right, ringed in the surface colour. No outlined boxes, no hatching in the List, no second "?" control. On the Grid a question is a light tint of the warning colour with a dashed amber edge and the same dot, with no "?" before its title.
- **The row is the control:** tapping a place or trip row (or a Grid item) opens its sheet or dialog, with its "?" asked at the top. Only Apple Health, which has no sheet, asks under its row.
- **One right edge:** every List row ends with the start over the end in tabular figures; a place's length sits in its subtitle (iPhone) or the duration column (web). Every row leads with the same tile.
- **Compact pills for inline answers:** answers that sit on a row or at the top of a sheet (Yes, Edit, Not now) use the compact pill, the size of the Calendar row's Yes pill (owner rule, 28 October 2026): 32 pt tall, 16 pt horizontal padding on iPhone, 14 pt bold, full pill radius, with at least a 44 pt touch target around it. On iPhone it is `compactPillStyles.pill` with `COMPACT_PILL_HIT_SLOP` (`apps/mobile/src/components/compactPill.ts`), and wrapped rows of pills sit 12 pt apart so their targets never overlap. On the web it is `.ui-button.is-compact` at 32 px with 14 px sides (`.timeline-row-yes`); the List's question answers and the correction dialog's question answers share that rule and its 44 px hit area. A confident answer is the neutral dark pill; coral stays for Play, Stop and live recording.
- **Quiet filters:** "All places" / "Fewer places" is quiet text by the day heading, never a filled pill that reads as the screen's main action. A sheet's Done stays secondary until something changed.

### Motion

Motion is short, purposeful, and consistent across a complete interaction: approximately 120–220 ms for control feedback and 180–300 ms for panels or chart reveals. Use standard ease-out timing and provide a reduced-motion path that removes nonessential transitions without hiding state changes.

Surfaces migrated to Blocks use the prototype's motion instead, defined in `.codex/reference/motion.md`: named springs (snap, sheet, land, pop, roll), drop-ins, pops, rolling timer digits, the Stop flight, swipes, card throws and the Play orb bloom. When an entry is started, stopped, logged or deleted, its block lands with one small spring overshoot and a matching haptic. The one live block carries a slow breathing ring. No glow, confetti, parallax or idle loop. Reduce Motion keeps the same states, haptics and Undo without springs or travel: hand-offs (a thrown card, a swiped row, a bloom pick) happen at once, Today's released row swipe or live-block pull returns in a short 120 ms timing, a released Review card resets at once, the breathing ring holds still (the running Play orb's seconds ring still advances in one-second steps), and presence changes use short opacity fades.

Every new feature with visible movement must define the trigger, one animation owner, entrance/update/exit behaviour, surrounding layout response, interruption, async success/Undo/failure states, and Reduce Motion path before implementation. A transition is not complete when the initiating gesture is smooth but the resulting content, feedback, dismissal, or rollback jumps. Use the canonical implementation and validation rules in `.codex/reference/motion.md`.

Direct-manipulation gestures are not decorative motion. Calendar scrolling and pinch zoom must be owned by one native interaction surface and update continuously with the fingers. Do not simulate zoom with one visual transform and then snap to a separately rebuilt layout on release. SwiftUI may wrap a UIKit scroll view when that provides the correct system gesture, focal-point, deceleration and accessibility behaviour.

### Platform differences

Web may remain denser and uses hover, keyboard focus and responsive dialogs, while retaining the same fill-led surface hierarchy, circular icon actions, pill text actions and divider-led lists as iOS. iOS uses safe-area-aware screens, Dynamic Type, native press feedback and sheets. Primary tabs use the system tab controller so supported iOS releases own the Liquid Glass material, layout and accessibility behaviour; do not recreate that navigation material with an overlaid JavaScript glass view. Targeted SwiftUI views must consume the resolved Dayframe semantic roles passed through their native boundary rather than inventing a separate palette or hard-coding nearby colours. Both platforms use the same semantic colour roles, brand geometry, hierarchy and state meaning; platform conventions may change mechanics, not identity.

## Brand release checklist

- Canonical and public SVG mirrors match; derived wordmarks differ only by fill.
- The colour symbol is unchanged and has no background rectangle.
- Dark surfaces use the light artwork; light surfaces use the dark artwork.
- A lock-up exposes one accessible name; decorative artwork exposes none.
- No primary application surface references the legacy PNG banner.
- Favicon and app icon use the symbol only; the iOS icon is opaque.
- System, Midnight and Daylight appearances are checked without a wrong-tone flash.
- Web SVGs load at desktop and phone widths; iOS bundles exact SVG components.
- Typography remains system-first: only bundled, openly licensed Bricolage Grotesque files are present, used for display roles only and never fetched from a third-party server at runtime.
- Focus, contrast, Dynamic Type, VoiceOver, Reduce Motion and Reduce Transparency are checked.
