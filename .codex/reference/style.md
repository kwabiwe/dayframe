# Style Guidelines

Use this when implementing visual UI.

## Product Feel

- Match the product domain rather than applying a generic landing-page aesthetic.
- Prefer restrained, readable interfaces for tools and dashboards.
- Use clear hierarchy, stable spacing, and predictable interactions.
- Avoid one-note palettes and decorative clutter.
- Dayframe should feel like a compact personal time tool, not a project-management or billing app.
- Mobile first screen should match the simple dashboard sketch: logo, active timer, start task, Today summary.

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
- [ ] Floating surfaces fit inside mobile viewports without horizontal scrolling or zooming.
- [ ] Visual assets render correctly if used.
- [ ] Mobile dashboard excludes sync/logout/permission clutter from primary chrome.
