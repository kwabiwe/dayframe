export const EXPLICIT_TIMER_MUTATION_EVENT_TYPES = [
  "timer_start",
  "timer_stop",
  "timer_switch",
  "quick_action",
  "nfc_action",
  "shortcut_action"
] as const;

const explicitTimerMutationEventTypes = new Set<string>(
  EXPLICIT_TIMER_MUTATION_EVENT_TYPES
);

export function isExplicitTimerMutationEventType(type: string) {
  return explicitTimerMutationEventTypes.has(type);
}

