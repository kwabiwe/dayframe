// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  PENDING_TIMER_DETAILS_MAX_AGE_MS,
  clearPendingTimerDetails,
  endPendingTimerDetailsSession,
  fitsKeepalive,
  pendingTimerDetailsDecision,
  pendingTimerDetailsGeneration,
  readPendingTimerDetails,
  writePendingTimerDetails,
  type PendingTimerDetails
} from "./timer-draft-store";

const owner = { userId: "user-1", workspaceId: "workspace-1" };

const draft = (description: string, categoryId = "focus") => ({ categoryId, description, tagNames: [] });
const record = (overrides: Partial<PendingTimerDetails> = {}): PendingTimerDetails => ({
  entryId: "entry-1",
  draft: draft("Fix bug more later"),
  bases: [draft("Fix bug more"), draft("Fix bug")],
  savedAt: Date.now(),
  ...overrides
});

beforeEach(() => window.sessionStorage.clear());

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

  it("round-trips per tab, expires after a day and drops unreadable records", () => {
    writePendingTimerDetails(owner, record(), pendingTimerDetailsGeneration());
    expect(Object.keys(window.localStorage).filter((key) => key.startsWith("dayframe:pending-timer-details"))).toEqual([]);
    expect(readPendingTimerDetails(owner, "entry-1")?.draft.description).toBe("Fix bug more later");
    expect(readPendingTimerDetails(owner, "entry-1", Date.now() + PENDING_TIMER_DETAILS_MAX_AGE_MS + 1)).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
    writePendingTimerDetails(owner, record(), pendingTimerDetailsGeneration());
    window.sessionStorage.setItem(window.sessionStorage.key(0)!, "{not json");
    expect(readPendingTimerDetails(owner, "entry-1")).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("is scoped by user, workspace and block: another owner or block never reads or clears it", () => {
    writePendingTimerDetails(owner, record(), pendingTimerDetailsGeneration());
    expect(readPendingTimerDetails({ ...owner, workspaceId: "workspace-2" }, "entry-1")).toBeNull();
    expect(readPendingTimerDetails({ ...owner, userId: "user-2" }, "entry-1")).toBeNull();
    expect(readPendingTimerDetails(owner, "entry-2")).toBeNull();
    clearPendingTimerDetails(owner, "entry-2");
    clearPendingTimerDetails({ ...owner, workspaceId: "workspace-2" }, "entry-1");
    expect(readPendingTimerDetails(owner, "entry-1")).not.toBeNull();
  });

  it("a save clears its block's record only when it saved that exact text", () => {
    writePendingTimerDetails(owner, record(), pendingTimerDetailsGeneration());
    clearPendingTimerDetails(owner, "entry-1", draft("Fix bug more"));
    expect(readPendingTimerDetails(owner, "entry-1")).not.toBeNull();
    clearPendingTimerDetails(owner, "entry-1", draft("Fix bug more later"));
    expect(readPendingTimerDetails(owner, "entry-1")).toBeNull();
  });

  it("ending the session removes every record and refuses writes made with the old token", () => {
    const token = pendingTimerDetailsGeneration();
    writePendingTimerDetails(owner, record(), token);
    writePendingTimerDetails(owner, record({ entryId: "entry-2" }), token);
    window.sessionStorage.setItem("unrelated", "kept");
    endPendingTimerDetailsSession();
    expect(window.sessionStorage.length).toBe(1);
    expect(writePendingTimerDetails(owner, record(), token)).toBe(false);
    expect(readPendingTimerDetails(owner, "entry-1")).toBeNull();
    expect(writePendingTimerDetails(owner, record(), pendingTimerDetailsGeneration())).toBe(true);
  });

  it("keeps keepalive bodies under the browser budget, counting encoded bytes", () => {
    expect(fitsKeepalive("x".repeat(60_000))).toBe(true);
    expect(fitsKeepalive("x".repeat(60_001))).toBe(false);
    expect(fitsKeepalive("é".repeat(30_001))).toBe(false);
  });
});
