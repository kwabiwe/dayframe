import {
  LocationRolloutModeSchema,
  type LocationRolloutMode
} from "@dayframe/shared";

export const DEFAULT_LOCATION_ROLLOUT_MODE: LocationRolloutMode = "v2_shadow";

export function getServerLocationRolloutMode(
  configuredValue = process.env.DAYFRAME_LOCATION_ROLLOUT_MODE
): LocationRolloutMode {
  const parsed = LocationRolloutModeSchema.safeParse(configuredValue?.trim());
  return parsed.success ? parsed.data : DEFAULT_LOCATION_ROLLOUT_MODE;
}

export type LocationRolloutDecision = {
  effectiveMode: LocationRolloutMode;
  clientAcknowledgedMode: boolean;
  semanticCutoverAt: string | null;
  emitV2ReviewItems: boolean;
};

export function decideLocationRollout(
  effectiveMode: LocationRolloutMode,
  requestedMode: LocationRolloutMode,
  semanticModeAcknowledgedAt?: string
): LocationRolloutDecision {
  const clientAcknowledgedMode = requestedMode === effectiveMode;
  const semanticMode = effectiveMode === "v2_review" || effectiveMode === "v2_enabled";
  const semanticCutoverAt = clientAcknowledgedMode && semanticMode
    ? semanticModeAcknowledgedAt ?? null
    : null;
  return {
    effectiveMode,
    clientAcknowledgedMode,
    semanticCutoverAt,
    // A client acknowledgement is a duplicate-prevention barrier, not an
    // authority check. Only the server mode can enable semantic V2 output.
    emitV2ReviewItems: semanticCutoverAt != null
  };
}

export function segmentStartedAfterSemanticCutover(
  segmentStartedAt: string,
  semanticCutoverAt: string
) {
  return Date.parse(segmentStartedAt) >= Date.parse(semanticCutoverAt);
}
