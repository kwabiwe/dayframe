import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { SyncOperationError, withSyncTransaction } from "@/lib/sync-transaction";
import { resolveRequestSession } from "@/lib/ingest-auth";

const LIMIT = 128;
const MAX_LOCAL_DAY_MS = 27 * 60 * 60 * 1000;
const filters = z.object({
  from: z.iso.datetime(),
  through: z.iso.datetime(),
  exclude: z.uuid().optional()
});

/** Stop-time candidates for one viewer-local day, newest first. Reads only this session's own blocks. */
export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request, { requiredScopes: ["app:read"] });
    const { searchParams } = new URL(request.url);
    const parsed = filters.safeParse({
      from: searchParams.get("from"), through: searchParams.get("through"), exclude: searchParams.get("exclude") ?? undefined
    });
    if (!parsed.success) return NextResponse.json({ error: "Invalid stop time window." }, { status: 400 });
    const { from, through, exclude } = parsed.data;
    const span = Date.parse(through) - Date.parse(from);
    if (!Number.isFinite(span) || span < 0 || span >= MAX_LOCAL_DAY_MS) {
      return NextResponse.json({ error: "Choose a stop time window within one local day." }, { status: 400 });
    }

    // Use the existing partial completed-overlap index. The extra row distinguishes an empty
    // eligible range from one whose older candidates were not included in the bounded response.
    const result = await withSyncTransaction("last_stop_candidates", async ({ client, phase }) => {
      phase("canonical_read");
      return client.query<{ id: string; stoppedAt: Date }>(
        `select id, stopped_at as "stoppedAt"
         from time_entries
         where workspace_id = $1 and user_id = $2
           and review_status in ('confirmed', 'accepted')
           and started_at <= $4::timestamptz
           and stopped_at >= $3::timestamptz and stopped_at <= $4::timestamptz
           and ($5::uuid is null or id <> $5::uuid)
         order by stopped_at desc, id
         limit $6`,
        [session.workspaceId, session.userId, from, through, exclude ?? null, LIMIT + 1]
      );
    }, { readOnly: true, signal: request.signal, deadlineAt: Date.now() + 4_000 });
    return NextResponse.json({ rows: result.rows.slice(0, LIMIT), truncated: result.rows.length > LIMIT }, {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof SyncOperationError) return NextResponse.json({ error: "Previous blocks are temporarily unavailable." }, { status: 503 });
    throw error;
  }
}
