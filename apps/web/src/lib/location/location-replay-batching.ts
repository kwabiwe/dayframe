import { Buffer } from "node:buffer";

/** The only profile that may select the retained-replay scalability path. */
export const LOCATION_REPLAY_SCALABILITY_PROFILE = "review_scalability_v1" as const;
export type LocationReplayPersistenceProfile = typeof LOCATION_REPLAY_SCALABILITY_PROFILE;

/** Dedicated caps for retained-replay work. Shared segment/semantic caps stay at 250. */
export const LOCATION_PROTECTED_EVIDENCE_ID_BATCH_SIZE = 2_048;
export const LOCATION_PROTECTED_EVIDENCE_ID_PAYLOAD_MAX_BYTES = 512 * 1024;
export const LOCATION_LINEAGE_INSERT_BATCH_SIZE = 2_048;
export const LOCATION_LINEAGE_INSERT_PAYLOAD_MAX_BYTES = 1024 * 1024;

export class LocationReplayBatchError extends Error {
  constructor(
    readonly operation: "protected_evidence_ids" | "lineage_links",
    readonly maxItems: number,
    readonly maxBytes: number
  ) {
    super(`A ${operation} row cannot fit within the bounded replay batch.`);
    this.name = "LocationReplayBatchError";
  }
}

/** UTF-8 bytes of the exact JSON parameter representation sent to PostgreSQL. */
export function jsonParameterBytes(value: unknown) {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("Replay batch value is not JSON serializable.");
  return Buffer.byteLength(encoded, "utf8");
}

/**
 * Encodes one value using the same JSON-array rules as JSON.stringify(batch).
 * The brackets are removed from the one-item representation so the caller can
 * add separators and array brackets without serialising the growing batch.
 */
function jsonArrayItemBytes(value: unknown) {
  const encoded = JSON.stringify([value]);
  if (encoded === undefined) throw new TypeError("Replay batch value is not JSON serializable.");
  return Buffer.byteLength(encoded, "utf8") - 2;
}

/**
 * Yields ordered JSON batches without retaining the complete input or payload.
 * The single-row check happens before an earlier batch can be emitted.
 */
export function* boundedJsonBatches<T>(
  items: Iterable<T>,
  options: {
    operation: LocationReplayBatchError["operation"];
    maxItems: number;
    maxBytes: number;
  }
): Generator<T[], void, void> {
  if (!Number.isSafeInteger(options.maxItems) || options.maxItems < 1) {
    throw new RangeError("Replay batch item cap must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 2) {
    throw new RangeError("Replay batch byte cap must be at least two bytes.");
  }

  const batch: T[] = [];
  let arrayBytes = 2;
  for (const item of items) {
    const itemBytes = jsonArrayItemBytes(item);
    if (itemBytes + 2 > options.maxBytes) {
      throw new LocationReplayBatchError(options.operation, options.maxItems, options.maxBytes);
    }
    if (batch.length >= options.maxItems ||
        arrayBytes + itemBytes + (batch.length > 0 ? 1 : 0) > options.maxBytes) {
      yield batch.splice(0, batch.length);
      arrayBytes = 2;
    }
    batch.push(item);
    arrayBytes += itemBytes + (batch.length > 1 ? 1 : 0);
  }
  if (batch.length > 0) yield batch.splice(0, batch.length);
}
