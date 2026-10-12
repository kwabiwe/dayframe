import { formatExportDuration, formatSourceLabel } from "@/lib/format";
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

/**
 * The report CSV. Dates and times are written in `timeZone` (the viewer's zone) when given,
 * otherwise in the process's own zone.
 */
export function buildReportCsv(rows: ReadonlyArray<ReportExportRow>, options: { timeZone?: string } = {}) {
  const dateFormatter = new Intl.DateTimeFormat("en-GB", { ...dateFormat, timeZone: options.timeZone });
  const timeFormatter = new Intl.DateTimeFormat("en-GB", { ...timeFormat, timeZone: options.timeZone });
  return [
    csvHeaders.join(","),
    ...rows.map((row) => {
      const startedAt = new Date(row.startedAt);
      return [
        dateFormatter.format(startedAt),
        timeFormatter.format(startedAt),
        row.stoppedAt ? timeFormatter.format(new Date(row.stoppedAt)) : "Running",
        formatExportDuration(row.durationSeconds),
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

const dateFormat: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
};

const timeFormat: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit"
};
