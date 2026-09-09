import { describe, expect, it } from "vitest";
import { ReportSummaryRequestSchema } from "./reportSummary";
const start = "2026-09-09T00:00:00.000Z";
const end = "2026-09-10T00:00:00.000Z";
const good = { start, end, buckets: [{ key: "day", start, end }] };
describe("bounded aggregate request", () => {
  it("accepts a complete partition", () =>
    expect(ReportSummaryRequestSchema.safeParse(good).success).toBe(true));
  it.each([
    { ...good, start: "bad" },
    { ...good, end: start },
    { ...good, end: "2028-01-01T00:00:00Z" },
    { ...good, buckets: [] },
    { ...good, buckets: [good.buckets[0], good.buckets[0]] },
    { ...good, buckets: [{ key: "day", start: "2026-09-09T01:00:00Z", end }] },
    { ...good, buckets: Array.from({ length: 367 }, () => good.buckets[0]) },
    { ...good, workspaceId: "foreign" },
    { ...good, categories: ["foreign"] },
  ])(
    "rejects malformed, oversized, gapped, duplicate or untrusted input %#",
    (input) =>
      expect(ReportSummaryRequestSchema.safeParse(input).success).toBe(false),
  );
});
