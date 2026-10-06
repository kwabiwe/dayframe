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
      {/* Both icons render on the server; CSS shows the one for the theme already painted, so it never flips on load. */}
      <Moon className="swiss-theme-toggle-to-dark" size={19} aria-hidden="true" />
      <Sun className="swiss-theme-toggle-to-light" size={19} aria-hidden="true" />
    </button>
  );
}
