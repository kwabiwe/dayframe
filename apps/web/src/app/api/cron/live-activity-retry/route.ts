import { NextResponse } from "next/server";
import { reconcileLiveActivityDesiredState } from "@/lib/live-activity-push";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await reconcileLiveActivityDesiredState();
    if (result.retryScheduled || result.permanentFailures || result.invalidatedTokens) {
      console.warn("Scheduled Live Activity outbox reconciliation completed with diagnostics", {
        claimed: result.claimed,
        delivered: result.delivered,
        retryScheduled: result.retryScheduled,
        permanentFailures: result.permanentFailures,
        invalidatedTokens: result.invalidatedTokens
      });
    }
    return NextResponse.json({ ok: true, ...result }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" }
    });
  } catch (error) {
    console.error("Scheduled Live Activity outbox reconciliation failed", {
      name: error instanceof Error ? error.name : "UnknownError"
    });
    return NextResponse.json({ error: "Live Activity reconciliation failed." }, { status: 500 });
  }
}
