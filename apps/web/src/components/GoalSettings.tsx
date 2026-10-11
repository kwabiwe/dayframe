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
  type GoalField,
  type TimeGoalMinutes
} from "@/lib/goal-stepper";

/**
 * Settings › Your day (UIA-309): the iPhone's goal steppers. A tap changes the goal at once; it is
 * saved a moment after the last tap (no Save button), and leaving the page saves a pending change.
 */
type Override = { value: number; revision: number };
type SaveContext = { revisions: Partial<Record<GoalField, number>>; basis: TimeGoalMinutes };

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
  const fromPage = { dailyGoalMinutes, weeklyGoalMinutes };
  // What a tap set for each goal, shown until the page's own data changes (a refresh that falls
  // back to cache leaves it unchanged, so the tapped value stays). Any change in the page's data
  // is newer and clears them.
  const [overrides, setOverrides] = useState<Partial<Record<GoalField, Override>>>({});
  const [status, setStatus] = useState<{ kind: "saved" | "error"; text: string } | null>(null);
  const [seenPage, setSeenPage] = useState(fromPage);
  if (!sameGoals(seenPage, fromPage)) {
    setSeenPage(fromPage);
    setOverrides({});
  }
  const goals: TimeGoalMinutes = {
    dailyGoalMinutes: overrides.dailyGoalMinutes?.value ?? dailyGoalMinutes,
    weeklyGoalMinutes: overrides.weeklyGoalMinutes?.value ?? weeklyGoalMinutes
  };
  // Read by the saver after a save lands (also after Settings closed: Today and Reports still
  // pick up the new goal at once).
  const latest = useRef({ mounted: false, refresh, revision: 0, router, seenPage: fromPage });
  const accepted = useRef<Partial<Record<GoalField, number>>>({});
  const saverRef = useRef<ReturnType<typeof createGoalSaver<SaveContext>> | null>(null);

  useEffect(() => {
    latest.current.refresh = refresh;
    latest.current.router = router;
    latest.current.seenPage = seenPage;
    // New page data supersedes what this visit accepted.
    accepted.current = {};
  }, [refresh, router, seenPage]);

  useEffect(() => {
    const state = latest.current;
    state.mounted = true;
    const saver = createGoalSaver<SaveContext>({
      save: async (changes) => {
        const response = await clientFetch("/api/profile", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...changes, expectedUserId: userId }),
          // Survives the page closing or reloading right after the last tap.
          keepalive: true
        });
        if (!response.ok) throw new Error("not saved");
      },
      mergeContext: (earlier, later) => ({ revisions: { ...earlier.revisions, ...later.revisions }, basis: later.basis }),
      onAccepted: ({ changes, context }) => {
        // Only over the page data it was made on: newer page data already says more.
        if (sameGoals(context.basis, state.seenPage)) accepted.current = { ...accepted.current, ...changes };
        // Every accepted write updates the app (Today's goal frame, Reports).
        void state.refresh({ force: true }).then(() => state.router.refresh()).catch(() => undefined);
      },
      onFailed: ({ changes, context }) => {
        if (!state.mounted) return;
        setOverrides((current) => {
          const next = { ...current };
          for (const field of Object.keys(changes) as GoalField[]) {
            // A newer tap on this goal keeps its own value; otherwise show what the account holds.
            if (current[field]?.revision !== context.revisions[field]) continue;
            const fallback = accepted.current[field];
            if (fallback === undefined) delete next[field];
            else next[field] = { value: fallback, revision: context.revisions[field] ?? 0 };
          }
          return next;
        });
        setStatus({ kind: "error", text: "Your goal was not saved. Check your connection and try again." });
      },
      onSettled: (_latest, wasAccepted) => {
        if (state.mounted && wasAccepted) setStatus({ kind: "saved", text: "Saved" });
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

  function step(field: GoalField, direction: -1 | 1) {
    const limits = field === "dailyGoalMinutes" ? DAILY_GOAL_HOURS : WEEKLY_GOAL_HOURS;
    const value = nextGoalMinutes(goals[field], direction, limits);
    if (value === goals[field]) return;
    const revision = ++latest.current.revision;
    setOverrides((current) => ({ ...current, [field]: { value, revision } }));
    setStatus(null);
    saverRef.current?.schedule({ [field]: value }, { revisions: { [field]: revision }, basis: seenPage });
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
