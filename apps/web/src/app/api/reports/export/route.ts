import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { buildReportCsv } from "@/lib/report-csv";
import { parseReportQueryInput } from "@/lib/report-filters";
import { getReportExportRows } from "@/lib/report-service";

export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request, { requiredScopes: ["exports:read"] });
    const url = new URL(request.url);
    const input = parseReportQueryInput(Object.fromEntries(url.searchParams.entries()));
    const report = await getReportExportRows(session, input);
    const csv = buildReportCsv(report.rows);
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
