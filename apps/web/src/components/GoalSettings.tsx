"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
  goalDrafts,
  nextGoalMinutes,
  shownGoal,
  type GoalField,
  type ServerGoals,
  type TimeGoalMinutes
} from "@/lib/goal-stepper";

/**
 * Settings › Your day (UIA-309): the iPhone's goal steppers. A tap changes the goal at once; it is
 * saved a moment after the last tap (no Save button), and leaving the page saves a pending change.
 * What is shown comes from the tab-wide goal drafts (`goalDrafts`): a tap until its save settles,
 * then the newest goals the server has handed this tab, ordered by the server's `goalsRevision`
 * (the page's data, a save's reply). A late page load or a delayed reply carrying an older
 * revision never hides a newer goal, including one changed elsewhere.
 */
type SaveContext = { revisions: Partial<Record<GoalField, number>> };

export function GoalSettings({
  dailyGoalMinutes,
  goalsRevision,
  userId,
  weeklyGoalMinutes
}: {
  dailyGoalMinutes: number;
  /** The server's revision of these goals (bumped by every goal change). */
  goalsRevision: number;
  /** The account these goals belong to: a save never lands on another account signed in since. */
  userId: string;
  weeklyGoalMinutes: number;
}) {
  const router = useRouter();
  const { refresh } = useAppShellRuntime();
  const drafts = useSyncExternalStore(goalDrafts.subscribe, () => goalDrafts.get(userId), () => goalDrafts.get(userId));
  const [status, setStatus] = useState<{ kind: "saved" | "error"; text: string; revision?: number } | null>(null);
  const page: ServerGoals = { dailyGoalMinutes, weeklyGoalMinutes, goalsRevision };
  // "Saved" stays only while this tab's save is still the newest goal the server has handed it.
  const newestRevision = Math.max(drafts.known?.goalsRevision ?? 0, goalsRevision);
  const shownStatus = status?.kind === "saved" && (status.revision ?? 0) < newestRevision ? null : status;
  const goals: TimeGoalMinutes = {
    dailyGoalMinutes: shownGoal(drafts, "dailyGoalMinutes", page),
    weeklyGoalMinutes: shownGoal(drafts, "weeklyGoalMinutes", page)
  };

  // The page's data joins what the tab knows (kept only if its revision is newer).
  useEffect(() => {
    goalDrafts.observe(userId, { dailyGoalMinutes, weeklyGoalMinutes, goalsRevision });
  }, [dailyGoalMinutes, goalsRevision, userId, weeklyGoalMinutes]);
  // Read by the saver after a save lands (also after Settings closed: Today and Reports still
  // pick up the new goal at once).
  const latest = useRef({ mounted: false, refresh, router, lastSavedRevision: 0 });
  const saverRef = useRef<ReturnType<typeof createGoalSaver<SaveContext, ServerGoals>> | null>(null);

  useEffect(() => {
    latest.current.refresh = refresh;
    latest.current.router = router;
  }, [refresh, router]);

  useEffect(() => {
    const state = latest.current;
    state.mounted = true;
    const saver = createGoalSaver<SaveContext, ServerGoals>({
      save: async (changes) => {
        const response = await clientFetch("/api/profile", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...changes, expectedUserId: userId }),
          // Survives the page closing or reloading right after the last tap.
          keepalive: true
        });
        if (!response.ok) throw new Error("not saved");
        // Only a reply naming the stored goals and their revision settles the tap; anything else is
        // an unconfirmed outcome (handled like a failure, then reconciled by the reload).
        const body = (await response.json().catch(() => null)) as { goals?: Partial<ServerGoals> } | null;
        const stored = body?.goals;
        if (!stored || !Number.isInteger(stored.dailyGoalMinutes) || !Number.isInteger(stored.weeklyGoalMinutes) || !Number.isInteger(stored.goalsRevision)) {
          throw new UnconfirmedGoalSave();
        }
        return stored as ServerGoals;
      },
      mergeContext: (earlier, later) => ({ revisions: { ...earlier.revisions, ...later.revisions } }),
      // The tab's drafts outlive this visit: a save that lands after Settings closed still counts.
      onAccepted: ({ changes, context }, stored) => {
        goalDrafts.accept(userId, changes, context.revisions, stored);
        state.lastSavedRevision = stored.goalsRevision;
      },
      onFailed: ({ changes, context }, error) => {
        // Only the goals this save carried, and only if no newer tap changed them since: each
        // falls back to the value the account last accepted from this tab, or the page's.
        goalDrafts.fail(userId, changes, context.revisions);
        if (state.mounted) setStatus(error instanceof UnconfirmedGoalSave
          ? { kind: "error", text: "Dayframe couldn't confirm your goal. Showing your account's latest." }
          : { kind: "error", text: "Your goal was not saved. Check your connection and try again." });
      },
      onBusyChange: (busy, lastAccepted) => {
        if (busy) return;
        if (state.mounted && lastAccepted) setStatus({ kind: "saved", text: "Saved", revision: state.lastSavedRevision });
        // Everything is saved (or failed): reload once, so every accepted write reaches the app.
        void state.refresh({ force: true }).then(() => state.router.refresh()).catch(() => undefined);
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
    const revision = goalDrafts.tap(userId, field, value);
    setStatus(null);
    saverRef.current?.schedule({ [field]: value }, { revisions: { [field]: revision } });
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
        className={`settings-section-feedback df-goal-status${shownStatus?.kind === "error" ? " is-error" : ""}`}
        role={shownStatus?.kind === "error" ? "alert" : "status"}
      >
        {shownStatus?.text ?? ""}
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

/** A save whose reply did not name the stored goals: its outcome is unknown until the reload. */
class UnconfirmedGoalSave extends Error {
  constructor() {
    super("goal save not confirmed");
    this.name = "UnconfirmedGoalSave";
  }
}
