create extension if not exists vector with schema extensions;

create table if not exists public.spike_chunks (
  id uuid primary key,
  workspace_id uuid not null,
  file_id uuid not null,
  file_name text not null,
  content text not null,
  source_location jsonb not null,
  embedding extensions.vector(384) not null
);

create index if not exists spike_chunks_workspace_idx
  on public.spike_chunks (workspace_id);

create or replace function public.match_spike_chunks(
  p_workspace_id uuid,
  p_query_embedding extensions.vector(384),
  p_limit integer default 10
)
returns table (
  file_id uuid,
  file_name text,
  content text,
  source_location jsonb,
  score double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select
    c.file_id,
    c.file_name,
    c.content,
    c.source_location,
    1 - (c.embedding <=> p_query_embedding) as score
  from public.spike_chunks c
  where c.workspace_id = p_workspace_id
  order by c.embedding <=> p_query_embedding
  limit least(greatest(p_limit, 1), 50);
$$;
