import { z } from "zod";

export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";
export const DEMO_WORKSPACE_ID = "00000000-0000-4000-8000-000000000010";
export const DEFAULT_UNKNOWN_STAY_THRESHOLD_MINUTES = 20;

export const DAYFRAME_PALETTE = [
  { key: "lime", label: "Soft mint", hex: "#BFE8D9" },
  { key: "teal", label: "Seafoam", hex: "#84D8C9" },
  { key: "sky", label: "Powder blue", hex: "#8EC5F2" },
  { key: "blue", label: "Periwinkle", hex: "#7FA7E8" },
  { key: "violet", label: "Lavender", hex: "#B58EE8" },
  { key: "rose", label: "Blush", hex: "#E8A7BF" },
  { key: "amber", label: "Butter", hex: "#FFD979" },
  { key: "orange", label: "Apricot", hex: "#FF987D" },
  { key: "red", label: "Watermelon", hex: "#F0776B" },
  { key: "steel", label: "Aqua", hex: "#57CFC2" },
  { key: "moss", label: "Sage", hex: "#B7D99B" },
  { key: "graphite", label: "Ink", hex: "#1D2638" }
] as const;

export type DayframePaletteKey = (typeof DAYFRAME_PALETTE)[number]["key"];

export const DAYFRAME_THEME = {
  light: {
    background: "#F7F8F5",
    surface: "#FFFFFF",
    surfaceMuted: "#EEF4F1",
    surfaceInset: "#FBFCF8",
    border: "#DDE5DE",
    borderStrong: "#B8C9C0",
    textPrimary: "#171A2E",
    textSecondary: "#63706B",
    accent: "#2F766D",
    accentStrong: "#FF9A7D",
    success: "#347B68",
    warning: "#946B15",
    danger: "#B8504C"
  },
  dark: {
    background: "#111820",
    surface: "#172028",
    surfaceMuted: "#1E2A31",
    surfaceInset: "#121A21",
    border: "#34434A",
    borderStrong: "#52666A",
    textPrimary: "#F3F7F5",
    textSecondary: "#AAB8B2",
    accent: "#8AD7C4",
    accentStrong: "#FFAF95",
    success: "#80D2BF",
    warning: "#FFD46E",
    danger: "#EA7A73"
  }
} as const;

export const DEFAULT_PALETTE_KEY: DayframePaletteKey = "lime";

const legacyColorMap: Record<string, DayframePaletteKey> = {
  "#c6ff4a": "lime",
  "#16a34a": "lime",
  "#22c55e": "lime",
  "#0f766e": "teal",
  "#14b8a6": "teal",
  "#0891b2": "sky",
  "#94bff0": "sky",
  "#2563eb": "blue",
  "#1d4ed8": "blue",
  "#82a8e8": "blue",
  "#7c3aed": "violet",
  "#9333ea": "violet",
  "#b691e6": "violet",
  "#db2777": "rose",
  "#e7a6bc": "rose",
  "#f59e0b": "amber",
  "#ffd46e": "amber",
  "#ea580c": "orange",
  "#ff9a7d": "orange",
  "#dc2626": "red",
  "#ea7a73": "red",
  "#64748b": "steel",
  "#dce1e6": "steel",
  "#475569": "graphite"
};

export function isPaletteKey(value: unknown): value is DayframePaletteKey {
  return typeof value === "string" && DAYFRAME_PALETTE.some((color) => color.key === value);
}

export function paletteKeyFor(value: unknown, fallbackSeed = ""): DayframePaletteKey {
  if (isPaletteKey(value)) return value;

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();
    const legacyKey = legacyColorMap[normalizedValue];
    if (legacyKey) return legacyKey;

    const paletteColor = DAYFRAME_PALETTE.find(
      (color) => color.hex.toLowerCase() === normalizedValue
    );
    if (paletteColor) return paletteColor.key;
  }

  return DAYFRAME_PALETTE[deterministicPaletteIndex(String(value ?? fallbackSeed))].key;
}

