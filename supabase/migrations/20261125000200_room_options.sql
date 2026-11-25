-- Room options popup: a client can choose an AI-generated design; small pictures are counted, not stored.
alter table design_selections add column if not exists generated_asset_id text references generated_assets(id) on delete set null;
alter table selection_revisions add column if not exists generated_asset_id text references generated_assets(id) on delete set null;
alter table source_documents add column if not exists skipped_small_count integer not null default 0;
