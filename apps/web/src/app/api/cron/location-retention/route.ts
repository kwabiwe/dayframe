import { NextResponse } from "next/server";
import { deleteExpiredLocationEvidence } from "@/lib/location/location-retention-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await deleteExpiredLocationEvidence();
    if (result.backlogPossible) {
      console.warn("Location evidence retention reached its bounded batch limit", {
        deletedEvidenceCount: result.deletedEvidenceCount,
        batches: result.batches
      });
    }
    return NextResponse.json({ ok: true, ...result }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" }
    });
  } catch (error) {
    console.error("Location evidence retention failed", {
      name: error instanceof Error ? error.name : "UnknownError"
    });
    return NextResponse.json({ error: "Location evidence retention failed." }, { status: 500 });
  }
}