export function normalizePaletteKey(value: unknown, fallbackSeed = ""): DayframePaletteKey {
  return paletteKeyFor(value, fallbackSeed);
}

export function paletteColorFor(value: unknown, fallbackSeed = "") {
  const key = paletteKeyFor(value, fallbackSeed);
  return DAYFRAME_PALETTE.find((color) => color.key === key)?.hex ?? DAYFRAME_PALETTE[0].hex;
}

export function deterministicPaletteIndex(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash % DAYFRAME_PALETTE.length;
}

export const EventSourceSchema = z.enum([
  "manual_app",
  "mobile_app",
  "nfc",
  "widget",
  "shortcut",
  "geofence_specific",
  "geofence_broad",
  "calendar",
  "health_sleep",
  "health_workout",
  "home_assistant",
  "ha_button",
  "ha_geofence"
]);

export const ConfidenceSchema = z.enum([
  "high",
  "medium_high",
  "medium",
  "low",
  "hint"
]);

export const ReviewStatusSchema = z.enum([
  "confirmed",
  "needs_review",
  "accepted",
  "ignored"
]);

export const SleepStageSchema = z.enum([
  "in_bed",
  "asleep_unspecified",
  "asleep_core",
  "asleep_deep",
  "asleep_rem",
  "awake"
]);

export const ActivityEventTypeSchema = z.enum([
  "timer_start",
  "timer_stop",
  "timer_switch",
  "quick_action",
  "geofence_enter",
  "geofence_exit",
  "unknown_stay",
  "nfc_action",
  "shortcut_action",
  "calendar_hint",
  "health_sleep_import",
  "health_workout_import"
]);

export const AutomationActionSchema = z.enum([
  "start_timer",
  "suggest_timer",
  "create_review_item",
  "stop_timer",
  "ignore_source"
]);

export const ActivityEventInputSchema = z.object({
  source: EventSourceSchema,
  type: ActivityEventTypeSchema,
  occurredAt: z.coerce.date(),
  workspaceId: z.string().uuid().default(DEMO_WORKSPACE_ID),
  userId: z.string().uuid().default(DEMO_USER_ID),
  deviceId: z.string().uuid().optional(),
  clientEventId: z.string().trim().min(1).max(160).optional(),
  projectId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  placeId: z.string().uuid().optional(),
  description: z.string().trim().optional(),
  rawPayload: z.record(z.string(), z.unknown()).default({})
});

export type EventSource = z.infer<typeof EventSourceSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;
export type SleepStage = z.infer<typeof SleepStageSchema>;
export type ActivityEventType = z.infer<typeof ActivityEventTypeSchema>;
export type AutomationAction = z.infer<typeof AutomationActionSchema>;
export type ActivityEventInput = z.input<typeof ActivityEventInputSchema>;
type ParsedActivityEvent = z.output<typeof ActivityEventInputSchema>;

const healthKitSleepStages: Record<number | string, SleepStage> = {
  0: "in_bed",
  1: "asleep_unspecified",
  2: "awake",
  3: "asleep_core",
  4: "asleep_deep",
  5: "asleep_rem",
  inBed: "in_bed",
  asleep: "asleep_unspecified",
  asleepUnspecified: "asleep_unspecified",
  awake: "awake",
  asleepCore: "asleep_core",
  asleepDeep: "asleep_deep",
  asleepREM: "asleep_rem",
  HKCategoryValueSleepAnalysisInBed: "in_bed",
  HKCategoryValueSleepAnalysisAsleep: "asleep_unspecified",
  HKCategoryValueSleepAnalysisAsleepUnspecified: "asleep_unspecified",
  HKCategoryValueSleepAnalysisAwake: "awake",
  HKCategoryValueSleepAnalysisAsleepCore: "asleep_core",
  HKCategoryValueSleepAnalysisAsleepDeep: "asleep_deep",
  HKCategoryValueSleepAnalysisAsleepREM: "asleep_rem"
};

