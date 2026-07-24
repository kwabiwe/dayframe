"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import {
  getResolvedThemeChoice,
  setThemeChoice,
  subscribeToThemeChoice
} from "@/components/ThemeSettings";

export function ThemeToggleButton() {
  const resolvedTheme = useSyncExternalStore(
    subscribeToThemeChoice,
    getResolvedThemeChoice,
    () => "light"
  );
  const nextTheme = resolvedTheme === "dark" ? "light" : "dark";
  const label = `Switch to ${nextTheme} mode`;

  return (
    <button
      aria-label={label}
      className="swiss-theme-toggle"
      onClick={() => setThemeChoice(nextTheme)}
      title={label}
      type="button"
    >
      {nextTheme === "dark" ? <Moon size={19} aria-hidden="true" /> : <Sun size={19} aria-hidden="true" />}
    </button>
  );
}
