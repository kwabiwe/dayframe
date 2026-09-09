import { NextResponse } from "next/server";
import { ReportSummaryRequestSchema } from "@dayframe/shared";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { authErrorResponse } from "@/lib/api-errors";
import { getMobileReportSummary } from "@/lib/mobile-report-summary";

export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request, {
      requiredScopes: ["app:read"],
    });
    // Bound the body as well as the number of buckets, including chunked requests.
    const reader = request.body?.getReader();
    if (!reader)
      return NextResponse.json(
        { error: "Invalid report range" },
        { status: 400 },
      );
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 100_000) {
        await reader.cancel();
        return NextResponse.json(
          { error: "Report request too large" },
          { status: 413 },
        );
      }
      chunks.push(part.value);
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return NextResponse.json(
        { error: "Invalid report range" },
        { status: 400 },
      );
    }
    const parsed = ReportSummaryRequestSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json(
        { error: "Invalid report range or buckets" },
        { status: 400 },
      );
    return NextResponse.json(
      await getMobileReportSummary(session, parsed.data),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Unable to load report" }, { status: 500 })
    );
  }
}