export function mapHealthKitSleepStage(value: unknown): SleepStage {
  if (typeof value === "number" || typeof value === "string") {
    return healthKitSleepStages[value] ?? "asleep_unspecified";
  }

  return "asleep_unspecified";
}

export type ProjectSummary = {
  id: string;
  name: string;
  clientId?: string | null;
  categoryId?: string | null;
};

export type CategorySummary = {
  id: string;
  name: string;
  color?: string | null;
  isPinned?: boolean;
};

export type PlaceSummary = {
  id: string;
  name: string;
  radiusMeters: number;
  priority: number;
  defaultProjectId?: string | null;
  defaultCategoryId?: string | null;
  autoStart: boolean;
};

export type AutomationRuleSummary = {
  id: string;
  name: string;
  triggerSource: EventSource;
  triggerType: ActivityEventType;
  placeId?: string | null;
  action: AutomationAction;
  projectId?: string | null;
  categoryId?: string | null;
  enabled: boolean;
};

export type NormalizationContext = {
  projects: ProjectSummary[];
  categories: CategorySummary[];
  places: PlaceSummary[];
  automationRules: AutomationRuleSummary[];
  unknownStayThresholdMinutes?: number;
};

export type CandidateActivity = {
  action: AutomationAction | "record_only";
  confidence: Confidence;
  reviewStatus: ReviewStatus;
  projectId?: string;
  categoryId?: string;
  placeId?: string;
  title: string;
  reason: string;
  shouldClosePrevious: boolean;
};

export type RunningEntry = {
  id: string;
  projectId?: string;
  categoryId?: string;
  placeId?: string;
  source: EventSource;
  confidence: Confidence;
  startedAt: Date;
  stoppedAt?: Date;
  description?: string;
};

export type ReviewCandidate = {
  id: string;
  eventType: ActivityEventType;
  title: string;
  confidence: Confidence;
  projectId?: string;
  categoryId?: string;
  placeId?: string;
  occurredAt: Date;
};

export type TimelineState = {
  activeEntry?: RunningEntry;
  completedEntries: RunningEntry[];
  reviewItems: ReviewCandidate[];
};

const explicitStartTypes = new Set<ActivityEventType>([
  "timer_start",
  "timer_switch",
  "quick_action",
  "nfc_action",
  "shortcut_action"
]);

export function confidenceForSource(source: EventSource): Confidence {
  switch (source) {
    case "manual_app":
    case "mobile_app":
    case "nfc":
    case "widget":
    case "shortcut":
    case "health_sleep":
    case "health_workout":
    case "ha_button":
      return "high";
    case "ha_geofence":
    case "geofence_specific":
      return "medium_high";
    case "home_assistant":
    case "geofence_broad":
      return "low";
    case "calendar":
      return "hint";
  }
}

