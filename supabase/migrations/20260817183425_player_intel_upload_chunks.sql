-- Private, non-API staging area used only for chunked administrative uploads.
-- It contains no public data after an upload is finalized and is not used by the hosted reader.

create schema if not exists private;

create table if not exists private.player_intel_upload_chunks (
  upload_id uuid not null,
  observer_faction_id integer not null,
  payload_kind text not null check (payload_kind in ('snapshot', 'export')),
  part integer not null check (part >= 0),
  chunk text not null,
  primary key (upload_id, observer_faction_id, payload_kind, part)
);

alter table private.player_intel_upload_chunks enable row level security;

revoke all on schema private from public, anon, authenticated;
revoke all on table private.player_intel_upload_chunks from public, anon, authenticated;
grant select, insert, update, delete on table private.player_intel_upload_chunks to service_role;

comment on table private.player_intel_upload_chunks is
  'Non-public chunk staging for administrative Player Intel uploads; never exposed through the Data API.';
