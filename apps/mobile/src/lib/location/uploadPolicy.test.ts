import { describe, expect, it } from "vitest";
import { locationUploadDisposition, partitionAcknowledgedEvidence } from "./uploadPolicy";

describe("location upload policy", () => {
  it("treats permanent schema failures as terminal so later evidence can proceed", () => {
    expect(locationUploadDisposition(400)).toBe("reject");
    expect(locationUploadDisposition(422)).toBe("reject");
    expect(locationUploadDisposition(500)).toBe("retry");
  });

  it("returns unacknowledged items to the retry path after a partial response", () => {
    expect(partitionAcknowledgedEvidence(["a", "b", "c"], ["a", "c"])).toEqual({
      acknowledgedIds: ["a", "c"],
      retryIds: ["b"]
    });
  });
});
