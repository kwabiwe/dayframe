// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  PENDING_TIMER_DETAILS_MAX_AGE_MS,
  clearPendingTimerDetails,
  fitsKeepalive,
  pendingTimerDetailsDecision,
  readPendingTimerDetails,
  writePendingTimerDetails,
  type PendingTimerDetails
} from "./timer-draft-store";

const draft = (description: string, categoryId = "focus") => ({ categoryId, description, tagNames: [] });
const record = (overrides: Partial<PendingTimerDetails> = {}): PendingTimerDetails => ({
  entryId: "entry-1",
  draft: draft("Fix bug more later"),
  bases: [draft("Fix bug more"), draft("Fix bug")],
  savedAt: Date.now(),
  ...overrides
});

beforeEach(() => window.localStorage.clear());

describe("pending timer details (Codex r1 on #539)", () => {
  it("applies over either copy it was based on, and only for the fields it edits", () => {
    expect(pendingTimerDetailsDecision(record(), draft("Fix bug more"))).toEqual({ kind: "apply", fields: ["description"] });
    expect(pendingTimerDetailsDecision(record(), draft("Fix bug"))).toEqual({ kind: "apply", fields: ["description"] });
    // Another device changed the activity only: the description edit still applies.
    expect(pendingTimerDetailsDecision(record(), draft("Fix bug", "write"))).toEqual({ kind: "apply", fields: ["description"] });
  });

  it("is saved once the server holds the text, and stale once something else replaced it", () => {
    expect(pendingTimerDetailsDecision(record(), draft("Fix bug more later"))).toEqual({ kind: "saved" });
    expect(pendingTimerDetailsDecision(record(), draft("Changed elsewhere"))).toEqual({ kind: "stale" });
  });

  it("round-trips, expires after a day and drops unreadable records", () => {
    writePendingTimerDetails(record());
    expect(readPendingTimerDetails()?.draft.description).toBe("Fix bug more later");
    expect(readPendingTimerDetails(Date.now() + PENDING_TIMER_DETAILS_MAX_AGE_MS + 1)).toBeNull();
    expect(window.localStorage.length).toBe(0);
    window.localStorage.setItem("dayframe:pending-timer-details", "{not json");
    expect(readPendingTimerDetails()).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it("a save clears only its own block's record, and only when it saved that exact text", () => {
    writePendingTimerDetails(record());
    clearPendingTimerDetails("entry-2");
    clearPendingTimerDetails("entry-1", draft("Fix bug more"));
    expect(readPendingTimerDetails()).not.toBeNull();
    clearPendingTimerDetails("entry-1", draft("Fix bug more later"));
    expect(readPendingTimerDetails()).toBeNull();
  });

  it("keeps keepalive bodies under the browser budget, counting encoded bytes", () => {
    expect(fitsKeepalive("x".repeat(60_000))).toBe(true);
    expect(fitsKeepalive("x".repeat(60_001))).toBe(false);
    expect(fitsKeepalive("é".repeat(30_001))).toBe(false);
  });
});
