import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import {
  createManualEntry,
  duplicateFinishedEntry,
  joinSplitEntries,
  processActivityEvent,
  splitActiveEntry,
  splitFinishedEntry,
  TimeEntryConflictError,
  TimeEntryNotFoundError,
  TimeEntryValidationError,
  TimerMutationBusyError,
  TimerReplacementWindowError,
  TimerStopBeforeStartError
} from "@/lib/event-service";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import {
  ManualTimeEntryValidationError,
  validateManualTimeEntryWindow
} from "@/lib/manual-time-entry";
import { getTimeEntryById } from "@/lib/queries";
import { ExpectedUpdatedAtSchema } from "@/lib/time-entry-details-precondition";
import { TagNameSchema, TIME_ENTRY_CLIENT_COMMAND_ID_HEADER, TimeEntryClientCommandIdSchema } from "@dayframe/shared";
import { scheduleLiveActivityNotification } from "@/lib/live-activity-post-response";

export async function POST(request: Request) {
  let session: Awaited<ReturnType<typeof resolveRequestSession>> | null = null;
  let entryId: string | null = null;
  try {
    session = await resolveRequestSession(request);
    const body = await parseJsonBody(request);
    const modeResult = z.enum(["start", "stop", "manual", "split", "duplicate", "join"]).safeParse(body.mode);
    if (!modeResult.success) {
      throw new BadRequestError("mode must be one of start, stop, manual, split, duplicate, or join.");
    }
    const mode = modeResult.data;
    const eventSource = body.source === "mobile_app" ? "mobile_app" : "manual_app";
    const origin = eventSource === "mobile_app" ? "mobile_timer" : "web_timer";
    const tagNames = optionalTagNames(body.tagNames);

    if (mode === "manual") {
      const now = new Date();
      const { startedAt, stoppedAt } = validateManualTimeEntryWindow({
        now,
        startedAt: requiredString(body.startedAt, "startedAt"),
        stoppedAt: requiredString(body.stoppedAt, "stoppedAt")
      });
      await createManualEntry(
        {
          projectId: optionalString(body.projectId),
          categoryId: optionalString(body.categoryId),
          placeId: optionalString(body.placeId),
          description: optionalString(body.description),
          startedAt,
          stoppedAt,
          ...(tagNames ? { tagNames } : {})
        },
        session
      );
      scheduleLiveActivityNotification(session);
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    if (mode === "stop") {
      const targetEntryId = optionalUuid(body.entryId, "entryId");
      const result = await processActivityEvent(
        {
          source: eventSource,
          type: "timer_stop",
          occurredAt: new Date(),
          rawPayload: targetEntryId
            ? { origin, stopScope: "entry", targetEntryId }
            : { origin }
        },
        session
      );
      scheduleLiveActivityNotification(session);
      return NextResponse.json(result, { status: 201 });
    }

    // Undo of a split: the block `splitEntryId` that splitting `entryId` made goes, and `entryId` takes its
    // end again (running again when that block ran). The client command id header makes a retry safe.
    if (mode === "join") {
      entryId = optionalUuid(body.entryId, "entryId") ?? null;
      const splitEntryId = optionalUuid(body.splitEntryId, "splitEntryId");
      if (!entryId || !splitEntryId) throw new BadRequestError("entryId and splitEntryId are required.");
      const result = await joinSplitEntries(entryId, { splitEntryId, clientCommandId: requestClientCommandId(request) }, session);
      scheduleLiveActivityNotification(session);
      // The joined block as it is now, so the timer shows it without waiting for the day to load again.
      return NextResponse.json({ ok: true, ...result, entry: await getTimeEntryById(session, entryId) }, { status: 200 });
    }

    // Card G: Split (at `splitAt`) or Duplicate a block, `entryId`, with every detail, in one transaction;
    // `expectedUpdatedAt` refuses a block changed elsewhere (409), and the client command id header makes
    // a retry safe. A running block splits too: its second part keeps running (owner 28 Oct 2026).
    const finishedEntryId = (mode === "split" || mode === "duplicate") ? optionalUuid(body.entryId, "entryId") : undefined;
    if (finishedEntryId) {
      entryId = finishedEntryId;
      const expectedUpdatedAt = body.expectedUpdatedAt == null ? undefined : ExpectedUpdatedAtSchema.parse(body.expectedUpdatedAt);
      const clientCommandId = requestClientCommandId(request);
      const result = mode === "split"
        ? await splitFinishedEntry(finishedEntryId, {
          splitAt: requiredTimestamp(body.splitAt, "splitAt"), expectedUpdatedAt, clientCommandId, source: eventSource
        }, session)
        : await duplicateFinishedEntry(finishedEntryId, { expectedUpdatedAt, clientCommandId }, session);
      scheduleLiveActivityNotification(session);
      // Both blocks as they are now (on a repeat too): whether the second part runs is read from them.
      const reader = session;
      const entries = (await Promise.all([finishedEntryId, result.newEntryId].map((id) => id ? getTimeEntryById(reader, id) : null)))
        .filter((entry) => entry !== null);
      return NextResponse.json({ ok: true, ...result, entries }, { status: result.replayed ? 200 : 201 });
    }
    if (mode === "duplicate") throw new BadRequestError("entryId is required.");

    if (mode === "split") {
      await splitActiveEntry(session);
      scheduleLiveActivityNotification(session);
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    const startedAt = optionalTimestamp(body.startedAt, "startedAt");
    const occurredAt = startedAt ? new Date(startedAt) : new Date();
    const rawPayload = {
      ...(startedAt ? { origin, startedAt } : { origin }),
      ...(tagNames ? { tagNames } : {})
    };

    const result = await processActivityEvent(
      {
        source: eventSource,
        type: "timer_start",
        occurredAt,
        projectId: optionalString(body.projectId),
        categoryId: optionalString(body.categoryId),
        placeId: optionalString(body.placeId),
        description: optionalString(body.description),
        rawPayload
      },
      session
    );
    scheduleLiveActivityNotification(session);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof TimeEntryNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof TimeEntryConflictError && session && entryId) {
      const entry = await getTimeEntryById(session, entryId);
      return NextResponse.json({ error: error.message, code: "time_entry_details_conflict", entry }, { status: 409 });
    }
    if (error instanceof TimeEntryValidationError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof TimerReplacementWindowError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof TimerStopBeforeStartError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status });
    }
    if (error instanceof TimerMutationBusyError) {
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: error.status }
      );
    }
    if (
      error instanceof ZodError ||
      error instanceof BadRequestError ||
      error instanceof ManualTimeEntryValidationError
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Dayframe timer action failed", error);
    return NextResponse.json(
      {
        error:
          "Unable to save this block. Confirm the hosted database migrations are applied, then try again."
      },
      { status: 500 }
    );
  }
}

