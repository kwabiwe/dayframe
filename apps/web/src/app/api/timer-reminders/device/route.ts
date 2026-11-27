import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { sessionTokenFromRequest } from "@/lib/auth/local";
import { isForgottenTimerDeviceRegistered, registerForgottenTimerDevice, unregisterForgottenTimerDevice } from "@/lib/forgotten-timer-devices";
import { resolveRequestSession } from "@/lib/ingest-auth";

const Device = z.object({
  token: z.string().regex(/^[0-9a-f]{32,512}$/i).transform((token) => token.toLowerCase()),
  environment: z.enum(["development", "production"])
});

export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request, { requiredScopes: ["app:read"] });
    const token = sessionTokenFromRequest(request);
    if (!token) return new NextResponse(null, { status: 401 });
    return NextResponse.json({ enabled: await isForgottenTimerDeviceRegistered(session, token) }, {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) {
    return authErrorResponse(error) ?? new NextResponse(null, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request, { requiredScopes: ["app:write"] });
    const token = sessionTokenFromRequest(request);
    if (!token) return new NextResponse(null, { status: 401 });
    const reader = request.body?.getReader();
    if (!reader) return new NextResponse(null, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) {
        await reader.cancel();
        return new NextResponse(null, { status: 413 });
      }
      chunks.push(value);
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return new NextResponse(null, { status: 400 });
    }
    const device = Device.safeParse(body);
    if (!device.success) return new NextResponse(null, { status: 400 });
    return new NextResponse(null, {
      status: await registerForgottenTimerDevice(session, token, device.data) ? 204 : 401
    });
  } catch (error) {
    return authErrorResponse(error) ?? new NextResponse(null, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await resolveRequestSession(request, { requiredScopes: ["app:write"] });
    const token = sessionTokenFromRequest(request);
    if (!token) return new NextResponse(null, { status: 401 });
    await unregisterForgottenTimerDevice(session, token);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return authErrorResponse(error) ?? new NextResponse(null, { status: 500 });
  }
}
