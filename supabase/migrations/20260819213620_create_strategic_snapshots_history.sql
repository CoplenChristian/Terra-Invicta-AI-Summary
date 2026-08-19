-- Compact strategic history for trend/delta analysis.
-- Purely additive: creates a new table and helper functions. Deletes nothing.
-- See docs/strategic-history-and-war-room-plan.md
--
-- Applied to project wckfkfczckgdggefbcok on 2026-08-19 as version 20260819213620.

create table if not exists public.strategic_snapshots (
    id                 uuid primary key default gen_random_uuid(),

    campaign_key       text        not null
                       references public.campaigns(campaign_key) on delete cascade,
    save_last_modified timestamptz not null,
    save_filename      text,
    game_time          text,
    campaign_date      timestamptz not null,

    schema_version     int         not null default 1,
    payload            jsonb       not null,

    created_at         timestamptz not null default now(),

    -- Save identity in this database is (campaign_key, save_last_modified);
    -- there is no save_hash column on player_intel_snapshots to mirror.
    unique (campaign_key, save_last_modified)
);

comment on table public.strategic_snapshots is
  'Compact strategic_snapshot_v1 history. One row per published save, retained N deep. Not a full API snapshot: no static template data, IDs not display strings.';

-- Covers the foreign key (Postgres does not index FKs automatically) and
-- serves newest-first listing and retention from the same index.
create index if not exists strategic_snapshots_campaign_recent_idx
    on public.strategic_snapshots (campaign_key, campaign_date desc, save_last_modified desc);

alter table public.strategic_snapshots enable row level security;

-- Mirrors "Allow select for public intel snapshots" on player_intel_snapshots.
drop policy if exists "Allow select for public strategic snapshots" on public.strategic_snapshots;
create policy "Allow select for public strategic snapshots"
  on public.strategic_snapshots
  for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.campaign_key = strategic_snapshots.campaign_key
        and c.is_public = true
    )
  );

-- Writes happen only via service_role (which bypasses RLS) through the
-- functions below. No insert/update/delete policy is granted to anon.

create schema if not exists private;

-- Atomic insert-then-prune. supabase-js cannot span statements in a
-- transaction, so issuing these as two client calls would race a concurrent
-- publish and could delete the row just written.
create or replace function private.store_strategic_snapshot(
    p_campaign_key       text,
    p_save_last_modified timestamptz,
    p_save_filename      text,
    p_game_time          text,
    p_campaign_date      timestamptz,
    p_payload            jsonb,
    p_retention          int default 20
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    insert into public.strategic_snapshots
        (campaign_key, save_last_modified, save_filename, game_time, campaign_date, payload)
    values
        (p_campaign_key, p_save_last_modified, p_save_filename, p_game_time, p_campaign_date, p_payload)
    on conflict (campaign_key, save_last_modified) do update
        set payload       = excluded.payload,
            campaign_date = excluded.campaign_date,
            game_time     = excluded.game_time,
            save_filename = excluded.save_filename
    returning id into v_id;

    delete from public.strategic_snapshots
    where campaign_key = p_campaign_key
      and id not in (
          select id from public.strategic_snapshots
          where campaign_key = p_campaign_key
          order by campaign_date desc, save_last_modified desc
          limit p_retention
      );

    return v_id;
end;
$$;

-- Retention for the large full-fidelity table. Keeps the N most recent SAVES
-- (each save spans multiple observer/visibility rows), not N rows.
-- Created here but NOT invoked by this migration.
create or replace function private.prune_intel_snapshots(
    p_campaign_key text,
    p_keep_saves   int default 3
) returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_deleted int;
begin
    delete from public.player_intel_snapshots s
    where s.campaign_key = p_campaign_key
      and s.save_last_modified not in (
          select distinct save_last_modified
          from public.player_intel_snapshots
          where campaign_key = p_campaign_key
          order by save_last_modified desc
          limit p_keep_saves
      );
    get diagnostics v_deleted = row_count;
    return v_deleted;
end;
$$;

revoke all on function private.store_strategic_snapshot(text, timestamptz, text, text, timestamptz, jsonb, int) from public, anon, authenticated;
revoke all on function private.prune_intel_snapshots(text, int) from public, anon, authenticated;
grant execute on function private.store_strategic_snapshot(text, timestamptz, text, text, timestamptz, jsonb, int) to service_role;
grant execute on function private.prune_intel_snapshots(text, int) to service_role;
