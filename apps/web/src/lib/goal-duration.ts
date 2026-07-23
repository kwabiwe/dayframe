export function durationToParts(totalMinutes: number) {
  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60
  };
}

export function durationPartsToMinutes(hours: string, minutes: string, maximum: number) {
  if (!/^\d+$/.test(hours) || !/^\d+$/.test(minutes)) return null;
  const total = Number(hours) * 60 + Number(minutes);
  if (!Number.isInteger(total) || Number(minutes) > 59 || total < 1 || total > maximum) return null;
  return total;
}
