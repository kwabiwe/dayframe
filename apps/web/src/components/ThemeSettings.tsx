"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { SegmentedControl, SettingsRow } from "@/components/ui/Primitives";

export type ThemeChoice = "system" | "light" | "dark";

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
    setThemeChoice(nextChoice);
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

export function setThemeChoice(nextChoice: ThemeChoice) {
  if (nextChoice === "system") {
    window.localStorage.removeItem("dayframe.theme");
    document.documentElement.removeAttribute("data-theme");
  } else {
    window.localStorage.setItem("dayframe.theme", nextChoice);
    document.documentElement.setAttribute("data-theme", nextChoice);
  }
  window.dispatchEvent(new Event("dayframe-theme-change"));
}

export function subscribeToThemeChoice(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener("storage", callback);
  window.addEventListener("dayframe-theme-change", callback);
  media.addEventListener("change", callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("dayframe-theme-change", callback);
    media.removeEventListener("change", callback);
  };
}

export function getThemeChoice(): ThemeChoice {
  const storedTheme = window.localStorage.getItem("dayframe.theme");
  return storedTheme === "light" || storedTheme === "dark" ? storedTheme : "system";
}

export function getResolvedThemeChoice(): Exclude<ThemeChoice, "system"> {
  const choice = getThemeChoice();
  if (choice !== "system") return choice;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getServerThemeChoice(): ThemeChoice {
  return "system";
}
