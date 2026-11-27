import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  configureLocationTransaction,
  ingestLocationEvidence,
  LOCATION_INGEST_LOCK_TIMEOUT_MS,
  LOCATION_INGEST_STATEMENT_TIMEOUT_MS
} from "./location-ingest-service";

it("keeps an otherwise valid Location batch retryable when the semantic cutover is ahead of the server", async () => {
  const processingAt = "2026-01-02T12:00:00.000Z";
  const request = {
    clientBatchId: "retryable-batch",
    deviceId: "test-device",
    algorithmVersion: "location-v2.0",
    timeZone: "UTC",
    rolloutMode: "v2_review",
    semanticModeAcknowledgedAt: "2026-01-02T12:11:00.000Z",
    evidence: [{
      clientEvidenceId: "test-reading",
      kind: "significant_change",
      occurredAt: processingAt,
      receivedAt: processingAt,
      latitude: 0,
      longitude: 0,
      horizontalAccuracyMeters: 10,
      metadata: {}
    }]
  };

  await expect(ingestLocationEvidence(request, {
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
    authMode: "provider",
    scopes: ["events:write"]
  }, processingAt)).rejects.toMatchObject({
    status: 409,
    code: "invalid_semantic_mode_acknowledgement"
  });
});

describe("Location ingest transaction budgets", () => {
  it("bounds account-lock and statement waits below the request budget", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await configureLocationTransaction({ query } as never);

    expect(LOCATION_INGEST_LOCK_TIMEOUT_MS).toBeLessThan(LOCATION_INGEST_STATEMENT_TIMEOUT_MS);
    expect(LOCATION_INGEST_STATEMENT_TIMEOUT_MS).toBeLessThan(10_000);
    expect(query).toHaveBeenNthCalledWith(
      1,
      "select set_config('lock_timeout', $1, true)",
      ["1500ms"]
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      "select set_config('statement_timeout', $1, true)",
      ["8000ms"]
    );
  });

  it("stores upload batches without replaying the full retained evidence set", () => {
    const source = readFileSync(fileURLToPath(new URL("./location-ingest-service.ts", import.meta.url)), "utf8");
    const ingest = source.slice(
      source.indexOf("export async function ingestLocationEvidence"),
      source.indexOf("export async function replayRetainedLocationEvidence")
    );

    expect(ingest).not.toContain("replayAndEmitLocationSemantics(");
    expect(ingest).toContain("segmentIds: []");
  });
});
