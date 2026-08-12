import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  replayRetainedLocationEvidence: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: mocks.resolveRequestSession }));
vi.mock("@/lib/location/location-ingest-service", () => ({
  LOCATION_EVIDENCE_BODY_LIMIT_BYTES: 512 * 1024,
  LocationIngestError: class LocationIngestError extends Error {},
  replayRetainedLocationEvidence: mocks.replayRetainedLocationEvidence
}));

const { POST } = await import("./route");

describe("POST /api/location/replay", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.replayRetainedLocationEvidence.mockResolvedValue({
      ok: true,
      replayVersion: "location-v2.0",
      rolloutMode: "v2_review",
      clientAcknowledgedMode: true,
      finalisedSegmentCount: 2,
      semanticSegmentCount: 1,
      warnings: []
    });
  });

  it("authenticates before replaying retained evidence and returns private data", async () => {
    const body = {
      deviceId: "ios-device",
      algorithmVersion: "location-v2.0",
      rolloutMode: "v2_review",
      semanticModeAcknowledgedAt: "2026-08-11T12:00:00.000Z"
    };
    const response = await POST(new Request("https://dayframe.test/api/location/replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Authorization, Cookie");
    expect(mocks.resolveRequestSession).toHaveBeenCalledOnce();
    expect(mocks.replayRetainedLocationEvidence).toHaveBeenCalledWith(body, session);
  });

  it("rejects malformed JSON without calling the replay service", async () => {
    const response = await POST(new Request("https://dayframe.test/api/location/replay", {
      method: "POST",
      body: "{"
    }));

    expect(response.status).toBe(400);
    expect(mocks.resolveRequestSession).toHaveBeenCalledOnce();
    expect(mocks.replayRetainedLocationEvidence).not.toHaveBeenCalled();
  });

  it("rejects an oversized body before authentication", async () => {
    const response = await POST(new Request("https://dayframe.test/api/location/replay", {
      method: "POST",
      headers: { "content-length": String(512 * 1024 + 1) },
      body: "{}"
    }));

    expect(response.status).toBe(413);
    expect(mocks.resolveRequestSession).not.toHaveBeenCalled();
    expect(mocks.replayRetainedLocationEvidence).not.toHaveBeenCalled();
  });

  it("keeps unexpected failures coordinate-free", async () => {
    mocks.replayRetainedLocationEvidence.mockRejectedValueOnce(new Error("database unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(new Request("https://dayframe.test/api/location/replay", {
      method: "POST",
      body: JSON.stringify({ deviceId: "ios-device" })
    }));

    expect(response.status).toBe(500);
    expect(errorSpy).toHaveBeenCalledWith(
      "Location replay failed without coordinate payloads",
      { name: "Error" }
    );
    errorSpy.mockRestore();
  });
});
