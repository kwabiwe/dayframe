import { formatDuration, formatSourceLabel } from "@/lib/format";
import type { ReportExportRow } from "@/lib/report-service";

const csvHeaders = [
  "Date",
  "Start",
  "Finish",
  "Duration",
  "Description",
  "Tags",
  "Category",
  "Place",
  "Source"
] as const;

export function buildReportCsv(rows: ReadonlyArray<ReportExportRow>) {
  return [
    csvHeaders.join(","),
    ...rows.map((row) => {
      const startedAt = new Date(row.startedAt);
      return [
        dateFormatter.format(startedAt),
        timeFormatter.format(startedAt),
        row.stoppedAt ? timeFormatter.format(new Date(row.stoppedAt)) : "Running",
        formatDuration(row.durationSeconds),
        row.description ?? "",
        row.tagNames.join(", "),
        row.categoryName ?? "Uncategorized",
        row.placeName ?? "No place",
        formatSourceLabel(row.source)
      ].map(escapeCsvCell).join(",");
    })
  ].join("\r\n");
}

export function escapeCsvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit"
});
