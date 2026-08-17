-- Migration: Remove the legacy Player-only uniqueness constraint.
-- The mode-aware constraint permits one Player and one Omniscient row per observer/save.

alter table public.player_intel_snapshots
  drop constraint if exists player_intel_snapshots_campaign_key_save_last_modified_obse_key;
