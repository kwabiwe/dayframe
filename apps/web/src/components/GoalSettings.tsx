"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, SettingsRow } from "@/components/ui/Primitives";
import { useAppShellRuntime } from "@/components/AppShellRuntime";
import { clientFetch } from "@/lib/client-auth-fetch";
import { durationPartsToMinutes, durationToParts } from "@/lib/goal-duration";

export function GoalSettings({ dailyGoalMinutes, weeklyGoalMinutes }: { dailyGoalMinutes: number; weeklyGoalMinutes: number }) {
  const router = useRouter();
  const { refresh } = useAppShellRuntime();
  const dailyInitial = durationToParts(dailyGoalMinutes);
  const weeklyInitial = durationToParts(weeklyGoalMinutes);
  const [dailyHours, setDailyHours] = useState(String(dailyInitial.hours));
  const [dailyMinutes, setDailyMinutes] = useState(String(dailyInitial.minutes));
  const [weeklyHours, setWeeklyHours] = useState(String(weeklyInitial.hours));
  const [weeklyMinutes, setWeeklyMinutes] = useState(String(weeklyInitial.minutes));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const nextDaily = durationPartsToMinutes(dailyHours, dailyMinutes, 1440);
    const nextWeekly = durationPartsToMinutes(weeklyHours, weeklyMinutes, 10080);
    if (nextDaily === null || nextWeekly === null) {
      setError("Enter whole hours and minutes. Daily goals can be up to 24 hours and weekly goals up to 168 hours.");
      setMessage(null);
      return;
    }
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await clientFetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dailyGoalMinutes: nextDaily, weeklyGoalMinutes: nextWeekly })
      });
      if (!response.ok) {
        setError("Unable to save your time goals. Check the values and try again.");
        return;
      }
      setMessage("Time goals saved.");
      await refresh({ force: true });
      router.refresh();
    } catch {
      setError("Unable to save your time goals. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsRow
      className="settings-goals-row"
      label="Time goals"
      detail="Used for daily and weekly progress."
      action={
        <form className="settings-goal-control" noValidate onSubmit={save}>
          <DurationControl
            id="daily-goal"
            label="Daily goal"
            hours={dailyHours}
            minutes={dailyMinutes}
            maxHours={24}
            onHoursChange={setDailyHours}
            onMinutesChange={setDailyMinutes}
          />
          <DurationControl
            id="weekly-goal"
            label="Weekly goal"
            hours={weeklyHours}
            minutes={weeklyMinutes}
            maxHours={168}
            onHoursChange={setWeeklyHours}
            onMinutesChange={setWeeklyMinutes}
          />
          <div className="settings-save-row">
            <Button variant="primary" compact disabled={saving} type="submit">
              {saving ? "Saving…" : "Save goals"}
            </Button>
            {message ? <p className="settings-feedback" role="status">{message}</p> : null}
            {error ? <p className="settings-feedback is-error" role="alert">{error}</p> : null}
          </div>
        </form>
      }
    />
  );
}

function DurationControl({
  hours,
  id,
  label,
  maxHours,
  minutes,
  onHoursChange,
  onMinutesChange
}: {
  hours: string;
  id: string;
  label: string;
  maxHours: number;
  minutes: string;
  onHoursChange: (value: string) => void;
  onMinutesChange: (value: string) => void;
}) {
  return (
    <fieldset className="settings-duration-control">
      <legend>{label}</legend>
      <label htmlFor={`${id}-hours`}>
        <input
          id={`${id}-hours`}
          aria-label={`${label} hours`}
          className="ui-control tabular"
          inputMode="numeric"
          max={maxHours}
          min={0}
          step={1}
          type="number"
          value={hours}
          onChange={(event) => onHoursChange(event.target.value)}
        />
        <span>h</span>
      </label>
      <label htmlFor={`${id}-minutes`}>
        <input
          id={`${id}-minutes`}
          aria-label={`${label} minutes`}
          className="ui-control tabular"
          inputMode="numeric"
          max={59}
          min={0}
          step={1}
          type="number"
          value={minutes}
          onChange={(event) => onMinutesChange(event.target.value)}
        />
        <span>min</span>
      </label>
    </fieldset>
  );
}
