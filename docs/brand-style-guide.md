# Dayframe Brand and Style Guide

This guide defines the Midnight Core visual system for Dayframe across web and iOS. It governs brand artwork, semantic colour, typography, spacing, component states, charts, motion and accessibility. Product behaviour remains defined by `docs/PRD.md`.

## Brand character

Dayframe should feel dark, calm, premium and useful. Dark mode begins with a near-black midnight navy rather than flat black. Light mode is a deliberately designed companion. Both modes stay compact enough for dense time data, use restrained elevation and make the next action easy to find.

The signature treatment is a vivid, unchanged six-colour symbol paired with a single-colour outlined wordmark on quiet navy or neutral surfaces. Coral identifies primary action and active state; it does not replace category colours or semantic success, warning and danger colours.

## Brand assets

### Canonical and derived files

| File | Status | Use |
| --- | --- | --- |
| `logos/dayframe-colour-logo-transparent.svg` | Canonical symbol | The six-colour Dayframe mark on a transparent canvas. Do not recolour it. |
| `logos/dayframe-wordmark-outlined.svg` | Canonical wordmark | Source outline geometry with its original `#1D1E22` fill. It contains no font. |
| `logos/dayframe-wordmark-light.svg` | Derived artwork | `#F7F8FB` wordmark for dark surfaces. “Light” describes the artwork colour. |
| `logos/dayframe-wordmark-dark.svg` | Derived artwork | `#111827` wordmark for light surfaces. “Dark” describes the artwork colour. |
| `apps/mobile/assets/dayframe_app_icon.png` | Derived runtime icon | Opaque 1024 px canonical symbol on the Midnight Core `#050914` canvas for Expo/iOS generation. |
| `apps/mobile/ios/Dayframe/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png` | Native runtime mirror | Exact RGB mirror of the Expo icon; regenerated from the same canonical symbol. |

The same four SVG files under `apps/web/public/logos/` are runtime mirrors, not additional sources of truth. Regenerate or copy those files from `logos/`; never edit the public copies independently. The two iOS icon PNGs must also remain byte-identical, 1024 × 1024 and opaque RGB.

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

### Dark mode

| Token | HEX | RGB | Purpose and accessibility guidance |
| --- | --- | --- | --- |
| `background` | `#050914` | `5, 9, 20` | Root canvas and deepest surface; never replace with flat black. |
| `surface` | `#151B27` | `21, 27, 39` | Primary cards and panels. |
| `surfaceRaised` | `#1B2230` | `27, 34, 48` | Menus, floating panels and sheets that need elevation. |
| `surfaceInset` | `#101622` | `16, 22, 34` | Inputs, wells and inset regions. |
| `surfaceMuted` | `#202838` | `32, 40, 56` | Selected or softly highlighted surfaces; retain a non-colour selection cue. |
| `border` | `#2A3345` | `42, 51, 69` | Hairline dividers and web-only outlines; not a default iOS container treatment. |
| `borderStrong` | `#3B465B` | `59, 70, 91` | Selected outlines where fill cannot communicate state. |
| `controlBorder` | `#64718A` | `100, 113, 138` | Essential web input/control boundary; at least 3:1 against dark surface and inset roles. |
| `textPrimary` | `#F7F8FB` | `247, 248, 251` | Main text and values; 18.73:1 on `background`. |
| `textSecondary` | `#8993A7` | `137, 147, 167` | Supporting copy; 6.44:1 on `background`. |
| `textMuted` | `#707B91` | `112, 123, 145` | Tertiary copy; 4.67:1 on `background` but only 4.05:1 on `surface`, so do not use it for small body text on cards. |
| `accent` | `#FF6248` | `255, 98, 72` | Primary action, active timer and selected navigation. Do not substitute it for danger. |
| `accentText` | `#FF6248` | `255, 98, 72` | Contrast-safe accent foreground on dark surfaces. |
| `accentStrong` | `#FF6248` | `255, 98, 72` | Compatibility alias for existing consumers; new UI should use `accent`. |
| `accentHover` | `#FF745D` | `255, 116, 93` | Pointer hover only; retain focus treatment independently. |
| `accentPressed` | `#E94D35` | `233, 77, 53` | Pressed/active feedback. |
| `accentSoft` | `#FF62481F` | `rgba(255, 98, 72, 0.12)` | Low-emphasis selection background; pair with text or an icon. |
| `onAccent` | `#050914` | `5, 9, 20` | Text/icons on coral; 6.72:1 on `accent`. |
| `focus` | `#71C5F4` | `113, 197, 244` | Keyboard focus. Field-like controls change one reserved 2 px perimeter in place; standalone actions use one 2 px offset ring. |
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

### Light mode

