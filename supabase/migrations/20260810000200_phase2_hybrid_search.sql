-- UNRUN in this local-only phase. Apply only to a separately authorized
-- disposable database, then execute the matching pgTAP file with ordinary JWTs.
begin;

create extension if not exists pg_trgm with schema extensions;

alter table public.content_chunks
  add column if not exists search_tokens text[] not null default '{}'::text[];

create index if not exists content_chunks_search_tokens_gin_idx
  on public.content_chunks using gin (search_tokens);

create index if not exists files_active_display_name_trgm_idx
  on public.files using gin (display_name extensions.gin_trgm_ops)
  where deleted_at is null;

create or replace function public.search_workspace_files(
  p_workspace_id uuid,
  p_query_embedding extensions.vector(384),
  p_query_tokens text[],
  p_query_text text,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 20
)
returns table (
  file_id uuid,
  file_name text,
  score double precision,
  snippet text,
  source_location jsonb,
  snippets jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_file_types text[];
  v_uploader_ids uuid[];
  v_updated_from timestamptz;
  v_updated_to timestamptz;
begin
  if p_workspace_id is null then
    raise exception 'workspace is required';
  end if;
  if p_query_embedding is null or extensions.vector_dims(p_query_embedding) <> 384 then
    raise exception 'query embedding must contain 384 dimensions';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'search limit must be between 1 and 50';
  end if;
  if p_query_tokens is null or cardinality(p_query_tokens) > 50 then
    raise exception 'query token count is invalid';
  end if;
  if exists (
    select 1 from pg_catalog.unnest(coalesce(p_query_tokens, '{}'::text[])) token
    where pg_catalog.char_length(token) < 1 or pg_catalog.char_length(token) > 100
  ) then
    raise exception 'query token length is invalid';
  end if;
  if p_filters is null or pg_catalog.jsonb_typeof(p_filters) <> 'object' then
    raise exception 'search filters must be an object';
  end if;
  if p_filters ? 'fileTypes' and pg_catalog.jsonb_typeof(p_filters -> 'fileTypes') <> 'array' then
    raise exception 'fileTypes filter must be an array';
  end if;
  if p_filters ? 'uploaderIds' and pg_catalog.jsonb_typeof(p_filters -> 'uploaderIds') <> 'array' then
    raise exception 'uploaderIds filter must be an array';
  end if;
  begin
    select case when p_filters ? 'fileTypes'
                  and pg_catalog.jsonb_array_length(p_filters -> 'fileTypes') > 0
                then array(select pg_catalog.jsonb_array_elements_text(p_filters -> 'fileTypes'))
                else null end,
           case when p_filters ? 'uploaderIds'
                  and pg_catalog.jsonb_array_length(p_filters -> 'uploaderIds') > 0
                then array(select pg_catalog.jsonb_array_elements_text(p_filters -> 'uploaderIds'))::uuid[]
                else null end,
           case when p_filters ? 'updatedFrom' then (p_filters ->> 'updatedFrom')::timestamptz end,
           case when p_filters ? 'updatedTo' then (p_filters ->> 'updatedTo')::timestamptz end
    into v_file_types, v_uploader_ids, v_updated_from, v_updated_to;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'search filters contain invalid values';
  end;
  if v_updated_from is not null and v_updated_to is not null and v_updated_from > v_updated_to then
    raise exception 'updatedFrom must not be after updatedTo';
  end if;

  return query
  with eligible as (
    select
      c.id as chunk_id,
      c.version_id,
      c.content,
      c.source_location,
      f.id as eligible_file_id,
      f.display_name,
      f.updated_at,
      f.uploader_id
    from public.content_chunks c
    join public.file_versions v on v.id = c.version_id
    join public.files f on f.id = v.file_id and f.workspace_id = v.workspace_id
    where v.workspace_id = p_workspace_id
      and f.workspace_id = p_workspace_id
      and f.deleted_at is null
      and f.current_version_id = v.id
      and (v_file_types is null or v.mime_type = any(v_file_types))
      and (v_uploader_ids is null or f.uploader_id = any(v_uploader_ids))
      and (v_updated_from is null or f.updated_at >= v_updated_from)
      and (v_updated_to is null or f.updated_at <= v_updated_to)
  ),
  semantic as (
    select e.*, row_number() over (order by c.embedding <=> p_query_embedding, e.chunk_id) as rank_position
    from eligible e
    join public.content_chunks c on c.id = e.chunk_id
    order by c.embedding <=> p_query_embedding, e.chunk_id
    limit 50
  ),
  lexical as (
    select e.*,
           row_number() over (
             order by
               (select count(*) from pg_catalog.unnest(e.search_tokens) token
                where token = any(p_query_tokens)) desc,
               extensions.similarity(e.display_name, coalesce(p_query_text, '')) desc,
               e.chunk_id
           ) as rank_position
    from (
      select e.*, c.search_tokens
      from eligible e
      join public.content_chunks c on c.id = e.chunk_id
    ) e
    order by
      (select count(*) from pg_catalog.unnest(e.search_tokens) token
       where token = any(p_query_tokens)) desc,
      extensions.similarity(e.display_name, coalesce(p_query_text, '')) desc,
      e.chunk_id
    limit 50
  ),
  fused as (
    select
      coalesce(s.chunk_id, l.chunk_id) as chunk_id,
      coalesce(s.content, l.content) as content,
      coalesce(s.source_location, l.source_location) as source_location,
      coalesce(s.eligible_file_id, l.eligible_file_id) as eligible_file_id,
      coalesce(s.display_name, l.display_name) as display_name,
      coalesce(s.updated_at, l.updated_at) as updated_at,
      coalesce(s.rank_position, 999999) as semantic_rank,
      coalesce(l.rank_position, 999999) as lexical_rank,
      (case when s.chunk_id is not null then 0.65 / (60 + s.rank_position) else 0 end)
      + (case when l.chunk_id is not null then 0.35 / (60 + l.rank_position) else 0 end)
      + (case when lower(coalesce(s.display_name, l.display_name)) = lower(coalesce(p_query_text, '')) then 0.05 else 0 end)
        as chunk_score
    from semantic s
    full join lexical l on l.chunk_id = s.chunk_id
  ),
  ranked_files as (
    select f.*, row_number() over (partition by f.eligible_file_id order by f.chunk_score desc, f.chunk_id) as snippet_rank
    from fused f
  ),
  file_rollup as (
    select
      r.eligible_file_id,
      max(r.display_name) as display_name,
      max(r.chunk_score) as best_score,
      max(r.content) filter (where r.snippet_rank = 1) as best_snippet,
      max(r.source_location) filter (where r.snippet_rank = 1) as best_location,
      jsonb_agg(
        jsonb_build_object('snippet', r.content, 'sourceLocation', r.source_location, 'score', r.chunk_score)
        order by r.snippet_rank
      ) filter (where r.snippet_rank <= 3) as snippets,
      max(r.updated_at) as updated_at
    from ranked_files r
    group by r.eligible_file_id
  )
  select
    fr.eligible_file_id,
    fr.display_name,
    fr.best_score
      + coalesce((fr.snippets -> 1 ->> 'score')::double precision * 0.25, 0)
      + coalesce((fr.snippets -> 2 ->> 'score')::double precision * 0.10, 0)
      as score,
    fr.best_snippet,
    fr.best_location,
    fr.snippets
  from file_rollup fr
  order by score desc, fr.updated_at desc, fr.eligible_file_id
  limit p_limit;
end;
$$;

revoke all on function public.search_workspace_files(uuid, extensions.vector(384), text[], text, jsonb, integer)
  from public, anon;
grant execute on function public.search_workspace_files(uuid, extensions.vector(384), text[], text, jsonb, integer)
  to authenticated;

commit;
