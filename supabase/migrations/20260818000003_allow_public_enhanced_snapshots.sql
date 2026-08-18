-- Migration: publish the same three explicitly labeled intelligence modes
-- that the local dashboard supports. Enhanced is not silently downgraded to
-- Player; the worker and row visibility both preserve the requested mode.

alter table public.player_intel_snapshots
  drop constraint if exists player_intel_snapshots_visibility_check;

alter table public.player_intel_snapshots
  add constraint player_intel_snapshots_visibility_check
  check (visibility in ('player', 'enhanced', 'omniscient'));

drop policy if exists "Allow select for public intel snapshots"
  on public.player_intel_snapshots;

create policy "Allow select for public intel snapshots"
  on public.player_intel_snapshots
  for select
  to anon, authenticated
  using (
    visibility in ('player', 'enhanced', 'omniscient')
    and exists (
      select 1 from public.campaigns c
      where c.campaign_key = player_intel_snapshots.campaign_key
        and c.is_public = true
    )
  );

comment on table public.player_intel_snapshots is
  'Published Player, Enhanced, and explicitly enabled Omniscient snapshots per observer faction.';
