"use client";

import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppShellRuntime } from "@/components/AppShellRuntime";
import { saveTimeEntryQuickEdit, TimeEntryQuickEditorModal } from "@/components/TimeEntryQuickEditor";
import { resolveActivityIcon } from "@dayframe/shared";
import { blockStyle } from "@/lib/block-style";
import { timeEntryCategoryLabel, timeEntryTitle } from "@/lib/display";
import { formatDate, formatDuration, formatTime } from "@/lib/format";
import { useIsHydrated } from "@/components/useHydrationSafeNow";
import { useClockFormat } from "@/components/ClockFormat";
import { reportsHref, type ReportSort } from "@/lib/report-filters";
import type { ReportResult } from "@/lib/report-service";

type ReportEntry = ReportResult["entries"][number];

/**
 * A block's duration for its row (UIA-303): a positive block shorter than a minute — including one
 * stored as 0 seconds although it ended after it started — reads "<1m", never "0m".
 */
export function reportRowDuration(entry: Pick<ReportEntry, "durationSeconds" | "startedAt" | "stoppedAt">) {
  if (entry.durationSeconds > 0) return formatDuration(entry.durationSeconds);
  const spanMs = entry.stoppedAt ? Date.parse(entry.stoppedAt) - Date.parse(entry.startedAt) : 0;
  return spanMs > 0 ? "<1m" : formatDuration(0);
}

/**
 * Matching blocks in Blocks (audit W8b, UIA-303): Today's block rows — activity block, description
 * with activity, tags and (only when the block has one) place, date and time range, duration and
 * Edit — with Sort and pagination kept.
 */
export function ReportDetailsTable({ report }: { report: ReportResult }) {
  const router = useRouter();
  const { isTimerBusy, shellData, updateActiveEntryFromCalendar } = useAppShellRuntime();
  const [isPending, startTransition] = useTransition();
  const [editingEntry, setEditingEntry] = useState<ReportResult["entries"][number] | null>(null);

  const iconsById = new Map(report.filterOptions.categories.map((category) => [category.id, category.icon ?? null]));

  function changeSort(sort: ReportSort) {
    router.push(reportsHref(report.appliedFilters, { sort, page: 1 }));
  }

  return (
    <section className="df-card df-report-details" aria-labelledby="report-details-title">
      <div className="df-card-head">
        <h2 id="report-details-title">Matching blocks</h2>
        <span className="df-faint df-tnum">{report.pagination.totalEntries} {report.pagination.totalEntries === 1 ? "block" : "blocks"}</span>
        <label className="df-report-sort">
          <span className="sr-only">Sort blocks</span>
          <select className="ui-control" value={report.appliedFilters.sort} onChange={(event) => changeSort(event.target.value as ReportSort)}>
            <option value="newest">Newest first</option>
            <option value="duration">Longest first</option>
          </select>
        </label>
      </div>

      {report.entries.length > 0 ? (
        <ul aria-label="Blocks matching the report filters" className="df-rows df-report-rows">
          {report.entries.map((entry) => (
            <ReportBlockRow
              disabled={isPending}
              entry={entry}
              icon={iconsById.get(entry.categoryId ?? "") ?? null}
              key={entry.id}
              onEdit={() => setEditingEntry(entry)}
            />
          ))}
        </ul>
      ) : (
        <p className="df-muted">No matching blocks. Remove a filter or choose another date range to see tracked time.</p>
      )}

      {report.pagination.totalPages > 1 ? (
        <nav className="report-pagination" aria-label="Report block pages">
          {report.pagination.hasPrevious ? (
            <Link href={reportsHref(report.appliedFilters, { page: report.pagination.page - 1 })}>Previous</Link>
          ) : <span aria-disabled="true">Previous</span>}
          <strong>Page {report.pagination.page} of {report.pagination.totalPages}</strong>
          {report.pagination.hasNext ? (
            <Link href={reportsHref(report.appliedFilters, { page: report.pagination.page + 1 })}>Next</Link>
          ) : <span aria-disabled="true">Next</span>}
        </nav>
      ) : null}

      {editingEntry ? (
        <TimeEntryQuickEditorModal
          capturedNow={new Date(report.capturedNow)}
          categories={report.filterOptions.categories}
          entry={editingEntry}
          isTimerBusy={isTimerBusy}
          onClose={() => setEditingEntry(null)}
          onSave={async (plan) => {
            const outcome = editingEntry.stoppedAt
              ? await saveTimeEntryQuickEdit(editingEntry.id, plan)
              : await updateActiveEntryFromCalendar({ plan });
            if (outcome.ok) startTransition(() => router.refresh());
            return outcome;
          }}
          peerEntries={report.overlapCandidates}
          taskSuggestions={shellData?.taskSuggestions ?? []}
          taskSuggestionCandidates={shellData?.taskSuggestionCandidates}
          tags={report.filterOptions.tags}
        />
      ) : null}
    </section>
  );
}

