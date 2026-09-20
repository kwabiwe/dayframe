import { describe, expect, it } from "vitest";
import {
  boundedJsonBatches,
  jsonParameterBytes,
  LocationReplayBatchError
} from "./location-replay-batching";

describe("bounded retained-replay JSON batches", () => {
  it("preserves order and flushes at the row boundary", () => {
    const batches = [...boundedJsonBatches(["a", "b", "c"], {
      operation: "protected_evidence_ids",
      maxItems: 2,
      maxBytes: 1024
    })];
    expect(batches).toEqual([["a", "b"], ["c"]]);
  });

  it("uses UTF-8 bytes rather than JavaScript character count", () => {
    const items = ["é".repeat(12), "漢".repeat(12), "a".repeat(12)];
    const batches = [...boundedJsonBatches(items, {
      operation: "lineage_links",
      maxItems: 10,
      maxBytes: jsonParameterBytes([items[1], items[2]])
    })];
    expect(batches).toEqual([[items[0]], [items[1], items[2]]]);
    expect(batches.every((batch) => jsonParameterBytes(batch) <= jsonParameterBytes([items[1], items[2]]))).toBe(true);
  });

  it("fails visibly when one row cannot fit instead of dropping it", () => {
    expect(() => [...boundedJsonBatches(["x".repeat(100)], {
      operation: "protected_evidence_ids",
      maxItems: 2,
      maxBytes: 16
    })]).toThrow(LocationReplayBatchError);
  });
});