| Token | HEX | RGB | Purpose and accessibility guidance |
| --- | --- | --- | --- |
| `background` | `#F4F6F9` | `244, 246, 249` | Root canvas. |
| `surface` | `#FFFFFF` | `255, 255, 255` | Primary cards and panels. |
| `surfaceRaised` | `#FFFFFF` | `255, 255, 255` | Elevated menus, popovers and sheets; on iOS elevation comes from canvas contrast and restrained shadow. |
| `surfaceInset` | `#F7F8FB` | `247, 248, 251` | Inputs and inset areas. |
| `surfaceMuted` | `#EEF1F6` | `238, 241, 246` | Selected and muted surfaces; retain a non-colour cue. |
| `border` | `#DDE2EA` | `221, 226, 234` | Hairline dividers and web-only outlines; not a default iOS container treatment. |
| `borderStrong` | `#BCC5D2` | `188, 197, 210` | Selected outlines where fill cannot communicate state, such as palette swatches. |
| `controlBorder` | `#7D8797` | `125, 135, 151` | Essential web input/control boundary; 3.63:1 against white. |
| `textPrimary` | `#111827` | `17, 24, 39` | Main text and values; 16.39:1 on `background`. |
| `textSecondary` | `#667085` | `102, 112, 133` | Supporting text; 4.97:1 on white `surface`. |
| `textMuted` | `#667085` | `102, 112, 133` | Tertiary text; use state/opacity separately rather than a paler inaccessible grey. |
| `accent` | `#F45D43` | `244, 93, 67` | Primary action, active timer and selected navigation. |
| `accentText` | `#B73A26` | `183, 58, 38` | Small accent foreground; 5.76:1 on white and 4.87:1 on `accentSoft`. |
| `accentStrong` | `#F45D43` | `244, 93, 67` | Compatibility alias for existing consumers; new UI should use `accent`. |
| `accentHover` | `#E85038` | `232, 80, 56` | Pointer hover state. |
| `accentPressed` | `#E9523B` | `233, 82, 59` | Accessibility-adjusted pressed fill; 4.84:1 with `onAccent`. |
| `accentSoft` | `#FFE7E1` | `255, 231, 225` | Low-emphasis selected background. |
| `onAccent` | `#111827` | `17, 24, 39` | Text/icons on coral; 5.49:1 on `accent`. |
| `focus` | `#2563EB` | `37, 99, 235` | Keyboard focus. Field-like controls change one reserved 2 px perimeter in place; standalone actions use one 2 px offset ring. |
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

Palette keys are storage and API compatibility values. Never rename them or replace stored keys with display HEX values. `lime` intentionally displays as Mint in Midnight Core. Legacy HEX values continue to resolve to their existing keys.

| Stable key | Display name | Dark HEX / RGB | Light HEX / RGB |
| --- | --- | --- | --- |
| `lime` | Mint | `#3ED598` / `62, 213, 152` | `#23A65C` / `35, 166, 92` |
| `teal` | Teal | `#12B8B0` / `18, 184, 176` | `#008A83` / `0, 138, 131` |
| `sky` | Sky | `#71C5F4` / `113, 197, 244` | `#269ED1` / `38, 158, 209` |
| `blue` | Blue | `#416FE3` / `65, 111, 227` | `#3154C8` / `49, 84, 200` |
| `violet` | Violet | `#8D63E6` / `141, 99, 230` | `#7A45C7` / `122, 69, 199` |
| `rose` | Rose | `#DF5FA8` / `223, 95, 168` | `#C83C83` / `200, 60, 131` |
| `amber` | Amber | `#F2C14E` / `242, 193, 78` | `#C89100` / `200, 145, 0` |
| `orange` | Orange | `#D98235` / `217, 130, 53` | `#C7651A` / `199, 101, 26` |
| `red` | Coral | `#FF6248` / `255, 98, 72` | `#F45D43` / `244, 93, 67` |
| `steel` | Steel | `#9AA8BC` / `154, 168, 188` | `#738196` / `115, 129, 150` |
| `moss` | Moss | `#8FA84A` / `143, 168, 74` | `#6F8425` / `111, 132, 37` |
| `graphite` | Graphite | `#4C586C` / `76, 88, 108` | `#3E4859` / `62, 72, 89` |

The five lead chart colours are Coral, Violet, Amber, Mint and Blue. Preserve deterministic ordering in existing data logic. All 12 display colours must remain perceptually distinct in each appearance; the shared tests enforce a minimum pairwise OKLab distance while legacy display HEX values continue resolving to their stable keys. Category colour should normally appear as a dot, rail, border or chart mark beside `textPrimary`; do not assume palette colours are accessible body-text colours or fill bright blocks with white text without measuring contrast.

## Typography

The product UI uses system fonts. On iOS use San Francisco through React Native’s `System` family and favour its lighter regular/semi-bold hierarchy instead of uniformly heavy text. On web use the existing system-first stack: `-apple-system`, `BlinkMacSystemFont`, `"SF Pro Text"`, `"Segoe UI"`, sans-serif. Do not add Sofia Pro or another font dependency: the Dayframe wordmark is outline geometry and needs no font file.

