"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus } from "lucide-react";
import { SettingsRow } from "@/components/ui/Primitives";
import { useAppShellRuntime } from "@/components/AppShellRuntime";
import { clientFetch } from "@/lib/client-auth-fetch";
import {
  DAILY_GOAL_HOURS,
  WEEKLY_GOAL_HOURS,
  canStepGoal,
  createGoalSaver,
  nextGoalMinutes,
  type TimeGoalMinutes
} from "@/lib/goal-stepper";

/**
 * Settings › Your day (UIA-309): the iPhone's goal steppers. A tap changes the goal at once; it is
 * saved a moment after the last tap (no Save button), and leaving the page saves a pending change.
 */
export function GoalSettings({ dailyGoalMinutes, weeklyGoalMinutes }: { dailyGoalMinutes: number; weeklyGoalMinutes: number }) {
  const router = useRouter();
  const { refresh } = useAppShellRuntime();
  const [draft, setDraft] = useState<TimeGoalMinutes | null>(null);
  const [status, setStatus] = useState<{ kind: "saved" | "error"; text: string } | null>(null);
  const goals = draft ?? { dailyGoalMinutes, weeklyGoalMinutes };
  // Bumped when a save lands; the effect below reloads the account so Today and Reports follow.
  const [savedCount, setSavedCount] = useState(0);
  const [saver] = useState(() => createGoalSaver({
    save: async (next) => {
      const response = await clientFetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next)
      });
      if (!response.ok) throw new Error("not saved");
    },
    onSaved: () => {
      setStatus({ kind: "saved", text: "Saved" });
      setSavedCount((count) => count + 1);
    },
    onFailed: () => {
      // Show what the account holds again.
      setDraft(null);
      setStatus({ kind: "error", text: "Your goal was not saved. Check your connection and try again." });
    }
  }));

  useEffect(() => {
    if (savedCount === 0) return;
    let current = true;
    void refresh({ force: true }).then(() => {
      if (!current) return;
      setDraft(null);
      router.refresh();
    });
    return () => {
      current = false;
    };
  }, [refresh, router, savedCount]);

  useEffect(() => {
    const flush = () => saver.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") saver.flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      // Leaving Settings inside the app saves a pending change at once.
      saver.flush();
    };
  }, [saver]);

  function step(kind: keyof TimeGoalMinutes, direction: -1 | 1) {
    const limits = kind === "dailyGoalMinutes" ? DAILY_GOAL_HOURS : WEEKLY_GOAL_HOURS;
    const value = nextGoalMinutes(goals[kind], direction, limits);
    if (value === goals[kind]) return;
    const next = { ...goals, [kind]: value };
    setDraft(next);
    setStatus(null);
    saver.schedule(next);
  }

  return (
    <>
      <SettingsRow
        className="df-goal-row"
        label="Daily goal"
        detail="Fills the hour cells on Today"
        action={(
          <GoalStepper
            hint={`From ${DAILY_GOAL_HOURS.min} to ${DAILY_GOAL_HOURS.max} hours`}
            label="daily goal"
            minutes={goals.dailyGoalMinutes}
            onStep={(direction) => step("dailyGoalMinutes", direction)}
            limits={DAILY_GOAL_HOURS}
          />
        )}
      />
      <SettingsRow
        className="df-goal-row"
        label="Weekly goal"
        detail="Shown in Reports"
        action={(
          <GoalStepper
            hint={`From ${WEEKLY_GOAL_HOURS.min} to ${WEEKLY_GOAL_HOURS.max} hours, in steps of ${WEEKLY_GOAL_HOURS.step}`}
            label="weekly goal"
            minutes={goals.weeklyGoalMinutes}
            onStep={(direction) => step("weeklyGoalMinutes", direction)}
            limits={WEEKLY_GOAL_HOURS}
          />
        )}
      />
      <p
        className={`settings-section-feedback df-goal-status${status?.kind === "error" ? " is-error" : ""}`}
        role={status?.kind === "error" ? "alert" : "status"}
      >
        {status?.text ?? ""}
      </p>
    </>
  );
}

function GoalStepper({
  hint,
  label,
  limits,
  minutes,
  onStep
}: {
  hint: string;
  label: string;
  limits: { min: number; max: number; step: number };
  minutes: number;
  onStep: (direction: -1 | 1) => void;
}) {
  const value = goalLabel(minutes);
  return (
    <div className="df-stepper" role="group" aria-label={`${label[0].toUpperCase()}${label.slice(1)}: ${value}`}>
      <button
        aria-label={`Decrease ${label}`}
        className="df-stepper-btn"
        disabled={!canStepGoal(minutes, -1, limits)}
        onClick={() => onStep(-1)}
        title={hint}
        type="button"
      >
        <Minus aria-hidden="true" size={16} />
      </button>
      <output className="df-stepper-value df-tnum" aria-live="polite">{value}</output>
      <button
        aria-label={`Increase ${label}`}
        className="df-stepper-btn"
        disabled={!canStepGoal(minutes, 1, limits)}
        onClick={() => onStep(1)}
        title={hint}
        type="button"
      >
        <Plus aria-hidden="true" size={16} />
      </button>
    </div>
  );
}

/** "8h", or "7h 30m" for a goal set off the hour elsewhere: the shared duration form. */
function goalLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
