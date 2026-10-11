"use client";

import { useEffect, useRef, useState } from "react";
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
export function GoalSettings({
  dailyGoalMinutes,
  userId,
  weeklyGoalMinutes
}: {
  dailyGoalMinutes: number;
  /** The account these goals belong to: a save never lands on another account signed in since. */
  userId: string;
  weeklyGoalMinutes: number;
}) {
  const router = useRouter();
  const { refresh } = useAppShellRuntime();
  const [draft, setDraft] = useState<TimeGoalMinutes | null>(null);
  // The last goals the server accepted, shown until the page's own data changes: the app's refresh
  // can fall back to cached data, which must not put an older goal back on screen. Any change in
  // the page's data is newer than this and retires it.
  const [acknowledged, setAcknowledged] = useState<TimeGoalMinutes | null>(null);
  const [status, setStatus] = useState<{ kind: "saved" | "error"; text: string } | null>(null);
  const fromPage = { dailyGoalMinutes, weeklyGoalMinutes };
  const [seenPage, setSeenPage] = useState(fromPage);
  if (!sameGoals(seenPage, fromPage)) {
    setSeenPage(fromPage);
    setAcknowledged(null);
  }
  const goals = draft ?? acknowledged ?? fromPage;
  // The latest app callbacks and edit revision, read by the saver after a save lands (also after
  // Settings has closed, so Today and Reports still pick up the new goal at once).
  const latest = useRef({ mounted: false, refresh, revision: 0, router });
  const saverRef = useRef<ReturnType<typeof createGoalSaver> | null>(null);

  useEffect(() => {
    latest.current.refresh = refresh;
    latest.current.router = router;
  }, [refresh, router]);

  useEffect(() => {
    const state = latest.current;
    state.mounted = true;
    const saver = createGoalSaver({
      save: async (next) => {
        const response = await clientFetch("/api/profile", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...next, expectedUserId: userId }),
          // Survives the page closing or reloading right after the last tap.
          keepalive: true
        });
        if (!response.ok) throw new Error("not saved");
      },
      // Every accepted write (also one a newer change superseded) is what the account holds now.
      onAccepted: (accepted) => {
        if (state.mounted) setAcknowledged(accepted);
      },
      onSaved: (_saved, revision) => {
        if (state.mounted && state.revision === revision) {
          setDraft(null);
          setStatus({ kind: "saved", text: "Saved" });
        }
        void state.refresh({ force: true }).then(() => state.router.refresh()).catch(() => undefined);
      },
      onFailed: (_error, revision) => {
        if (!state.mounted || state.revision !== revision) return;
        // Show what the account holds again.
        setDraft(null);
        setStatus({ kind: "error", text: "Your goal was not saved. Check your connection and try again." });
      }
    });
    saverRef.current = saver;
    const leave = () => saver.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") saver.flush();
    };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", onVisibility);
      state.mounted = false;
      // Leaving Settings inside the app saves a pending change at once.
      saver.flush();
      saverRef.current = null;
    };
  }, [userId]);

  function step(kind: keyof TimeGoalMinutes, direction: -1 | 1) {
    const limits = kind === "dailyGoalMinutes" ? DAILY_GOAL_HOURS : WEEKLY_GOAL_HOURS;
    const value = nextGoalMinutes(goals[kind], direction, limits);
    if (value === goals[kind]) return;
    const next = { ...goals, [kind]: value };
    latest.current.revision += 1;
    setDraft(next);
    setStatus(null);
    saverRef.current?.schedule(next, latest.current.revision);
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
      <output aria-label={`${label[0].toUpperCase()}${label.slice(1)} ${value}`} aria-live="polite" className="df-stepper-value df-tnum">{value}</output>
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

function sameGoals(a: TimeGoalMinutes, b: TimeGoalMinutes) {
  return a.dailyGoalMinutes === b.dailyGoalMinutes && a.weeklyGoalMinutes === b.weeklyGoalMinutes;
}
