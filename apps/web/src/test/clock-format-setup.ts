import { beforeEach } from "vitest";
import { CLOCK_FORMAT_STORAGE_KEY } from "@/lib/clock-format";

// Browser tests read times as 24-hour, Dayframe's long-standing clock, whatever the machine's
// locale: "System" (the default) would otherwise follow the test runner's language. Tests of the
// 12/24-hour setting itself set or clear the choice explicitly.
beforeEach(() => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLOCK_FORMAT_STORAGE_KEY, "24h");
  } catch {
    // A test environment without storage keeps the system format.
  }
});