export function normalizeActivityEvent(
  eventInput: ActivityEventInput,
  context: NormalizationContext
): CandidateActivity {
  const event = ActivityEventInputSchema.parse(eventInput);
  const sourceConfidence = confidenceForSource(event.source);
  const place = event.placeId
    ? context.places.find((candidate) => candidate.id === event.placeId)
    : findPlaceByName(context.places, event.rawPayload.placeName);
  const project = event.projectId
    ? context.projects.find((candidate) => candidate.id === event.projectId)
    : undefined;
  const matchingRule = findMatchingRule(event, place, context.automationRules);

  if (event.type === "timer_stop") {
    return {
      action: "stop_timer",
      confidence: sourceConfidence,
      reviewStatus: "confirmed",
      title: "Stop current timer",
      reason: "Explicit stop actions close the active primary timer.",
      shouldClosePrevious: false
    };
  }

  if (matchingRule?.enabled && matchingRule.action === "ignore_source") {
    return {
      action: "record_only",
      confidence: sourceConfidence,
      reviewStatus: "confirmed",
      title: event.description ?? "Ignored activity signal",
      reason: "An enabled ignore rule suppresses future review items for this source.",
      shouldClosePrevious: false
    };
  }

  if (explicitStartTypes.has(event.type)) {
    const projectId = event.projectId ?? matchingRule?.projectId ?? project?.id;
    return {
      action: "start_timer",
      confidence: sourceConfidence,
      reviewStatus: "confirmed",
      projectId,
      categoryId: event.categoryId ?? matchingRule?.categoryId ?? project?.categoryId ?? undefined,
      placeId: event.placeId ?? place?.id,
      title: event.description ?? project?.name ?? "Timer started",
      reason: "Manual, NFC, widget and shortcut signals are treated as high-confidence explicit starts.",
      shouldClosePrevious: true
    };
  }

  if (event.type === "geofence_enter") {
    const broadPlace = event.source === "geofence_broad" || Boolean(event.rawPayload.isBroad);
    const isHome = place?.name.toLowerCase() === "home";
    const projectId = matchingRule?.projectId ?? place?.defaultProjectId ?? undefined;
    const categoryId = matchingRule?.categoryId ?? place?.defaultCategoryId ?? undefined;

    if (matchingRule?.enabled && matchingRule.action === "start_timer" && !isHome) {
      return {
        action: "start_timer",
        confidence: "medium_high",
        reviewStatus: "confirmed",
        projectId,
        categoryId,
        placeId: place?.id,
        title: `Entered ${place?.name ?? "known place"}`,
        reason: "An enabled automation rule converted this geofence signal into a timer start.",
        shouldClosePrevious: true
      };
    }

    if (matchingRule?.enabled && matchingRule.action === "suggest_timer") {
      return {
        action: "suggest_timer",
        confidence: broadPlace ? "low" : "medium_high",
        reviewStatus: "needs_review",
        projectId,
        categoryId,
        placeId: place?.id,
        title: `Review ${place?.name ?? "place"} activity`,
        reason: "The matching automation rule asks Dayframe to suggest instead of auto-start.",
        shouldClosePrevious: false
      };
    }

    return {
      action: "create_review_item",
      confidence: broadPlace || isHome ? "low" : "medium_high",
      reviewStatus: "needs_review",
      projectId,
      categoryId,
      placeId: place?.id,
      title: `Review ${place?.name ?? "unknown place"} visit`,
      reason: isHome
        ? "Home is intentionally ambiguous and never auto-starts by default."
        : broadPlace
          ? "Broad geofences create review items unless the user creates a stricter rule."
          : "Specific places without an auto-start rule are reviewed first.",
      shouldClosePrevious: false
    };
  }

  if (event.type === "geofence_exit") {
    const broadPlace = event.source === "geofence_broad" || event.source === "ha_geofence" || Boolean(event.rawPayload.isBroad);
    const isHome = place?.name.toLowerCase() === "home";
    const projectId = matchingRule?.projectId ?? place?.defaultProjectId ?? undefined;
    const categoryId = matchingRule?.categoryId ?? place?.defaultCategoryId ?? undefined;

    if (matchingRule?.enabled && matchingRule.action === "stop_timer" && !broadPlace && !isHome) {
      return {
        action: "stop_timer",
        confidence: "medium_high",
        reviewStatus: "confirmed",
        projectId,
        categoryId,
        placeId: place?.id,
        title: `Left ${place?.name ?? "known place"}`,
        reason: "An enabled automation rule converted this geofence exit into a timer stop.",
        shouldClosePrevious: false
      };
    }

    return {
      action: "create_review_item",
      confidence: broadPlace || isHome ? "low" : "medium_high",
      reviewStatus: "needs_review",
      projectId,
      categoryId,
      placeId: place?.id,
      title: `Review ${place?.name ?? "place"} exit`,
      reason: broadPlace
        ? "Broad geofence exits are reviewed before Dayframe closes or creates a stay."
        : isHome
          ? "Home exits are ambiguous and stay review-first by default."
          : "Specific geofence exits can stop a timer when the user adds a stop rule.",
      shouldClosePrevious: false
    };
  }

  if (event.type === "unknown_stay") {
    const durationMinutes = Number(event.rawPayload.durationMinutes ?? 0);
    const threshold = context.unknownStayThresholdMinutes ?? DEFAULT_UNKNOWN_STAY_THRESHOLD_MINUTES;
    return {
      action: durationMinutes >= threshold ? "create_review_item" : "record_only",
      confidence: "low",
      reviewStatus: durationMinutes >= threshold ? "needs_review" : "confirmed",
      title: durationMinutes >= threshold ? "Review unknown stay" : "Record short unknown stay",
      reason:
        durationMinutes >= threshold
          ? "Unknown stays longer than the configured threshold need human review."
          : "Short unknown stays are retained as raw events only.",
      shouldClosePrevious: false
    };
  }

  if (event.type === "calendar_hint") {
    return {
      action: "create_review_item",
      confidence: "hint",
      reviewStatus: "needs_review",
      title: event.description ?? "Review calendar hint",
      reason: "Calendar entries are hints until a person confirms the mapping.",
      shouldClosePrevious: false
    };
  }

  if (event.type === "health_sleep_import" || event.type === "health_workout_import") {
    return {
      action: "create_review_item",
      confidence: "high",
      reviewStatus: "needs_review",
      projectId: event.projectId,
      categoryId: event.categoryId,
      title: event.description ?? "Review health import",
      reason: "Health integrations are stubbed in v1 and route through review before entry creation.",
      shouldClosePrevious: false
    };
  }

  return {
    action: "record_only",
    confidence: sourceConfidence,
    reviewStatus: "confirmed",
    title: event.description ?? "Recorded activity event",
    reason: "No conversion rule matched this event.",
    shouldClosePrevious: false
  };
}

