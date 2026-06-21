"use client";

import { useCallback, useEffect, useState } from "react";
import { MetricStrip } from "@/components/MetricStrip";
import { PageHeader } from "@/components/PageHeader";
import { ReviewInbox } from "@/components/ReviewInbox";
import { TimeAllocationPie } from "@/components/TimeAllocationPie";
import { TimelineRail } from "@/components/TimelineRail";
import { TimerPanel } from "@/components/TimerPanel";
import type { BootstrapData } from "@/lib/queries";
import { formatTime } from "@/lib/format";

export function DashboardRealtime({ initialData }: { initialData: BootstrapData }) {
  const [data, setData] = useState(initialData);

  const refreshData = useCallback(async () => {
    const response = await fetch("/api/bootstrap", { cache: "no-store" });
    if (!response.ok) return;
    setData((await response.json()) as BootstrapData);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshData();
    }, 1000);

    return () => window.clearInterval(interval);
  }, [refreshData]);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Track explicit work, location suggestions, automation decisions and review items from one operational surface."
      />
      <MetricStrip
        todaySeconds={data.stats.todaySeconds}
        weekSeconds={data.stats.weekSeconds}
        reviewCount={data.stats.reviewCount}
        activeLabel={data.activeEntry?.projectName}
      />
      <div className="space-y-6 px-5 py-6 md:px-8">
        <TimerPanel
          activeEntry={data.activeEntry}
          projects={data.projects}
          categories={data.categories}
          places={data.places}
          recentEntries={data.entries}
          onSynced={setData}
        />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-6">
            <TimelineRail entries={data.entries.slice(0, 8)} />
            <section className="industrial-panel">
              <div className="border-b border-[var(--line)] px-4 py-3">
                <h2 className="text-lg font-semibold">Recent activity events</h2>
              </div>
              <div className="divide-y divide-[var(--line)]">
                {data.activityEvents.map((event) => (
                  <div
                    key={event.id}
                    className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[140px_1fr_160px]"
                  >
                    <span className="tabular text-[var(--muted)]">{formatTime(event.occurredAt)}</span>
                    <span className="font-medium">
                      {event.eventType} from {event.source}
                    </span>
                    <span className="text-[var(--muted)]">{event.reviewStatus}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <div className="space-y-6">
            <TimeAllocationPie entries={data.entries} />
            <ReviewInbox items={data.reviewItems} />
          </div>
        </div>
      </div>
    </>
  );
}
