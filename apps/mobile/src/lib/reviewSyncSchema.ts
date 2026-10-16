// Additive v4→v5 migration. Execute inside the existing exclusive transaction,
// after older migrations, and before advancing user_version. No queued action
// or compatibility column is removed.
export const REVIEW_EFFECTS_V5_SQL = `
  create unique index if not exists review_mutation_owner_idx
    on review_mutation_outbox(client_mutation_id, account_key);
  create table if not exists review_mutation_effects (
    client_mutation_id text not null,
    account_key text not null,
    review_item_id text not null,
    snapshot_json text not null,
    original_position integer not null,
    preceding_ids_json text not null,
    following_ids_json text not null,
    local_effect text not null default 'hidden',
    primary key(client_mutation_id, review_item_id),
    unique(account_key, review_item_id),
    foreign key(client_mutation_id, account_key) references review_mutation_outbox(client_mutation_id, account_key) on delete cascade,
    foreign key(account_key) references review_account_context(account_key) on delete cascade,
    check(local_effect in ('hidden', 'restore'))
  );
  insert or ignore into review_mutation_effects (
    client_mutation_id, account_key, review_item_id, snapshot_json,
    original_position, preceding_ids_json, following_ids_json, local_effect
  ) select client_mutation_id, account_key, review_item_id, original_snapshot_json,
    original_position, preceding_ids_json, following_ids_json, local_effect
    from review_mutation_outbox;
`;

// Additive v5→v6 recovery metadata. Original UUIDs, hashes, payloads, creation
// times and effect anchors are untouched. Apply atomically with user_version.
export const REVIEW_RECOVERY_V6_SQL = `
  alter table review_mutation_outbox add column contention_count integer not null default 0;
  alter table review_mutation_outbox add column reconciliation_attempt_count integer not null default 0;
  alter table review_mutation_outbox add column last_reconciled_at text;
  alter table review_mutation_outbox add column resolution_status text;
  alter table review_mutation_outbox add column acknowledgement_json text;
`;

// Additive v6→v7 presentation evidence. This is intentionally separate from
// the Review outbox/effects tables: contexts are bounded display coverage, not
// a second mutation queue or a replacement canonical-entry store.
export const REVIEW_PRESENTATION_V7_SQL = `
  create table if not exists review_presentation_context (
    account_key text not null,
    scope_key text not null,
    backend_id text not null,
    contract_version integer not null,
    snapshot_token text not null,
    captured_at text not null,
    cached_at text not null,
    complete integer not null default 0,
    context_json text not null,
    primary key(account_key, scope_key),
    foreign key(account_key) references review_account_context(account_key) on delete cascade,
    check(complete in (0, 1))
  );
  create index if not exists review_presentation_context_recent_idx
    on review_presentation_context(account_key, cached_at desc);
  create table if not exists review_presentation_terminal_source (
    account_key text not null,
    review_item_id text not null,
    scope_key text not null,
    backend_id text not null,
    snapshot_token text not null,
    status text not null,
    captured_at text not null,
    primary key(account_key, review_item_id),
    foreign key(account_key) references review_account_context(account_key) on delete cascade,
    check(status in ('accepted', 'ignored', 'missing'))
  );
`;

// v8→v9 "Save this place" (PRD D19, design §7): a `save_place` row keeps its card open, so it owns
// no source effect and must not block the card's own later decision. The one-row-per-card index
// becomes partial (every action but `save_place`), and a second partial index keeps one pending
// `save_place` per card. Indexes only: no row, column or table changes.
export const REVIEW_SAVE_PLACE_V9_SQL = `
  drop index if exists review_mutation_item_active_idx;
  create unique index review_mutation_item_active_idx
    on review_mutation_outbox(account_key, review_item_id) where action_kind <> 'save_place';
  create unique index if not exists review_mutation_save_place_idx
    on review_mutation_outbox(account_key, review_item_id) where action_kind = 'save_place';
`;

// Additive v7→v8 open observations (investigation 2026-10-12). The latest server time at which a
// presentation read listed a Review source open, per account, source and backend. Terminal
// evidence is in force only while no strictly newer open observation exists, so the order in
// which delayed reads, settlements and reopenings arrive, and the pruning of display contexts,
// can no longer hide a reopened source or show a decided one.
export const REVIEW_OBSERVATION_V8_SQL = `
  create table if not exists review_source_open_observation (
    account_key text not null,
    review_item_id text not null,
    backend_id text not null,
    observed_at text not null,
    primary key(account_key, review_item_id, backend_id),
    foreign key(account_key) references review_account_context(account_key) on delete cascade
  );
`;
