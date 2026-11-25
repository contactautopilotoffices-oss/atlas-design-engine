-- ATLAS Design Engine: initial schema
-- Mirrors src/modules/core/schemas.ts. Top-level fields are columns (snake_case);
-- nested blocks are jsonb. All access goes through the Next.js server using the
-- service-role key, so RLS is enabled with NO anon/authenticated policies (deny by default).

create extension if not exists vector;

-- ------------------------------------------------------------------ configuration
create table if not exists room_types (
  id text primary key,
  name text not null,
  description text not null default '',
  sort_order integer not null default 0,
  spatial_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists materials (
  id text primary key,
  name text not null,
  category text not null default 'general',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists offerings (
  id text primary key,
  name text not null,
  description text not null default '',
  rank integer not null default 0,
  is_demo boolean not null default false,
  rules jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists properties (
  id text primary key,
  name text not null,
  city text not null default '',
  address text not null default '',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists floor_plans (
  id text primary key,
  property_id text not null references properties(id) on delete cascade,
  name text not null,
  is_sample boolean not null default false,
  sample_notice text not null default '',
  unit text not null default 'm' check (unit in ('m', 'ft')),
  width double precision not null check (width > 0),
  height double precision not null check (height > 0),
  rooms jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_settings (
  id text primary key check (id = 'app'),
  prompt_instructions jsonb not null default '[]'::jsonb,
  negative_prompt text not null default '',
  default_model_id text not null,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ reference library
create table if not exists projects (
  id text primary key,
  name text not null,
  client_name text not null default '',
  property_name text not null default '',
  city text not null default '',
  category text not null default '',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists source_documents (
  id text primary key,
  project_id text not null references projects(id) on delete restrict,
  filename text not null,
  mime_type text not null,
  kind text not null check (kind in ('pdf', 'pptx', 'image')),
  size_bytes bigint not null,
  sha256 char(64) not null,
  blob_key text not null,
  status text not null check (status in ('uploaded', 'processing', 'processed', 'partial', 'failed')),
  page_count integer,
  extracted_image_count integer not null default 0,
  duplicate_image_count integer not null default 0,
  page_text jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  uploaded_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (project_id, sha256)
);

create table if not exists reference_assets (
  id text primary key,
  reference_code text not null unique,
  project_id text not null references projects(id) on delete restrict,
  document_id text not null references source_documents(id) on delete restrict,
  source_filename text not null,
  source_kind text not null check (source_kind in ('pdf-page', 'pptx-slide', 'image-file')),
  source_page integer,
  source_text text not null default '',
  image_sha256 char(64) not null,
  blob_key text not null,
  thumb_key text not null,
  mime_type text not null,
  width integer not null,
  height integer not null,
  metadata jsonb not null,
  provenance jsonb not null default '{}'::jsonb,
  analysis jsonb not null default '{}'::jsonb,
  review_status text not null check (review_status in ('pending', 'approved', 'rejected', 'needs_review')),
  reviewed_by text,
  reviewed_at timestamptz,
  is_demo boolean not null default false,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, image_sha256)
);
create index if not exists reference_assets_room_type_idx on reference_assets ((metadata->>'roomTypeId'));
create index if not exists reference_assets_review_idx on reference_assets (review_status);
create index if not exists reference_assets_metadata_gin on reference_assets using gin (metadata jsonb_path_ops);

-- Embeddings live in their own table so ordinary reads stay small.
-- Not populated until an embedding provider is configured (semantic search is NOT live).
create table if not exists reference_embeddings (
  reference_id text primary key references reference_assets(id) on delete cascade,
  model text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

create table if not exists design_directions (
  id text primary key,
  name text not null,
  description text not null default '',
  status text not null check (status in ('suggested', 'approved', 'archived')),
  source text not null check (source in ('discovered', 'manual', 'merged')),
  reference_ids jsonb not null default '[]'::jsonb,
  signature jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ sessions & selections
create table if not exists design_sessions (
  id text primary key,
  owner_token_hash text not null,
  property_id text not null references properties(id),
  floor_plan_id text not null references floor_plans(id),
  offering_id text not null references offerings(id),
  client_name text not null default '',
  status text not null default 'active' check (status in ('active', 'submitted_for_review', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists design_sessions_owner_idx on design_sessions (owner_token_hash);

create table if not exists design_selections (
  id text primary key,
  session_id text not null references design_sessions(id) on delete cascade,
  room_id text not null,
  room_type_id text not null,
  reference_id text not null references reference_assets(id),
  snapshot jsonb not null,
  offering_id text not null references offerings(id),
  revision integer not null check (revision > 0),
  submitted_at timestamptz not null default now(),
  unique (session_id, room_id)
);

create table if not exists selection_revisions (
  id text primary key,
  selection_id text not null references design_selections(id) on delete cascade,
  session_id text not null references design_sessions(id) on delete cascade,
  room_id text not null,
  room_type_id text not null,
  reference_id text not null references reference_assets(id),
  snapshot jsonb not null,
  offering_id text not null references offerings(id),
  revision integer not null check (revision > 0),
  submitted_at timestamptz not null default now(),
  note text not null default '',
  -- Guarantees two concurrent submits can never share a revision number.
  unique (session_id, room_id, revision)
);

create table if not exists room_specs (
  id text primary key,
  session_id text not null references design_sessions(id) on delete cascade,
  room_id text not null,
  spec jsonb not null,
  issues jsonb not null default '[]'::jsonb,
  classification jsonb not null,
  is_valid boolean not null,
  updated_at timestamptz not null default now(),
  unique (session_id, room_id)
);

-- ------------------------------------------------------------------ generation & review
create table if not exists generation_jobs (
  id text primary key,
  batch_id text not null,
  session_id text not null references design_sessions(id) on delete cascade,
  room_id text not null,
  status text not null check (status in ('draft', 'submitted', 'queued', 'processing', 'completed', 'failed', 'cancelled')),
  model_id text not null,
  settings jsonb not null default '{}'::jsonb,
  brief jsonb not null,
  prompt text not null,
  negative_prompt text not null default '',
  reference_inputs jsonb not null default '[]'::jsonb,
  refinement_of_asset_id text,
  idempotency_key text not null unique,
  provider_request_id text,
  provider_status_url text,
  provider_cancel_url text,
  provider_raw_status text,
  attempts integer not null default 0,
  next_poll_at timestamptz,
  error text,
  cost_note text not null default '',
  output_asset_ids jsonb not null default '[]'::jsonb,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz
);
create index if not exists generation_jobs_session_idx on generation_jobs (session_id, room_id);

create table if not exists generated_assets (
  id text primary key,
  job_id text not null references generation_jobs(id) on delete cascade,
  session_id text not null references design_sessions(id) on delete cascade,
  room_id text not null,
  blob_key text not null,
  provider_url text,
  mime_type text not null,
  review_status text not null check (review_status in ('unreviewed', 'approved', 'rejected', 'iteration_requested')),
  is_handoff_asset boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists designer_reviews (
  id text primary key,
  session_id text not null references design_sessions(id) on delete cascade,
  room_id text not null,
  generated_asset_id text references generated_assets(id) on delete set null,
  action text not null check (action in ('comment', 'approve', 'reject', 'request_iteration')),
  comment text not null default '',
  reviewer text not null,
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id text primary key,
  action text not null,
  actor text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists audit_log_at_idx on audit_log (at desc);

-- ------------------------------------------------------------------ sequences (REF-00001 codes)
create table if not exists atlas_sequences (
  name text primary key,
  value bigint not null default 0
);

create or replace function atlas_next_sequence(seq_name text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into atlas_sequences (name, value) values (seq_name, 1)
  on conflict (name) do update set value = atlas_sequences.value + 1
  returning value into v;
  return v;
end;
$$;
revoke all on function atlas_next_sequence(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ row level security
-- Enabled everywhere with no policies: anon and authenticated roles can read/write nothing.
-- The server uses the service-role key (bypasses RLS) and enforces ownership and roles itself.
alter table room_types enable row level security;
alter table materials enable row level security;
alter table offerings enable row level security;
alter table properties enable row level security;
alter table floor_plans enable row level security;
alter table app_settings enable row level security;
alter table projects enable row level security;
alter table source_documents enable row level security;
alter table reference_assets enable row level security;
alter table reference_embeddings enable row level security;
alter table design_directions enable row level security;
alter table design_sessions enable row level security;
alter table design_selections enable row level security;
alter table selection_revisions enable row level security;
alter table room_specs enable row level security;
alter table generation_jobs enable row level security;
alter table generated_assets enable row level security;
alter table designer_reviews enable row level security;
alter table audit_log enable row level security;
alter table atlas_sequences enable row level security;
