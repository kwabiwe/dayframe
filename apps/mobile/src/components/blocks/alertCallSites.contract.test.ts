import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * UIA-005 guard: destructive confirmations use `BlocksConfirmSheet` and notices use `BlocksToast`.
 * A system `Alert.alert` stays only for a hard failure the person must read (a save, start, stop or
 * delete that did not happen on this iPhone, a refresh or permission that failed) and for the few
 * notices listed as follow-ups below. A new call site fails this test until it is justified here.
 * Each entry is the call's first argument (its title) as written, in source order.
 */
const ALLOWED_ALERTS: Record<string, string[]> = {
  "app/place-editor.tsx": [
    '"Places"', // load failed (with Back)
    '"Current location"', // follow-up: location permission guidance
    '"Current location"', // current location failed
    '"Places"', // follow-up: form validation (move inline)
    '"Places"', // save failed
    '"Places"' // delete or archive failed
  ],
  "app/places.tsx": [
    // Load failed is the in-page Blocks state with Try again (staging feedback B2), not an alert.
    '"Places"' // ignore or forget failed (one call site since Codex r11 on #508)
  ],
  "app/review.tsx": [
    '"Review"', // bulk skip: some moments not saved on this iPhone
    '"Review"', // a held card's outbox check could not be read: not saved (Codex r3 on #582)
    '"Review"', // a Review change was not saved on this iPhone
    '"Edit"', // follow-up: validation inside the open entry sheet (a toast would sit under its modal)
    '"Edit"' // save failed
  ],
  "app/settings.tsx": [
    '"Unable to refresh Settings"',
    '"Apple Health"', // mapping save failed (the one Health mapping writer)
    '"Tracking notice"', // switch not saved
    '"Evening reminder"', // change failed
    '"Log trips automatically"', // switch not saved (PRD D19, A4)
    '"Your day"', // goal not saved
    '"Activities"', // restore failed
    '"Activities"', // pin failed
    '"Location suggestions"', // enable failed
    '"Location evidence"', // delete failed
    '"Apple Health"', // permission request failed
    '"Apple Health"', // sync failed
    '"Apple Health"', // preference save failed
    '"Apple Health"', // debug export failed
    '"Apple Health"', // follow-up: sleep permission guidance
    '"Apple Health"', // permission request failed
    '"Couldn\'t sign out"'
  ],
  "src/components/calendar/useCalendarCheckAnswers.ts": [
    '"Calendar"', // an answer to a "?" was not saved on this iPhone (location v4 step 14 part 3b)
    '"Calendar"' // an answer couldn't be registered behind a queued correction on this iPhone (Codex r7 on #610)
  ],
  "src/components/DayframeDashboard.tsx": [
    '"Unable to refresh Dayframe"',
    '"Unable to add time"',
    '"Time not added"',
    '"Block not started"',
    '"Block not started"',
    "errorTitle",
    '"Change not saved"',
    '"Block not stopped"',
    '"Stop needs attention"',
    'entries.length > 1 ? "Blocks not deleted" : "Block not deleted"',
    'currentIds.length > 1 ? "Blocks not deleted" : "Block not deleted"'
  ],
  "src/components/location/LocationReviewCorrectionEditor.tsx": [
    '"Place search"', // search failed
    '"Use map pin"' // follow-up: validation inside the correction editor
  ]
};

const mobileRoot = fileURLToPath(new URL("../../../", import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function alertTitles(source: string) {
  return [...source.matchAll(/Alert\.alert\(\s*([^\n,]+?),/g)].map((match) => match[1].trim());
}

describe("system alerts (UIA-005)", () => {
  it("are left only at the listed call sites", () => {
    const found: Record<string, string[]> = {};
    for (const file of [...sourceFiles(join(mobileRoot, "app")), ...sourceFiles(join(mobileRoot, "src"))]) {
      const titles = alertTitles(readFileSync(file, "utf8"));
      if (titles.length) found[relative(mobileRoot, file)] = titles;
    }
    expect(found).toEqual(ALLOWED_ALERTS);
  });

  it("never asks a destructive question with a system alert", () => {
    for (const file of [...sourceFiles(join(mobileRoot, "app")), ...sourceFiles(join(mobileRoot, "src"))]) {
      expect(readFileSync(file, "utf8"), relative(mobileRoot, file)).not.toMatch(/style:\s*"destructive"/);
    }
  });
});
