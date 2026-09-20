import { describe, expect, it } from "vitest";
import {
  boundedJsonBatches,
  jsonParameterBytes,
  LocationReplayBatchError
} from "./location-replay-batching";

describe("bounded retained-replay JSON batches", () => {
  it("preserves order and flushes at the item-count boundary", () => {
    const batches = [...boundedJsonBatches(["a", "b", "c"], {
      operation: "protected_evidence_ids",
      maxItems: 2,
      maxBytes: 1024
    })];
    expect(batches).toEqual([["a", "b"], ["c"]]);
  });

  it("accepts ASCII values at the exact byte boundary", () => {
    const items = ["a", "bb", "ccc"];
    const maxBytes = jsonParameterBytes(items.slice(0, 2));
    const batches = [...boundedJsonBatches(items, {
      operation: "lineage_links",
      maxItems: 10,
      maxBytes
    })];
    expect(batches).toEqual([["a", "bb"], ["ccc"]]);
    expect(batches.every((batch) => jsonParameterBytes(batch) <= maxBytes)).toBe(true);
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

  it("flushes the prior batch when one more item crosses the byte cap", () => {
    const items = ["a", "b"];
    const batches = [...boundedJsonBatches(items, {
      operation: "protected_evidence_ids",
      maxItems: 10,
      maxBytes: jsonParameterBytes([items[0]])
    })];
    expect(batches).toEqual([[items[0]], [items[1]]]);
    expect(batches.every((batch) => jsonParameterBytes(batch) <= jsonParameterBytes([items[0]]))).toBe(true);
  });

  it("keeps the actual JSON array representation within the byte cap", () => {
    const items = ["ascii", "é", "漢", "tail"];
    const maxBytes = jsonParameterBytes([items[0], items[1], items[2]]);
    const batches = [...boundedJsonBatches(items, {
      operation: "lineage_links",
      maxItems: 3,
      maxBytes
    })];
    expect(batches.flat()).toEqual(items);
    expect(batches.every((batch) => jsonParameterBytes(batch) <= maxBytes)).toBe(true);
  });

  it("fails visibly when one row cannot fit instead of dropping it", () => {
    expect(() => [...boundedJsonBatches(["x".repeat(100)], {
      operation: "protected_evidence_ids",
      maxItems: 2,
      maxBytes: 16
    })]).toThrow(LocationReplayBatchError);
  });
});
