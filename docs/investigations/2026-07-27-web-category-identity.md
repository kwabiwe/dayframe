# Web Category Identity

## Problem

Two Dayframe Trello follow-ups exposed inconsistent category identity on web:

- an uncategorized Calendar entry used a plain block and the fallback title `Time entry`
- the Dashboard uncategorized marker was square while other category markers were circular
- coloured category markers retained a subtle grey border
- Timeline List grouped entries with the same category and description even when their tags differed

## Cause

- `timeEntryTitle()` used a generic final fallback instead of the existing category label helper.
- Calendar blocks did not expose their uncategorized state to CSS.
- marker borders and the Dashboard square override were applied locally rather than through one category-marker contract.
- `timelineEntryGroupKey()` omitted tags.

## Contract

- Blank uncategorized entries are titled `Uncategorized`.
- Uncategorized uses one neutral diagonal hatch on markers and Calendar blocks.
- Category identity markers are circular. Named category colours are borderless; only Uncategorized retains a neutral outline.
- Timeline groups require the same normalized category, description, and canonical tag set.
- Tag order, case, surrounding whitespace, and duplicates do not split an otherwise identical group.
- Truly blank uncategorized entries remain individual.

## Motion

No motion changes. Rendering, grouping, focus, selection, resize, overlap, and restart ownership remain unchanged.

## Validation

- display helper tests
- Timeline grouping tests for different, reordered, duplicated, tagged, and untagged sets
- source/CSS category identity contract
- web typecheck, full workspace tests, lint, production build, brand checks, and diff check
- deployed Preview and production browser smoke checks; local navigation was blocked by the browser controller's loopback/LAN policy
