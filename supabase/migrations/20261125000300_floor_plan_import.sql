-- Floor-plan import: imported plans start as drafts and are published after a person checks them.
alter table floor_plans add column if not exists status text not null default 'published' check (status in ('draft', 'published'));
alter table floor_plans add column if not exists source jsonb;
alter table floor_plans add column if not exists background jsonb;
alter table floor_plans add column if not exists scale jsonb;
create index if not exists floor_plans_property_idx on floor_plans (property_id);
