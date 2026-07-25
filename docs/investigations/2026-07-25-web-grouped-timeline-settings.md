# Web Grouped Timeline And Settings Follow-up

## Scope

This PR groups repeated Timeline List entries, adds exact occurrence expansion
and highlighting, brings the running timer's last-stop shortcut to web, aligns
Settings actions, removes the stray sidebar focus perimeter, and makes
Supabase email/password changes available inside Dayframe.

Grouping follows the shipped mobile history identity: normalized description
plus category. Descriptionless categorized entries group; truly blank
uncategorized entries remain individual.

## Interaction and motion contract

- Trigger: selecting a repeated group expands or collapses its occurrences;
  an `entry` URL parameter opens the containing group and highlights that row.
- Owner: `EntriesTable` owns expansion state and exact-entry focus; CSS owns
  the restrained occurrence entrance and chevron update.
- Entrance/update/exit: occurrences fade/translate into the existing table;
  the chevron rotates. Collapse removes the child rows in one React update.
- Surrounding layout: the table owns normal row reflow; no second animation
  layer or absolute placeholder changes its geometry.
- Interruption: repeated clicks deterministically toggle the same stable group
  key. URL changes target the latest exact entry.
- Async outcome: restart reuses the shell-owned atomic restart path and its
  existing rollback. Expansion itself has no async state.
- Accessibility: the disclosure exposes `aria-expanded`; exact rows use stable
  IDs; Reduced Motion removes translation/animation; all edit/delete actions
  remain available on individual expanded occurrences.

## Security

Provider mode is Supabase email/password authentication, not an external SSO
provider. Password change now requires the current password, signs in through
Supabase to establish a scoped user session, then calls the normal user
password-update API. Dayframe does not use a service-role/admin reset.

## Validation

- Focused grouping, profile API, Settings and existing Timeline/timer contracts.
- All workspace typechecks, lint, tests, optimized production build and brand
  checks.
- Browser matrix: Timeline List and Settings in Light, Dark and System at
  desktop, compact/zoom-equivalent and phone widths; keyboard and Reduced
  Motion included.
