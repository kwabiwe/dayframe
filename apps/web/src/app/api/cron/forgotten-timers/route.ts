import { NextResponse } from "next/server";
import { sendDueForgottenTimerReminders } from "@/lib/forgotten-timer-devices";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 401 });
  }
  try {
    return NextResponse.json(await sendDueForgottenTimerReminders(), {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch {
    return NextResponse.json({ error: "Timer reminder delivery failed." }, { status: 500 });
  }
}
