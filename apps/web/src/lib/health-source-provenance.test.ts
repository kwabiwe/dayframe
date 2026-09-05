import { describe, expect, it } from "vitest";
import {
  decideHealthSourceRevision,
  healthSourceSampleIds,
  type PriorHealthSource,
} from "./health-source-provenance";
const prior = (
  overrides: Partial<PriorHealthSource> = {},
): PriorHealthSource => ({
  eventId: "prior",
  reviewStatus: "confirmed",
  sampleIds: ["native-sample"],
  timeEntryId: "original-entry",
  ...overrides,
});
describe("Health source decision preservation", () => {
  it("does not resurrect an explicitly ignored source on a bounded repair", () => {
    expect(
      decideHealthSourceRevision(
        "health_sleep_import",
        ["native-sample"],
        [prior({ reviewStatus: "ignored", timeEntryId: null })],
      ),
    ).toMatchObject({ kind: "ignored" });
  });
  it("does not recreate a previously confirmed but now unavailable entry or claim why it disappeared", () => {
    expect(
      decideHealthSourceRevision(
        "health_sleep_import",
        ["native-sample"],
        [prior({ timeEntryId: null })],
      ),
    ).toMatchObject({ kind: "resolution_unavailable" });
  });
  it("reuses a workout source's original entry without overwriting later user edits", () => {
    expect(
      decideHealthSourceRevision(
        "health_workout_import",
        ["native-sample"],
        [prior()],
      ),
    ).toMatchObject({
      kind: "existing_workout",
      timeEntryId: "original-entry",
    });
  });
  it("preserves Sleep's logical reconciliation for an existing source and new phase", () => {
    expect(
      decideHealthSourceRevision(
        "health_sleep_import",
        ["native-sample", "later-phase"],
        [prior()],
      ),
    ).toEqual({ kind: "none" });
  });
  it("requires review when new phases meet an ignored source or multiple prior entries", () => {
    expect(
      decideHealthSourceRevision(
        "health_sleep_import",
        ["native-sample", "new"],
        [prior({ reviewStatus: "ignored", timeEntryId: null })],
      ),
    ).toMatchObject({ kind: "needs_review" });
    expect(
      decideHealthSourceRevision(
        "health_workout_import",
        ["native-sample"],
        [prior(), prior({ eventId: "second", timeEntryId: "second-entry" })],
      ),
    ).toMatchObject({ kind: "needs_review" });
  });
  it("does not substitute loose overlap, a session fingerprint or truncated results for source identity", () => {
    expect(
      healthSourceSampleIds({ externalSampleId: "sleep-session-fingerprint" }),
    ).toEqual([]);
    expect(
      decideHealthSourceRevision(
        "health_sleep_import",
        ["different"],
        [prior()],
      ),
    ).toEqual({ kind: "none" });
    expect(
      decideHealthSourceRevision(
        "health_sleep_import",
        ["native-sample"],
        [prior()],
        true,
      ),
    ).toMatchObject({ kind: "needs_review" });
  });
  it("uses explicit canonical provenance covering an older unlinked revision", () => {
    expect(
      decideHealthSourceRevision(
        "health_sleep_import",
        ["native-sample"],
        [prior({ timeEntryId: null }), prior({ eventId: "linked" })],
      ),
    ).toEqual({ kind: "none" });
  });
});
