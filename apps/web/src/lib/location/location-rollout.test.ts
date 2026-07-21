import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCATION_ROLLOUT_MODE,
  decideLocationRollout,
  getServerLocationRolloutMode,
  segmentStartedAfterSemanticCutover
} from "./location-rollout";

describe("location rollout", () => {
  it("defaults missing and invalid configuration to shadow", () => {
    expect(getServerLocationRolloutMode(undefined)).toBe(DEFAULT_LOCATION_ROLLOUT_MODE);
    expect(getServerLocationRolloutMode("v2")).toBe(DEFAULT_LOCATION_ROLLOUT_MODE);
  });

  it.each(["v1", "v2_shadow", "v2_review", "v2_enabled"] as const)(
    "accepts the supported server mode %s",
    (mode) => expect(getServerLocationRolloutMode(mode)).toBe(mode)
  );

  it("never emits V2 reviews in v1 or shadow", () => {
    expect(decideLocationRollout("v1", "v1").emitV2ReviewItems).toBe(false);
    expect(decideLocationRollout("v2_shadow", "v2_shadow").emitV2ReviewItems).toBe(false);
  });

  it("waits for the client to acknowledge a semantic mode", () => {
    expect(decideLocationRollout("v2_review", "v2_shadow")).toMatchObject({
      clientAcknowledgedMode: false,
      emitV2ReviewItems: false
    });
    expect(decideLocationRollout("v2_review", "v2_review", "2026-07-20T12:00:00.000Z")).toMatchObject({
      clientAcknowledgedMode: true,
      semanticCutoverAt: "2026-07-20T12:00:00.000Z",
      emitV2ReviewItems: true
    });
  });

  it("suppresses semantic output from a same-mode client without a cutover acknowledgement", () => {
    expect(decideLocationRollout("v2_review", "v2_review")).toMatchObject({
      clientAcknowledgedMode: true,
      semanticCutoverAt: null,
      emitV2ReviewItems: false
    });
  });

  it("lets a server downgrade suppress semantics from a stale client", () => {
    expect(decideLocationRollout("v2_shadow", "v2_review")).toMatchObject({
      clientAcknowledgedMode: false,
      emitV2ReviewItems: false
    });
  });

  it("does not backfill shadow-era segments when semantic mode is acknowledged", () => {
    const cutover = "2026-07-20T12:00:00.000Z";
    expect(segmentStartedAfterSemanticCutover("2026-07-20T11:59:59.999Z", cutover)).toBe(false);
    expect(segmentStartedAfterSemanticCutover(cutover, cutover)).toBe(true);
    expect(segmentStartedAfterSemanticCutover("2026-07-20T12:00:00.001Z", cutover)).toBe(true);
  });
});
