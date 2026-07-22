"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { EditTimeEntryDialog } from "@/components/EditTimeEntryDialog";
import { TagMetadata } from "@/components/TagMetadata";
import { IconButton } from "@/components/ui/Primitives";
import { timeEntryCategoryColor, timeEntryCategoryLabel, timeEntryTitle } from "@/lib/display";
import { formatDate, formatDuration, formatTime } from "@/lib/format";
import { reportsHref, type ReportSort } from "@/lib/report-filters";
import type { ReportResult } from "@/lib/report-service";

export function ReportDetailsTable({ report }: { report: ReportResult }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingEntry, setEditingEntry] = useState<ReportResult["entries"][number] | null>(null);

  function changeSort(sort: ReportSort) {
    router.push(reportsHref(report.appliedFilters, { sort, page: 1 }));
  }

  return (
    <section className="fill-group-surface report-details" aria-labelledby="report-details-title">
      <header className="report-section-header report-details-header">
        <div>
          <h2 id="report-details-title">Matching entries</h2>
          <p>{report.pagination.totalEntries} entr{report.pagination.totalEntries === 1 ? "y" : "ies"} make up these totals.</p>
        </div>
        <label className="report-sort-control">
          <span>Sort</span>
          <select className="ui-control" value={report.appliedFilters.sort} onChange={(event) => changeSort(event.target.value as ReportSort)}>
            <option value="newest">Newest first</option>
            <option value="duration">Longest first</option>
          </select>
        </label>
      </header>

      {report.entries.length > 0 ? (
        <div className="report-detail-table-scroll">
          <table className="report-detail-table">
            <caption>Individual time entries matching the active report filters</caption>
            <thead>
              <tr>
                <th>Date and time</th>
                <th>Task and tags</th>
                <th>Category</th>
                <th>Place</th>
                <th>Duration</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {report.entries.map((entry) => (
                <tr key={entry.id}>
                  <td data-label="Date and time" className="report-entry-time">
                    <strong>{formatDate(entry.startedAt)}</strong>
                    <span>{formatTime(entry.startedAt)}–{entry.stoppedAt ? formatTime(entry.stoppedAt) : "now"}</span>
                  </td>
                  <td data-label="Task and tags" className="report-entry-task">
                    <strong>{timeEntryTitle(entry)}</strong>
                    <TagMetadata tagNames={entry.tagNames} />
                    {entry.isRunning ? <span className="report-running-pill">Running</span> : null}
                  </td>
                  <td data-label="Category">
                    <span className="report-entry-category">
                      <i
                        className={entry.categoryId ? "" : "is-uncategorized"}
                        style={{ backgroundColor: timeEntryCategoryColor(entry) }}
                        aria-hidden="true"
                      />
                      {timeEntryCategoryLabel(entry)}
                    </span>
                  </td>
                  <td data-label="Place">{entry.placeName ?? "No place"}</td>
                  <td data-label="Duration" className="report-entry-duration">{formatDuration(entry.durationSeconds)}</td>
                  <td data-label="Actions">
                    <IconButton label={`Edit ${timeEntryTitle(entry)}`} onClick={() => setEditingEntry(entry)} disabled={isPending}>
                      <Pencil aria-hidden="true" size={16} />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="report-empty-details">
          <strong>No matching entries</strong>
          <p>Remove a filter or choose another date range to see tracked time.</p>
        </div>
      )}

      {report.pagination.totalPages > 1 ? (
        <nav className="report-pagination" aria-label="Report entries pages">
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
        <EditTimeEntryDialog
          categories={report.filterOptions.categories}
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onSaved={() => {
            setEditingEntry(null);
            startTransition(() => router.refresh());
          }}
          places={report.filterOptions.places}
          tags={report.filterOptions.tags}
        />
      ) : null}
    </section>
  );
}
