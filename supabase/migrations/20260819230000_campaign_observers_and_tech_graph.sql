-- Two schema additions supporting the publish-policy and tech-graph fixes.
-- Applied to project wckfkfczckgdggefbcok on 2026-08-19.

-- 1. The publishing fan-out policy can cover a subset of factions (by default
-- only the observer faction). The hosted dashboard populated its observer
-- selector from every faction in the snapshot, so selecting any unpublished
-- faction produced a guaranteed 404 and cleared the view. Record which
-- observers actually have rows. NULL means "not recorded" -- readers treat that
-- as "all", preserving behaviour for campaigns published before this column.
alter table public.campaigns
  add column if not exists published_observers integer[];

comment on column public.campaigns.published_observers is
  'Observer faction ids that have snapshot rows for the current save. NULL = unknown (treat as all). Set by scripts/push_latest_to_supabase.js.';

-- 2. The tech tree stored on every snapshot row is 94% static template-derived
-- `nodes` (959 KB of 1019 KB); only finishedTechsNames, globalActive and
-- factionStatus (~60 KB) vary per save. Store the static half once per campaign
-- so readers can splice it back in. This removes the duplication without losing
-- hosted tech queries, which is why an earlier blanket strip had to be reverted.
alter table public.campaigns
  add column if not exists tech_graph jsonb,
  add column if not exists tech_graph_fingerprint text;

comment on column public.campaigns.tech_graph is
  'Static tech graph shared by every snapshot of this campaign: { nodes, categories, unlockClasses }. Per-save state (finishedTechsNames, globalActive, factionStatus) stays on each snapshot row.';
comment on column public.campaigns.tech_graph_fingerprint is
  'Identifies the stored graph so the publisher only re-uploads it when the game templates change.';
