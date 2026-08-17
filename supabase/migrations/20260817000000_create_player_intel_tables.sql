-- Migration: Create Player Intel & Campaigns tables for Terra Invicta Strategic Dashboard
-- Description: Stores public campaign metadata and technology-gated Player Intel snapshots per observer faction.

create extension if not exists pgcrypto;

-- 1. Campaigns Table
create table if not exists public.campaigns (
  campaign_key text primary key,
  display_name text not null,
  is_public boolean not null default true,
  current_save_last_modified timestamptz,
  current_game_time text,
  current_save_filename text,
  updated_at timestamptz not null default now()
);

comment on table public.campaigns is 'Campaign metadata and current active save pointer.';

-- 2. Player Intel Snapshots Table
create table if not exists public.player_intel_snapshots (
  id uuid primary key default gen_random_uuid(),
  campaign_key text not null references public.campaigns(campaign_key) on delete cascade,
  save_filename text not null,
  save_last_modified timestamptz not null,
  game_time text,
  difficulty text,
  campaign_start_year integer,
  observer_faction_id integer not null,
  observer_faction_name text,
  snapshot jsonb not null,
  chatgpt_export jsonb,
  visibility text not null default 'player' check (visibility = 'player'),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(campaign_key, save_last_modified, observer_faction_id)
);

comment on table public.player_intel_snapshots is 'Sanitized technology-gated Player Intel snapshots per observer faction. Raw and Omniscient data are strictly excluded.';

-- 3. Indexes
create index if not exists idx_player_intel_snapshots_lookup
  on public.player_intel_snapshots (campaign_key, observer_faction_id, save_last_modified desc);

create index if not exists idx_player_intel_snapshots_campaign_modified
  on public.player_intel_snapshots (campaign_key, save_last_modified desc);

-- 4. Row Level Security (RLS)
alter table public.campaigns enable row level security;
alter table public.player_intel_snapshots enable row level security;

-- Policies for public.campaigns:
-- Explicitly allow anon and authenticated to SELECT public campaigns only.
create policy "Allow select for public campaigns"
  on public.campaigns
  for select
  to anon, authenticated
  using (is_public = true);

-- Policies for public.player_intel_snapshots:
-- Explicitly allow anon and authenticated to SELECT player-visible snapshots belonging to public campaigns.
create policy "Allow select for public player intel snapshots"
  on public.player_intel_snapshots
  for select
  to anon, authenticated
  using (
    visibility = 'player'
    and exists (
      select 1 from public.campaigns c
      where c.campaign_key = player_intel_snapshots.campaign_key
        and c.is_public = true
    )
  );

-- 5. Grants
-- Grant SELECT permissions to public roles (anon and authenticated).
-- Note: INSERT, UPDATE, DELETE permissions are NOT granted to anon/authenticated.
-- Service role retains full administrative access.
revoke all on table public.campaigns from anon, authenticated;
revoke all on table public.player_intel_snapshots from anon, authenticated;
grant select on public.campaigns to anon, authenticated;
grant select on public.player_intel_snapshots to anon, authenticated;
grant select, insert, update, delete on public.campaigns to service_role;
grant select, insert, update, delete on public.player_intel_snapshots to service_role;