export function applyActivityEvent(
  state: TimelineState,
  eventInput: ActivityEventInput,
  context: NormalizationContext
): TimelineState {
  const event = ActivityEventInputSchema.parse(eventInput);
  const candidate = normalizeActivityEvent(event, context);
  const next: TimelineState = {
    activeEntry: state.activeEntry ? { ...state.activeEntry } : undefined,
    completedEntries: [...state.completedEntries],
    reviewItems: [...state.reviewItems]
  };

  if (candidate.action === "stop_timer" && next.activeEntry) {
    next.completedEntries.push({ ...next.activeEntry, stoppedAt: event.occurredAt });
    next.activeEntry = undefined;
    return next;
  }

  if (candidate.action === "start_timer") {
    if (candidate.shouldClosePrevious && next.activeEntry) {
      next.completedEntries.push({ ...next.activeEntry, stoppedAt: event.occurredAt });
    }

    next.activeEntry = {
      id: `entry-${event.occurredAt.getTime()}`,
      projectId: candidate.projectId,
      categoryId: candidate.categoryId,
      placeId: candidate.placeId,
      source: event.source,
      confidence: candidate.confidence,
      startedAt: event.occurredAt,
      description: event.description
    };
    return next;
  }

  if (candidate.reviewStatus === "needs_review") {
    next.reviewItems.push(toReviewCandidate(event, candidate));
  }

  return next;
}

function findMatchingRule(
  event: ParsedActivityEvent,
  place: PlaceSummary | undefined,
  rules: AutomationRuleSummary[]
) {
  return rules.find((rule) => {
    if (!rule.enabled) return false;
    if (rule.triggerSource !== event.source) return false;
    if (rule.triggerType !== event.type) return false;
    if (rule.placeId && rule.placeId !== place?.id && rule.placeId !== event.placeId) return false;
    return true;
  });
}

function findPlaceByName(places: PlaceSummary[], value: unknown) {
  if (typeof value !== "string") return undefined;
  return places.find((place) => place.name.toLowerCase() === value.toLowerCase());
}

function toReviewCandidate(
  event: ParsedActivityEvent,
  candidate: CandidateActivity
): ReviewCandidate {
  return {
    id: `review-${event.occurredAt.getTime()}`,
    eventType: event.type,
    title: candidate.title,
    confidence: candidate.confidence,
    projectId: candidate.projectId,
    categoryId: candidate.categoryId,
    placeId: candidate.placeId,
    occurredAt: event.occurredAt
  };
}
