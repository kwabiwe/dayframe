import type { BootstrapData } from "@/lib/queries";

export const TIMER_SHORTCUT_EVENT = "dayframe-toggle-timer-shortcut";
export const TIMER_FOCUS_EVENT = "dayframe-focus-timer-input";

export type TimerShortcutEventDetail = {
  handled: boolean;
  action?: Promise<void>;
};

type ShortcutFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function toggleTimerFromFreshBootstrap({
  fallbackData,
  fetcher = fetch,
  focusTimerInput = dispatchTimerFocus,
  refresh,
  selectedDate,
  setData
}: {
  fallbackData: BootstrapData | null;
  fetcher?: ShortcutFetch;
  focusTimerInput?: () => void;
  refresh: () => Promise<void>;
  selectedDate: string;
  setData?: (data: BootstrapData) => void;
}) {
  const freshData = await fetchBootstrapData(selectedDate, fetcher);
  if (freshData) setData?.(freshData);
  const data = freshData ?? fallbackData;

  if (!data?.activeEntry) {
    focusTimerInput();
    return "focused" as const;
  }

  const response = await fetcher("/api/time-entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "stop" })
  });
  if (!response.ok) throw new Error(`Unable to stop timer: ${response.status}`);

  await refresh();
  return "stopped" as const;
}

async function fetchBootstrapData(selectedDate: string, fetcher: ShortcutFetch) {
  const response = await fetcher(`/api/bootstrap?date=${selectedDate}`, { cache: "no-store" });
  if (!response.ok) return null;
  return (await response.json()) as BootstrapData;
}

function dispatchTimerFocus() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TIMER_FOCUS_EVENT));
}
