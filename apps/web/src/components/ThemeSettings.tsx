"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type ThemeChoice = "system" | "light" | "dark";

const choices: Array<{ value: ThemeChoice; label: string; description: string; icon: React.ReactNode }> = [
  {
    value: "system",
    label: "System",
    description: "Follow the browser and operating system setting.",
    icon: <Monitor size={16} />
  },
  {
    value: "light",
    label: "Light",
    description: "Use the light workspace theme on this browser.",
    icon: <Sun size={16} />
  },
  {
    value: "dark",
    label: "Dark",
    description: "Use the dark workspace theme on this browser.",
    icon: <Moon size={16} />
  }
];

export function ThemeSettings() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("dayframe.theme");
    setChoice(storedTheme === "light" || storedTheme === "dark" ? storedTheme : "system");
  }, []);

  function updateTheme(nextChoice: ThemeChoice) {
    setChoice(nextChoice);
    if (nextChoice === "system") {
      window.localStorage.removeItem("dayframe.theme");
      delete document.documentElement.dataset.theme;
    } else {
      window.localStorage.setItem("dayframe.theme", nextChoice);
      document.documentElement.dataset.theme = nextChoice;
    }
    window.dispatchEvent(new Event("dayframe-theme-change"));
  }

  return (
    <section className="industrial-panel">
      <div className="border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-lg font-semibold">Theme</h2>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-3">
        {choices.map((item) => {
          const selected = item.value === choice;
          return (
            <button
              key={item.value}
              type="button"
              className={[
                "focus-ring flex min-h-[104px] flex-col items-start gap-3 border p-4 text-left",
                selected
                  ? "border-[var(--accent)] bg-[var(--surface-inset)] text-[var(--accent)]"
                  : "border-[var(--line)] bg-[var(--surface)] text-[var(--foreground)] hover:border-[var(--line-strong)]"
              ].join(" ")}
              onClick={() => updateTheme(item.value)}
            >
              <span className="flex items-center gap-2 font-semibold">
                {item.icon}
                {item.label}
              </span>
              <span className="text-xs leading-5 text-[var(--muted)]">{item.description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
