# Location quality harness

Location v4 step 1 (PRD D21). A local tool that replays the shared location engine over a period of
evidence and scores the result against a Google Timeline export used as the answer key. It runs on the
owner's Mac only.

## Privacy

- The answer key, the evidence and place rows, saved runs and score files are private. The CLI refuses
  any of them inside this repository, so they cannot be committed by accident.
- Evidence and place rows are relative metres (east/north of an arbitrary origin); replay projects them
  around a synthetic origin latitude (45° by default). Saved runs and reports hold times, counts, metres
  and anonymous place labels (`P4`) only: no names, addresses or coordinates.
- Tests use the synthetic Exampleton day in `test/exampleton.ts`. Never copy a real export, real times or
  real place details into a test, PR or chat.

## Running it

```bash
npm run score:location -- \
  --answer-key <private>/Timeline.json \
  --rows <private>/week-rows.psv --places <private>/places.psv \
  --from 2026-10-15T12:00:00Z --to 2026-10-22T15:30:00Z --at 2026-10-22T15:45:00Z
```

- `--from`/`--to` set the scoring window; `--at` is the replay's processing time (default `--to`).
- `--segments <run.json>` scores a saved run instead of replaying; `--save-segments` writes one.
- `--engine <checkout>/packages/shared/src/location` replays another checkout's engine (a branch, or
  `git archive` of an older commit), so before and after can be scored on the same evidence.
- `--summary-json` writes the week and day scores; `--detail` lists each miss, phantom and boundary
  miss as local times and place labels.
- `--drop-motion`, `--drop-places P2,P5` and `--received-until <ISO>` replay what-ifs.

The row formats are documented in `src/evidenceRows.ts`.

## What it scores (design §13)

- **Answer key.** Google's top-level visits are places; the activities between two visits are one trip,
  and each activity a leg (same-mode neighbours merge). An activity of 30 minutes or more averaging under
  0.3 m/s fills a gap Google could not see, so its minutes, any trip containing it and any boundary within
  two minutes of it are left out ("answer key unsure").
- **Kind.** Of the minutes the key is sure about, the share where the engine has the same kind (Stay or
  Move), plus coverage (any segment at all).
- **Places.** Stays of 10 minutes or more matched one-to-one by overlap: recall, precision (an engine
  stay is real when half its sure time is in key stays), phantoms, splits and Home.
- **Boundaries.** Start and end error of matched stays; within 5 minutes counts as right.
- **Trips.** Found (one Move covers half of the shorter of the two, or Moves cover half the trip),
  phantom (under 30% overlap with key travel), start and end error (p90), legs and multi-leg trips.
- **Mode.** Per key travel minute, the engine's mode against Google's (fine) and its family (coarse).
- **Day score** = 30 × kind + 20 × places F1 + 15 × boundaries within 5 min + 15 × trips F1 + 20 × mode,
  per local day and for the whole window.
- **Bars.** Per kind, right/total with the 90% Wilson lower bound. A kind passes when the bound clears its
  bar over 28+ days with no 30-minute phantom or miss in the last 14 (PRD D21).

## Baseline

At main `411366c0` over 15 Oct 13:00 – 22 Oct 16:30 (London) the harness reproduces the design's
prototype exactly: week score 89 (kind 0.98 · stays 0.95 · bounds 0.93 · trips 0.96 · mode 0.58).
