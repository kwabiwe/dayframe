import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { buildReportCsv } from "@/lib/report-csv";
import { parseReportQueryInput } from "@/lib/report-filters";
import { getReportExportRows } from "@/lib/report-service";
import { viewerTimeZoneForRequest } from "@/lib/viewer-time-zone-server";

export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request, { requiredScopes: ["exports:read"] });
    const url = new URL(request.url);
    // The web export link carries the viewer's zone cookie; other callers keep UTC.
    const timeZone = viewerTimeZoneForRequest(request);
    const input = parseReportQueryInput(Object.fromEntries(url.searchParams.entries()), { timeZone });
    const report = await getReportExportRows(session, input);
    const csv = buildReportCsv(report.rows, { timeZone });
    const filename = `dayframe-report-${report.range.from}-to-${report.range.to}.csv`;

    return new Response(csv, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`
      }
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
