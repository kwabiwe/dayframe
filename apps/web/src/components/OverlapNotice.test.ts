import { describe, expect, it } from "vitest";
import { overlapNoticeForCandidate } from "@/lib/overlap-notice";

const peers = [
  {
    id: "focus",
    startedAt: "2026-07-27T09:00:00.000Z",
    stoppedAt: "2026-07-27T10:00:00.000Z",
    description: "Focus"
  },
  {
    id: "walk",
    startedAt: "2026-07-27T09:30:00.000Z",
    stoppedAt: "2026-07-27T10:30:00.000Z",
    description: "Walk"
  }
];

describe("overlap notice analysis", () => {
  it("does not warn for a boundary touch", () => {
    const result = overlapNoticeForCandidate({
      candidate: {
        startedAt: "2026-07-27T10:30:00.000Z",
        stoppedAt: "2026-07-27T11:00:00.000Z"
      },
      entries: peers
    });

    expect(result).toMatchObject({ overlapCount: 0, uniqueOverlapSeconds: 0 });
  });

  it("reports unique overlap duration and stable peer IDs without blocking save", () => {
    const result = overlapNoticeForCandidate({
      candidate: {
        startedAt: "2026-07-27T09:45:00.000Z",
        stoppedAt: "2026-07-27T10:15:00.000Z"
      },
      entries: peers
    });

    expect(result).toMatchObject({
      overlapCount: 2,
      uniqueOverlapSeconds: 1_800,
      overlappingEntryIds: ["focus", "walk"]
    });
  });

  it("excludes the entry being edited", () => {
    const result = overlapNoticeForCandidate({
      candidate: {
        startedAt: peers[0].startedAt,
        stoppedAt: peers[0].stoppedAt
      },
      entries: peers,
      excludeEntryId: "focus"
    });

    expect(result).toMatchObject({
      overlapCount: 1,
      uniqueOverlapSeconds: 1_800,
      overlappingEntryIds: ["walk"]
    });
  });
});
