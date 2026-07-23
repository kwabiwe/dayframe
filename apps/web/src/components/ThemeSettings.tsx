"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { SegmentedControl, SettingsRow } from "@/components/ui/Primitives";

type ThemeChoice = "system" | "light" | "dark";

const choices: Array<{ value: ThemeChoice; label: string; icon: React.ReactNode }> = [
  {
    value: "system",
    label: "System",
    icon: <Monitor size={16} />
  },
  {
    value: "light",
    label: "Light",
    icon: <Sun size={16} />
  },
  {
    value: "dark",
    label: "Dark",
    icon: <Moon size={16} />
  }
];

export function ThemeSettings() {
  const choice = useSyncExternalStore(subscribeToThemeChoice, getThemeChoice, getServerThemeChoice);

  function updateTheme(nextChoice: ThemeChoice) {
    if (nextChoice === "system") {
      window.localStorage.removeItem("dayframe.theme");
      document.documentElement.removeAttribute("data-theme");
    } else {
      window.localStorage.setItem("dayframe.theme", nextChoice);
      document.documentElement.setAttribute("data-theme", nextChoice);
    }
    window.dispatchEvent(new Event("dayframe-theme-change"));
  }

  return (
    <SettingsRow
      className="settings-appearance-row"
      label="Appearance"
      detail={choice === "system"
        ? "Follows your browser and operating system."
        : `Uses Dayframe’s ${choice} appearance on this browser.`}
      action={(
        <SegmentedControl
          ariaLabel="Appearance"
          options={choices}
          value={choice}
          onChange={updateTheme}
        />
      )}
    />
  );
}

function subscribeToThemeChoice(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("dayframe-theme-change", callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("dayframe-theme-change", callback);
  };
}

function getThemeChoice(): ThemeChoice {
  const storedTheme = window.localStorage.getItem("dayframe.theme");
  return storedTheme === "light" || storedTheme === "dark" ? storedTheme : "system";
}

function getServerThemeChoice(): ThemeChoice {
  return "system";
}