| Role | Size | Weight | Line height | Letter spacing |
| --- | ---: | ---: | ---: | ---: |
| Screen title | 28–32 | 700–800 | 1.15–1.25 | `-0.02em` to `0` |
| Panel title | 17–20 | 700 | 1.25–1.35 | `-0.01em` to `0` |
| Body | 14–16 | 400–500 | 1.45–1.6 | `0` |
| Label | 11–13 | 600–700 | 1.3–1.45 | `0.01em` only for short labels |
| Button/navigation | 14–16 | 600–700 | 1.2–1.35 | `0` |
| Timer numerals | 28–36 mobile; larger where space permits on web | 700–800 | 1.0–1.15 | `-0.02em` |
| Report headline | 24–36 | 700–800 | 1.05–1.2 | `-0.02em` |

Use `font-variant-numeric: tabular-nums` on timers, durations, clock labels and report figures. Do not force monospace typography across the interface. Allow Dynamic Type to grow without clipping; labels may wrap before touch targets shrink.

## Supporting system

### Spacing and shape

Use the shared spacing scale `4, 8, 12, 16, 20, 24, 32`. Prefer 20–24 px/pt grouped surfaces, 14–18 compact cards and controls, and 24–28 floating navigation. Pills may be fully rounded. Keep interactive targets at least 44×44 px/pt.

Across signed-in web and iOS surfaces, icon-only buttons are circular and compact text buttons are pills. Avoid rounded-square button silhouettes. Separate panels from the canvas with `surface`/`surfaceRaised` fill, and use inset fills or hairline dividers for structure inside a panel.

### Borders, elevation and shadows

Borders are not the default grouping mechanism. Prefer canvas/surface contrast, inset fills and light internal dividers; reserve lines for semantic data structure, focus, validation, essential control boundaries, calendar grids and cases where fill cannot communicate state, such as a selected colour swatch. Reserve elevation for sheets, menus and floating navigation:

- dark: `0 12px 32px rgba(0, 0, 0, 0.32)`;
- light: `0 12px 28px rgba(17, 24, 39, 0.10)`.

Use platform equivalents on iOS. Avoid glow, heavy gradients and stacked shadows.

### Icons

Use Lucide on web and the established `react-native-svg` glyph style on mobile. Keep strokes, optical size and selected/muted colours consistent within each navigation group. Do not use Unicode characters as icon substitutes or add another icon package for a single glyph.

### Component states

- **Primary:** `accent` background with `onAccent` content; use `accentHover` and `accentPressed`; retain a readable disabled label.
- **Secondary:** on iOS use a `surfaceMuted` pill or circle with no outline; on web use `surface` or `surfaceInset` plus the shared focus ring.
- **Destructive:** `danger`, never primary coral; confirmation behaviour remains intact.
- **Inputs:** on iOS use `surfaceInset`/`surfaceMuted` fill and keyboard focus. On web reserve one stable 2 px field perimeter and change its colour in place on keyboard focus; compound fields give that perimeter to the wrapper with `focus-within`. Do not add a second halo. Placeholder text must remain readable.
- **Selection:** use a clearly differentiated fill plus selected-state semantics. Add a check or outline only when the fill and label are not sufficiently distinct; category pills do not need a redundant checkmark.
- **Loading/empty/error:** use consistent surfaces and plain, actionable copy. Never display raw native exceptions.

### Focus and accessibility

Meet WCAG AA where practical: 4.5:1 for normal text, 3:1 for large text and essential non-text UI boundaries. Every keyboard-operable web control needs a visible focus indicator. Focus must remain distinct from selection, validation and disabled state; focused invalid fields retain error copy and a separate internal danger cue. Preserve VoiceOver labels, selected-state announcements, 44 px/pt targets, safe areas, keyboard avoidance, Reduce Motion and Reduce Transparency fallbacks.

### Charts

Use the shared palette, `chartTrack`, stable segment ordering and exact value labels. Donuts retain a centre total; bars retain text values. Handle zero totals and a single 100% segment explicitly. Colour is supplementary: legends, percentages, labels and state text carry the meaning.

### Motion

Motion is short, purposeful, and consistent across a complete interaction: approximately 120–220 ms for control feedback and 180–300 ms for panels or chart reveals. Use standard ease-out timing, avoid decorative looping motion, and provide a reduced-motion path that removes nonessential transitions without hiding state changes.

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
- System, Light and Dark appearances are checked without a wrong-tone flash.
- Web SVGs load at desktop and phone widths; iOS bundles exact SVG components.
- Typography remains system-first and no unlicensed font files are present.
- Focus, contrast, Dynamic Type, VoiceOver, Reduce Motion and Reduce Transparency are checked.
