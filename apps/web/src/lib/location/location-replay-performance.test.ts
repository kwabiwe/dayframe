import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const withSyncTransaction = vi.hoisted(() => vi.fn());
const replayLocationEvidence = vi.hoisted(() => vi.fn());

vi.mock("../sync-transaction", () => ({ withSyncTransaction }));
vi.mock("./location-replay-service", () => ({ replayLocationEvidence }));

const { replayRetainedLocationEvidence } = await import("./location-ingest-service");

const requestFor = (rolloutMode: "v2_shadow" | "v2_review" | "v2_enabled") => ({
  deviceId: "performance-test-device",
  algorithmVersion: "location-v2.0",
  rolloutMode,
  semanticModeAcknowledgedAt: "2026-09-17T10:00:00.000Z"
});

describe("Location replay timeout configuration routing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    replayLocationEvidence.mockResolvedValue({
      segments: [],
      stayIds: new Map(),
      commuteIds: new Map(),
      evidenceIds: new Map(),
      diagnostics: { warningCodes: [] }
    });
    withSyncTransaction.mockImplementation(async (_operation: string, work: (transaction: unknown) => Promise<unknown>) => {
      return work({
        client: { query: vi.fn().mockResolvedValue({ rows: [] }) },
        phase: vi.fn(),
        remainingMs: () => 7_000
      });
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["v2_review", true],
    ["v2_shadow", false],
    ["v2_enabled", false]
  ] as const)("opts in only for the server-effective %s retained replay", async (rolloutMode, expected) => {
    vi.stubEnv("DAYFRAME_LOCATION_ROLLOUT_MODE", rolloutMode);
    await replayRetainedLocationEvidence(
      requestFor(rolloutMode),
      { workspaceId: "workspace", userId: "user", authMode: "token", scopes: [] },
      "2026-09-17T10:00:01.000Z"
    );

    const options = withSyncTransaction.mock.calls[0]?.[2] as { reuseFullCapTimeoutPair?: boolean };
    expect(options.reuseFullCapTimeoutPair).toBe(expected);
    const replayOptions = replayLocationEvidence.mock.calls[0]?.[2] as { persistenceProfile?: string };
    expect(replayOptions.persistenceProfile).toBe(expected ? "review_scalability_v1" : undefined);
  });

  it("uses the server-effective mode rather than a client mode request", async () => {
    vi.stubEnv("DAYFRAME_LOCATION_ROLLOUT_MODE", "v2_review");
    await replayRetainedLocationEvidence(
      requestFor("v2_shadow"),
      { workspaceId: "workspace", userId: "user", authMode: "token", scopes: [] },
      "2026-09-17T10:00:01.000Z"
    );

    const options = withSyncTransaction.mock.calls[0]?.[2] as { reuseFullCapTimeoutPair?: boolean };
    expect(options.reuseFullCapTimeoutPair).toBe(true);
  });
});
