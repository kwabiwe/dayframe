"use client";

import { useState } from "react";
import { clientFetch } from "@/lib/client-auth-fetch";

export function GoalSettings({ dailyGoalMinutes, weeklyGoalMinutes }: { dailyGoalMinutes: number; weeklyGoalMinutes: number }) {
  const [daily, setDaily] = useState(String(dailyGoalMinutes / 60));
  const [weekly, setWeekly] = useState(String(weeklyGoalMinutes / 60));
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const dailyMinutes = Math.round(Number(daily) * 60);
    const weeklyMinutes = Math.round(Number(weekly) * 60);
    if (!Number.isFinite(dailyMinutes) || !Number.isFinite(weeklyMinutes)) {
      setMessage("Enter valid goal hours.");
      return;
    }
    setSaving(true);
    setMessage(null);
    const response = await clientFetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dailyGoalMinutes: dailyMinutes, weeklyGoalMinutes: weeklyMinutes })
    });
    const payload = (await response.json()) as { error?: string };
    setSaving(false);
    setMessage(response.ok ? "Goals saved." : payload.error ?? "Unable to save goals.");
  }

  return (
    <section className="industrial-panel">
      <div className="border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-lg font-semibold">Time goals</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Used for daily and weekly progress across Dayframe.</p>
      </div>
      <form className="grid gap-4 p-4 md:grid-cols-2" onSubmit={save}>
        <label className="industrial-field grid gap-2 p-3 text-sm">
          <span className="font-medium">Daily goal (hours)</span>
          <input type="number" min="0.25" max="24" step="0.25" value={daily} onChange={(event) => setDaily(event.target.value)} />
        </label>
        <label className="industrial-field grid gap-2 p-3 text-sm">
          <span className="font-medium">Weekly goal (hours)</span>
          <input type="number" min="0.25" max="168" step="0.25" value={weekly} onChange={(event) => setWeekly(event.target.value)} />
        </label>
        <div className="flex items-center gap-3 md:col-span-2">
          <button className="industrial-button-primary" disabled={saving} type="submit">{saving ? "Saving…" : "Save goals"}</button>
          {message ? <p className="text-sm text-[var(--muted)]" role="status">{message}</p> : null}
        </div>
      </form>
    </section>
  );
}
