type WeeklyActivity = { id: string; name: string; color: string | null };
type WeeklyDay = {
  key: string;
  label: string;
  shortLabel: string;
  future: boolean;
  activities: ReadonlyArray<{ id: string; seconds: number }>;
};

/** Projects the existing report's daily allocations without fetching or retaining entry detail. */
export function buildWeeklyWrapped(days: readonly WeeklyDay[], activities: readonly WeeklyActivity[]) {
  const byId = new Map(activities.map((activity) => [activity.id, activity]));
  const activitySeconds = new Map<string, number>();
  const columns = days.map((day) => {
    const segments = (day.future ? [] : day.activities)
      .filter((segment) => segment.seconds > 0 && Number.isFinite(segment.seconds))
      .map(({ id, seconds }) => {
        activitySeconds.set(id, (activitySeconds.get(id) ?? 0) + seconds);
        return { id, seconds, name: byId.get(id)?.name ?? "No activity", color: byId.get(id)?.color ?? null };
      })
      .sort((a, b) => b.seconds - a.seconds);
    return { ...day, segments, seconds: segments.reduce((total, segment) => total + segment.seconds, 0) };
  });
  const totalSeconds = columns.reduce((total, day) => total + day.seconds, 0);
  const trackedDays = columns.filter((day) => day.seconds > 0).length;
  const peakSeconds = Math.max(0, ...columns.map((day) => day.seconds));
  const peakDays = columns.filter((day) => peakSeconds > 0 && day.seconds === peakSeconds);
  const activitiesRanked = Array.from(activitySeconds, ([id, seconds]) => ({
    id,
    name: byId.get(id)?.name ?? "No activity",
    color: byId.get(id)?.color ?? null,
    seconds,
    share: seconds / totalSeconds
  })).sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));

  return {
    columns,
    totalSeconds,
    trackedDays,
    peakSeconds,
    busiest: peakDays.length === 1 ? peakDays[0] : null,
    activities: activitiesRanked
  };
}

export type WeeklyWrapped = ReturnType<typeof buildWeeklyWrapped>;
