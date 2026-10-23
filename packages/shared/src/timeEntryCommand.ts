import { z } from "zod";

/**
 * The iPhone time-entry outbox's stable command id (stability audit 22 Oct 2026, item 17). Every
 * Edit (PATCH) and Delete (DELETE) the outbox delivers carries the command's own `clientCommandId`
 * in this header, unchanged across retries. The server records it with the edit and answers a
 * resend of an edit it already applied as success without applying it again. Optional: a request
 * without it (web, older iPhone builds) behaves exactly as before.
 */
export const TIME_ENTRY_CLIENT_COMMAND_ID_HEADER = "X-Dayframe-Client-Command-Id";

export const TimeEntryClientCommandIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9:._-]+$/);
