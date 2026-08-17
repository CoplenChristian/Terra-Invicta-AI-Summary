-- Migration: Allow explicitly requested public Omniscient snapshots.
-- The user has opted to expose hidden game-state details for this campaign.

alter table public.player_intel_snapshots
  drop constraint if exists player_intel_snapshots_visibility_check;

alter table public.player_intel_snapshots
  add constraint player_intel_snapshots_visibility_check
  check (visibility in ('player', 'omniscient'));

alter table public.player_intel_snapshots
  drop constraint if exists player_intel_snapshots_campaign_key_save_last_modified_obse_key;

alter table public.player_intel_snapshots
  add constraint player_intel_snapshots_campaign_save_observer_visibility_key
  unique (campaign_key, save_last_modified, observer_faction_id, visibility);

drop policy if exists "Allow select for public player intel snapshots"
  on public.player_intel_snapshots;

create policy "Allow select for public intel snapshots"
  on public.player_intel_snapshots
  for select
  to anon, authenticated
  using (
    visibility in ('player', 'omniscient')
    and exists (
      select 1 from public.campaigns c
      where c.campaign_key = player_intel_snapshots.campaign_key
        and c.is_public = true
    )
  );

comment on table public.player_intel_snapshots is
  'Published Player Intel and explicitly enabled Omniscient snapshots per observer faction.';
