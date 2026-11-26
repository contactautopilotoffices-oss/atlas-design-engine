-- Tiered offering guidance, cached floor-plan AI previews, and configurable BOQ rate card items.
alter table offerings add column if not exists tier_guidance text not null default '';
alter table floor_plans add column if not exists previews jsonb not null default '[]'::jsonb;
alter table app_settings add column if not exists currency text not null default 'INR';
alter table generation_jobs add column if not exists tier_offering_id text references offerings(id) on delete set null;
alter table generated_assets add column if not exists tier_offering_id text references offerings(id) on delete set null;

create table if not exists boq_items (
  id text primary key,
  offering_id text not null references offerings(id) on delete cascade,
  category text not null check (category in ('civil_partitions', 'flooring', 'ceiling', 'wall_finishes', 'lighting_electrical', 'furniture', 'av_hvac_misc')),
  name text not null,
  specification text not null default '',
  unit text not null,
  basis text not null check (basis in ('floor_area_sqft', 'wall_area_sqft', 'ceiling_area_sqft', 'seat_count', 'room_fixed')),
  multiplier double precision not null default 1 check (multiplier > 0),
  unit_rate double precision not null check (unit_rate >= 0),
  room_type_ids jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists boq_items_offering_idx on boq_items (offering_id);
alter table boq_items enable row level security;
