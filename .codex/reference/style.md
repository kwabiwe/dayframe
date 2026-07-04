# Style Guidelines

Use this when implementing visual UI.

## Product Feel

- Match the product domain rather than applying a generic landing-page aesthetic.
- Prefer restrained, readable interfaces for tools and dashboards.
- Use clear hierarchy, stable spacing, and predictable interactions.
- Avoid one-note palettes and decorative clutter.
- Dayframe should feel like a compact personal time tool, not a project-management or billing app.
- Mobile first screen should match the focused daily workflow: header, active timer, start task, compact category chips, and Today chart/summary.

## Dayframe Mobile UX Invariants

- Keep the dashboard for daily tracking only. Do not place Settings, logout, permission setup, or sync administration on the dashboard.
- Settings must be a separate pushed screen opened from a top-right settings/menu icon.
- Category chips must be compact, pill-shaped, color-coded, and safe inside phone-width dashboard layouts.
- The Today chart/summary is a core dashboard element and must not be pushed below settings or configuration content.
- Empty Today summaries should use a clean zero-state, not a fake 100% category slice.
- User-facing health copy should say "Health data" or "Apple Health".
- Theme changes for system/light/dark must apply immediately across mobile surfaces.
- Use icons consistently for small chrome/actions, with accessible labels; keep text buttons for clear task commands.

## Responsive Design

- Define stable dimensions for fixed-format UI such as boards, toolbars, tiles, counters, and icon buttons.
- Ensure text fits inside controls at mobile and desktop sizes.
- Check all primary screens at mobile, tablet, and desktop viewports.
- Check mobile dashboard and Settings at common simulator widths. No button, category chip, segmented control, permission row, or settings action may clip off-screen.

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
- [ ] Floating surfaces fit inside mobile viewports without horizontal scrolling or zooming.
- [ ] Visual assets render correctly if used.
- [ ] Mobile dashboard excludes sync/logout/permission clutter from primary chrome.
- [ ] Mobile dashboard order is header, active timer, start task, compact category chips, Today chart/summary.
- [ ] Today chart is visible before settings/configuration content.
- [ ] Category chips are compact, pill-shaped, color-coded, and do not overflow.
- [ ] Settings is a separate screen and all controls fit within phone width.
- [ ] Theme changes apply immediately across mobile UI.
