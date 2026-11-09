/**
 * Where a block's end came from (PRD D20, stability audit server-1): shared by the timer paths in
 * `event-service.ts` and by the timer-into-a-trip question, which asks only about an end a timer gave.
 */

/** Marks the events of an explicit Start the server processed (stripped from client input). */
export const SERVER_TIMER_START_KEY = "serverTimerStart";

/**
 * The audit action recorded when a person moves a block's end through an edit. Only an end still equal
 * to the one recorded counts: one a later Stop or Start has since moved is no longer the person's.
 * `user_edited_at` can't tell this apart, since a saved title, activity or tags sets it too (Codex r3 on
 * #531).
 */
export const PERSON_SET_END_ACTION = "time_entry.end_set";
/** The audit action recorded by every other person edit, so the edit is never mistaken for a legacy one. */
export const PERSON_EDIT_ACTION = "time_entry.edited";
/**
 * An edit made before edits were recorded (Codex r4 on #531): `user_edited_at` is set but no recorded
 * edit explains it. Every edit path that sets `user_edited_at` also writes one of the actions above in
 * the same transaction with `created_at = user_edited_at`, so only an edit made by earlier code (or one
 * recorded by a path that forgot to) reads as legacy, and its end is kept as before this change. This
 * needs no backfill and no deploy-time cutoff: it holds whenever each database gets the new code.
 */
export const LEGACY_PERSON_EDIT_SQL = `(te.user_edited_at is not null and not exists (
  select 1 from audit_log a
  where a.workspace_id = te.workspace_id and a.entity_type = 'time_entry' and a.entity_id = te.id
    and a.action in ('${PERSON_SET_END_ACTION}', '${PERSON_EDIT_ACTION}')
    and a.created_at >= te.user_edited_at
))`;
export const PERSON_SET_END_SQL = `(exists (
  select 1 from audit_log a
  where a.workspace_id = te.workspace_id and a.entity_type = 'time_entry' and a.entity_id = te.id
    and a.action = '${PERSON_SET_END_ACTION}'
    and (a.metadata->>'stoppedAt')::timestamptz = te.stopped_at
) or ${LEGACY_PERSON_EDIT_SQL})`;
/**
 * A block a timer started: one inserted when an explicit Start (app, web, Shortcut, NFC, quick action,
 * split) was processed, so it ran and its end came from the timer lifecycle unless a person set it.
 * Since #538 the server marks each such event (`serverTimerStart`, stripped from client input). An older
 * event has no mark: it counts unless it has the manual-entry shape, a `manual_app` `timer_start` with no
 * `origin` (`createManualEntry` never writes one, every built-in web timer Start does), which stays
 * ambiguous and so is kept, like a block with no creating event left. Review, Location and Health blocks
 * come from other event types (stability audit server-1). No migration or backfill.
 */
export const TIMER_STARTED_SQL = `(exists (
  select 1 from activity_events ae
  where ae.id = te.created_from_event_id and ae.workspace_id = te.workspace_id and ae.user_id = te.user_id
    and ae.event_type in ('timer_start', 'timer_switch', 'quick_action', 'nfc_action', 'shortcut_action')
    and (ae.raw_payload->>'${SERVER_TIMER_START_KEY}' = 'true'
      or not (ae.source = 'manual_app' and ae.event_type = 'timer_start' and not (ae.raw_payload ? 'origin')))
))`;
