import { describe, expect, it } from "vitest";
import { ReviewPresentationRequestSchema } from "./reviewPresentation";

const windowRequest = {
  version: 1 as const,
  mode: "window" as const,
  timeZone: "Europe/London",
  window: {
    start: "2026-01-01T00:00:00.000Z",
    end: "2026-03-02T00:00:00.000Z"
  },
  today: {
    start: "2026-03-01T00:00:00.000Z",
    end: "2026-03-02T00:00:00.000Z"
  }
};

describe("ReviewPresentationRequestSchema", () => {
  it("accepts a bounded local-day window and applies the page default", () => {
    expect(ReviewPresentationRequestSchema.parse(windowRequest)).toMatchObject({
      ...windowRequest,
      limit: 100
    });
  });

  it("rejects non-IANA zones and bounds that do not align to local midnight", () => {
    expect(ReviewPresentationRequestSchema.safeParse({
      ...windowRequest,
      timeZone: "London"
    }).success).toBe(false);
    expect(ReviewPresentationRequestSchema.safeParse({
      ...windowRequest,
      today: {
        start: "2026-03-01T00:30:00.000Z",
        end: "2026-03-02T00:00:00.000Z"
      }
    }).success).toBe(false);
  });

  it("requires bounded unique lookup identities without accepting date bounds", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(ReviewPresentationRequestSchema.parse({
      version: 1,
      mode: "lookup",
      timeZone: "Europe/London",
      reviewItemIds: [id]
    })).toMatchObject({ mode: "lookup", reviewItemIds: [id], limit: 100 });
    expect(ReviewPresentationRequestSchema.safeParse({
      version: 1,
      mode: "lookup",
      timeZone: "Europe/London",
      reviewItemIds: [id, id]
    }).success).toBe(false);
    expect(ReviewPresentationRequestSchema.safeParse({
      version: 1,
      mode: "lookup",
      timeZone: "Europe/London",
      reviewItemIds: [id],
      window: windowRequest.window
    }).success).toBe(false);
  });
});
