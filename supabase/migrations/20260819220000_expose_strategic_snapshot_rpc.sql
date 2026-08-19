-- PostgREST only exposes the `public` schema, so supabase-js .rpc() cannot
-- reach private.store_strategic_snapshot directly. Add a thin public wrapper
-- that delegates to it. EXECUTE is revoked from anon/authenticated, so only
-- the service-role key used by scripts/push_latest_to_supabase.js can call it.
--
-- Applied to project wckfkfczckgdggefbcok on 2026-08-19.

create or replace function public.store_strategic_snapshot(
    p_campaign_key       text,
    p_save_last_modified timestamptz,
    p_save_filename      text,
    p_game_time          text,
    p_campaign_date      timestamptz,
    p_payload            jsonb,
    p_retention          int default 20
) returns uuid
language sql
security definer
set search_path = ''
as $$
    select private.store_strategic_snapshot(
        p_campaign_key, p_save_last_modified, p_save_filename,
        p_game_time, p_campaign_date, p_payload, p_retention
    );
$$;

create or replace function public.prune_intel_snapshots(
    p_campaign_key text,
    p_keep_saves   int default 3
) returns int
language sql
security definer
set search_path = ''
as $$
    select private.prune_intel_snapshots(p_campaign_key, p_keep_saves);
$$;

revoke all on function public.store_strategic_snapshot(text, timestamptz, text, text, timestamptz, jsonb, int) from public, anon, authenticated;
revoke all on function public.prune_intel_snapshots(text, int) from public, anon, authenticated;
grant execute on function public.store_strategic_snapshot(text, timestamptz, text, text, timestamptz, jsonb, int) to service_role;
grant execute on function public.prune_intel_snapshots(text, int) to service_role;