class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalUuid(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new BadRequestError(`${field} must be a valid UUID.`);
  return parsed.data;
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new BadRequestError("Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestError("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string) {
  const next = optionalString(value);
  if (!next) throw new BadRequestError(`${field} is required.`);
  return next;
}

function requiredTimestamp(value: unknown, field: string) {
  const next = optionalTimestamp(value, field);
  if (!next) throw new BadRequestError(`${field} is required.`);
  return next;
}

function requestClientCommandId(request: Request) {
  const header = request.headers.get(TIME_ENTRY_CLIENT_COMMAND_ID_HEADER);
  if (header === null) return undefined;
  const parsed = TimeEntryClientCommandIdSchema.safeParse(header);
  if (!parsed.success) throw new BadRequestError(`${TIME_ENTRY_CLIENT_COMMAND_ID_HEADER} is malformed.`);
  return parsed.data;
}

function optionalTimestamp(value: unknown, field: string) {
  const next = optionalString(value);
  if (!next) return undefined;
  const parsed = new Date(next);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestError(`${field} must be a valid date.`);
  if (parsed.getTime() > Date.now()) throw new BadRequestError(`${field} cannot be in the future.`);
  return parsed.toISOString();
}

function optionalTagNames(value: unknown) {
  if (value === undefined) return undefined;
  return z.array(TagNameSchema).max(24).parse(value);
}
