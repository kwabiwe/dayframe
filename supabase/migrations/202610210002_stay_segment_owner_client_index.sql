-- Named patterns on Today (location v3 PR 14, PRD D19 A9): the server finds the stays at each end
-- of a logged Move by owner and client segment id. The existing unique index leads with device_id
-- (and is partial on it), so that lookup would scan a person's whole stay history.
--
-- Additive and optional for correctness (without it the read is slower, not wrong); apply to
-- staging and then production in the usual order. No RLS change.
create index if not exists idx_stay_segments_owner_client
  on public.stay_segments(workspace_id, user_id, client_segment_id)
  where client_segment_id is not null;
