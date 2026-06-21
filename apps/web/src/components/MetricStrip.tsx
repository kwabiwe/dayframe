import { formatDuration } from "@/lib/format";

export function MetricStrip({
  todaySeconds,
  weekSeconds,
  reviewCount,
  activeLabel
}: {
  todaySeconds: number;
  weekSeconds: number;
  reviewCount: number;
  activeLabel?: string | null;
}) {
  const metrics = [
    { label: "Today", value: formatDuration(todaySeconds) },
    { label: "This week", value: formatDuration(weekSeconds) },
    { label: "Review", value: `${reviewCount}` },
    { label: "Active", value: activeLabel ?? "None" }
  ];

  return (
    <section className="grid border-b border-[var(--line)] bg-[var(--surface-inset)] md:grid-cols-4">
      {metrics.map((metric, index) => (
        <div key={`metric-${index}-${metric.label}`} className="border-[var(--line)] px-5 py-4 md:border-r md:last:border-r-0">
          <div className="text-xs text-[var(--muted)]">{metric.label}</div>
          <div className="tabular mt-2 text-2xl font-semibold leading-none text-[var(--foreground)]">{metric.value}</div>
        </div>
      ))}
    </section>
  );
}