export function ReportBlockRow({
  disabled,
  entry,
  icon,
  onEdit
}: {
  disabled: boolean;
  entry: ReportEntry;
  icon: string | null;
  onEdit: () => void;
}) {
  const title = timeEntryTitle(entry);
  const activity = timeEntryCategoryLabel(entry);
  const tags = entry.tagNames.map((tag) => `#${tag}`).join(" ");
  // Place only when this block has one: never a repeated empty place (UIA-303).
  const meta = [activity, tags, entry.placeName ?? ""].filter(Boolean).join(" · ");
  // Date and clock time are the browser's local ones, so they wait for hydration: the server's
  // UTC copy would mismatch (React #418).
  const hydrated = useIsHydrated();
  const clock = useClockFormat();
  const day = hydrated ? formatDate(entry.startedAt) : "";
  const when = hydrated ? `${formatTime(entry.startedAt, clock)}–${entry.stoppedAt ? formatTime(entry.stoppedAt, clock) : "now"}` : "";
  const duration = reportRowDuration(entry);
  const glyph = resolveActivityIcon({ icon, name: entry.categoryName }).glyph;
  const overlap = entry.overlapCount > 0
    ? `${formatDuration(entry.overlapSeconds)} overlaps ${entry.overlapCount} other ${entry.overlapCount === 1 ? "block" : "blocks"}`
    : null;

  return (
    <li className={`df-erow df-report-row${entry.isRunning ? " is-live" : ""}`}>
      <button
        aria-label={`${title}, ${meta}, ${hydrated ? `${day} ${when}, ` : ""}${duration}${entry.isRunning ? ", running" : ""}${overlap ? `, ${overlap}` : ""}. Edit.`}
        className="df-erow-main"
        disabled={disabled}
        onClick={onEdit}
        type="button"
      >
        <span
          className={`df-erow-block${entry.categoryId ? " df-block" : ""}`}
          style={entry.categoryId ? blockStyle(entry.categoryColor, entry.categoryName ?? "") : undefined}
        >
          <DayframeIcon glyph={entry.categoryId ? glyph : "tag"} size={16} />
        </span>
        <span className="df-erow-text">
          <b>{title}</b>
          <span>
            {meta}
            {overlap ? <em className="df-report-row-flag" title={overlap}> · Overlap {formatDuration(entry.overlapSeconds)}</em> : null}
          </span>
        </span>
        <span className="df-erow-when df-report-row-when">
          <small>{day}</small>
          <span>{when}</span>
        </span>
        <span className="df-erow-dur">{duration}</span>
      </button>
      <span className="df-erow-acts">
        <button aria-label={`Edit ${title}`} className="df-icon-action" disabled={disabled} onClick={onEdit} type="button">
          <DayframeIcon glyph="pencil" size={16} />
        </button>
      </span>
    </li>
  );
}
