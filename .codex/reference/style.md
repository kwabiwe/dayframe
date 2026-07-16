# Style Guidelines

Use this when implementing visual UI.

## Product Feel

- Match the product domain rather than applying a generic landing-page aesthetic.
- Prefer restrained, readable interfaces for tools and dashboards.
- Use clear hierarchy, stable spacing, and predictable interactions.
- Avoid one-note palettes and decorative clutter.
- Dayframe should feel like a compact personal time tool, not a project-management or billing app.
- Mobile first screen should match the simple dashboard sketch: logo, active timer, start task, Today summary.
- Use Midnight Core consistently: near-black midnight navy, layered neutral surfaces, compact controls, restrained elevation and coral primary/active states.
- Treat light mode as a designed neutral companion. Preserve the same hierarchy and semantic roles rather than mechanically inverting dark mode.
- Keep native navigation containers, Expo root views and screen content on the resolved theme canvas. During push, pop and swipe-back transitions, no default white window, rounded-card vignette or mismatched scene background should be visible.
- Keep system-first typography. Use tabular numerals for timers and report figures; do not reintroduce all-monospace UI typography.
- On iOS, prefer the current fill-led design language: canvas/surface/inset contrast, compact divider-based lists, circular icon-only actions, and pill text actions. Avoid outline-heavy rounded rectangles as the default container/control treatment.

## Brand Artwork

- `logos/dayframe-colour-logo-transparent.svg` and `logos/dayframe-wordmark-outlined.svg` are canonical.
- `logos/dayframe-wordmark-light.svg` is light artwork for dark surfaces; `logos/dayframe-wordmark-dark.svg` is dark artwork for light surfaces.
- Keep symbol and wordmark separate in reusable platform components. Preserve their geometry and aspect ratios.
- Never recolour the symbol, recreate the wordmark as text, apply filters, or flatten the lock-up into a reusable banner.
- A meaningful lock-up exposes one accessible Dayframe label. Decorative artwork exposes none.
- Use the symbol alone for favicons, app icons and spaces where the wordmark would render too small.
- Runtime copies under `apps/web/public/logos/` mirror root canonical/derived artwork and must not drift.
- Follow `docs/brand-style-guide.md` for minimum size, clear space, exact tokens and incorrect usage.

## Colour And Components

- Consume semantic theme tokens from `packages/shared`; do not scatter raw Midnight Core HEX values through route components.
- Preserve palette keys and deterministic category/chart mapping. `lime` remains the stored key even though its Midnight Core display name is Mint.
- Use coral for primary action and active state, `danger` for destructive action and category colours for data identity.
- Pair category colours with labels, dots, rails or borders. Never rely on colour alone or assume a palette colour is accessible body text.
- Use a 44 px/pt minimum interactive target and visible focus/selected states. Web may use 1 px borders for dense controls; iOS should prefer fill, spacing, and hairline dividers over default outlines.
- Use `surfaceInset` for inputs, `surfaceRaised` for floating surfaces and `chartTrack` behind chart data.
- Disabled controls retain readable labels and an obvious unavailable state; do not fade the whole control to near invisibility.

## Responsive Design

- Define stable dimensions for fixed-format UI such as boards, toolbars, tiles, counters, and icon buttons.
- Ensure text fits inside controls at mobile and desktop sizes.
- Check all primary screens at mobile, tablet, and desktop viewports.

## Mobile Floating Surfaces

- Never rely on desktop anchored popover placement on mobile.
- At small breakpoints, convert floating panels to mobile dialogs or bottom sheets.
- Panels must stay fully inside the viewport.
- Long content should scroll inside the panel, not force the page to zoom or pan sideways.
- Use consistent rounded corners, contrast, spacing, and readable font sizes.
- Touch targets should be at least 44px high/wide.
- Account management and logout must remain reachable when desktop sidebars or footers collapse.

## Review Checklist

- [ ] The UI is usable as the first screen, not just a marketing shell.
- [ ] Components align with the existing design system.
- [ ] Buttons, forms, tabs, menus, and toggles use familiar interaction patterns.
- [ ] Text does not overlap, clip, or overflow.
- [ ] iOS screens avoid outline-heavy rounded-rectangle clutter and use fill/divider hierarchy consistent with `docs/brand-style-guide.md`.
- [ ] Floating surfaces fit inside mobile viewports without horizontal scrolling or zooming.
- [ ] Visual assets render correctly if used.
- [ ] Canonical symbol geometry is unchanged and the correct wordmark tone is used for the resolved theme.
- [ ] Brand artwork has one accessible name or is fully decorative.
- [ ] No legacy PNG banner or unintended white logo rectangle remains in primary branding.
- [ ] Focus, text, icon, border and chart contrast remain legible in System, Light and Dark modes.
- [ ] Mobile dashboard excludes sync/logout/permission clutter from primary chrome.
