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
