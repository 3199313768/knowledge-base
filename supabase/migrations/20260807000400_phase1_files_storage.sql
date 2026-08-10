create or replace function private.extension_for_mime(p_mime text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_mime
    when 'application/pdf' then 'pdf'
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      then 'docx'
    when 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      then 'pptx'
    when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      then 'xlsx'
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/heic' then 'heic'
    when 'image/heif' then 'heic'
    else null
  end;
$$;

revoke all on function private.extension_for_mime(text)
  from public, anon, authenticated;

create or replace function private.is_safe_https_url(p_url text)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_remainder text;
  v_authority text;
  v_host text;
  v_port text;
  v_suffix text;
  v_closing_bracket integer;
  v_colon_count integer;
begin
  if p_url is null or p_url !~ '^https://[^[:space:]]+$' then
    return false;
  end if;

  v_remainder := pg_catalog.substr(p_url, 9);
  v_authority := pg_catalog.split_part(
    pg_catalog.split_part(
      pg_catalog.split_part(v_remainder, '/', 1),
      '?',
      1
    ),
    '#',
    1
  );
  if v_authority = '' or pg_catalog.strpos(v_authority, '@') > 0 then
    return false;
  end if;

  if pg_catalog.left(v_authority, 1) = '[' then
    v_closing_bracket := pg_catalog.strpos(v_authority, ']');
    if v_closing_bracket <= 2 then
      return false;
    end if;

    v_host := pg_catalog.substr(
      v_authority,
      2,
      v_closing_bracket - 2
    );
    v_suffix := pg_catalog.substr(
      v_authority,
      v_closing_bracket + 1
    );
    if v_suffix <> '' then
      if pg_catalog.left(v_suffix, 1) <> ':' then
        return false;
      end if;
      v_port := pg_catalog.substr(v_suffix, 2);
    end if;

    if not pg_catalog.pg_input_is_valid(v_host, 'pg_catalog.inet') then
      return false;
    end if;
    if pg_catalog.family(v_host::pg_catalog.inet) <> 6 then
      return false;
    end if;
  else
    if pg_catalog.strpos(v_authority, '[') > 0
      or pg_catalog.strpos(v_authority, ']') > 0
    then
      return false;
    end if;

    v_colon_count :=
      pg_catalog.char_length(v_authority)
      - pg_catalog.char_length(
        pg_catalog.replace(v_authority, ':', '')
      );
    if v_colon_count > 1 then
      return false;
    elsif v_colon_count = 1 then
      v_host := pg_catalog.split_part(v_authority, ':', 1);
      v_port := pg_catalog.split_part(v_authority, ':', 2);
    else
      v_host := v_authority;
    end if;

    if v_host = '' then
      return false;
    end if;
    if v_host ~ '^[0-9.]+$' then
      if v_host !~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' then
        return false;
      end if;
      if not pg_catalog.pg_input_is_valid(v_host, 'pg_catalog.inet') then
        return false;
      end if;
      if pg_catalog.family(v_host::pg_catalog.inet) <> 4 then
        return false;
      end if;
    else
      v_host := pg_catalog.lower(v_host);
      if pg_catalog.char_length(v_host) > 253
        or v_host !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'
      then
        return false;
      end if;
    end if;
  end if;

  if v_port is not null then
    if v_port !~ '^[0-9]{1,5}$'
      or v_port::integer not between 1 and 65535
    then
      return false;
    end if;
  end if;

  return true;
end;
$$;

create or replace function private.storage_workspace_id(p_name text)
returns uuid
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_first_segment text := pg_catalog.split_part(
    coalesce(p_name, ''),
    '/',
    1
  );
begin
  if v_first_segment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  then
    return null;
  end if;

  begin
    return v_first_segment::uuid;
  exception
    when invalid_text_representation then
      return null;
  end;
end;
$$;

revoke all on function private.is_safe_https_url(text)
  from public, anon, authenticated;
revoke all on function private.storage_workspace_id(text)
  from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.storage_workspace_id(text)
  to authenticated;

create or replace function public.prepare_file_upload(
  p_workspace_id uuid,
  p_display_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_checksum text
)
returns table (
  outcome text,
  file_id uuid,
  version_id uuid,
  storage_path text,
  duplicate_file_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_mime_type text := lower(btrim(coalesce(p_mime_type, '')));
  v_checksum text := btrim(coalesce(p_checksum, ''));
  v_extension text;
  v_file_id uuid := extensions.gen_random_uuid();
  v_version_id uuid := extensions.gen_random_uuid();
  v_storage_path text;
  v_duplicate_file_id uuid;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_workspace_id is null
    or not private.is_workspace_member(p_workspace_id)
  then
    raise exception 'workspace membership required';
  end if;
  if char_length(v_display_name) not between 1 and 255 then
    raise exception 'display name must contain 1 to 255 characters';
  end if;

  v_extension := private.extension_for_mime(v_mime_type);
  if v_extension is null then
    raise exception 'unsupported MIME type';
  end if;
  if p_size_bytes is null or p_size_bytes not between 1 and 100000000 then
    raise exception 'file size must be between 1 and 100000000 bytes';
  end if;
  if v_checksum !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'checksum must use lowercase sha256 format';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_workspace_id::text || ':' || v_checksum,
      0
    )
  );

  select f.id
  into v_duplicate_file_id
  from public.file_versions v
  join public.files f on f.id = v.file_id
  where f.workspace_id = p_workspace_id
    and f.source_type = 'upload'
    and f.deleted_at is null
    and v.checksum = v_checksum
  order by v.created_at, v.id
  limit 1;

  if v_duplicate_file_id is not null then
    return query
    select
      'duplicate'::text,
      null::uuid,
      null::uuid,
      null::text,
      v_duplicate_file_id;
    return;
  end if;

  v_storage_path := pg_catalog.format(
    '%s/%s/%s/source.%s',
    p_workspace_id,
    v_file_id,
    v_version_id,
    v_extension
  );

  insert into public.files (
    id,
    workspace_id,
    uploader_id,
    display_name,
    source_type
  )
  values (
    v_file_id,
    p_workspace_id,
    v_actor,
    v_display_name,
    'upload'
  );

  insert into public.file_versions (
    id,
    file_id,
    workspace_id,
    created_by,
    storage_path,
    checksum,
    mime_type,
    size_bytes,
    status
  )
  values (
    v_version_id,
    v_file_id,
    p_workspace_id,
    v_actor,
    v_storage_path,
    v_checksum,
    v_mime_type,
    p_size_bytes,
    'awaiting_upload'
  );

  insert into public.audit_events (
    workspace_id,
    actor_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    p_workspace_id,
    v_actor,
    'file.created',
    'file',
    v_file_id,
    pg_catalog.jsonb_build_object(
      'source_type', 'upload',
      'version_id', v_version_id
    )
  );

  return query
  select
    'created'::text,
    v_file_id,
    v_version_id,
    v_storage_path,
    null::uuid;
end;
$$;

create or replace function public.prepare_file_version_upload(
  p_file_id uuid,
  p_mime_type text,
  p_size_bytes bigint,
  p_checksum text
)
returns table (
  outcome text,
  file_id uuid,
  version_id uuid,
  storage_path text,
  duplicate_file_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_workspace_id uuid;
  v_mime_type text := lower(btrim(coalesce(p_mime_type, '')));
  v_checksum text := btrim(coalesce(p_checksum, ''));
  v_extension text;
  v_version_id uuid := extensions.gen_random_uuid();
  v_storage_path text;
  v_duplicate_file_id uuid;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_file_id is null then
    raise exception 'file is required';
  end if;

  select f.workspace_id
  into v_workspace_id
  from public.files f
  where f.id = p_file_id
    and f.deleted_at is null
    and f.source_type = 'upload'
  for update;
  if not found or not private.can_manage_file(p_file_id) then
    raise exception 'file management required';
  end if;

  v_extension := private.extension_for_mime(v_mime_type);
  if v_extension is null then
    raise exception 'unsupported MIME type';
  end if;
  if p_size_bytes is null or p_size_bytes not between 1 and 100000000 then
    raise exception 'file size must be between 1 and 100000000 bytes';
  end if;
  if v_checksum !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'checksum must use lowercase sha256 format';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_workspace_id::text || ':' || v_checksum,
      0
    )
  );

  select f.id
  into v_duplicate_file_id
  from public.file_versions v
  join public.files f on f.id = v.file_id
  where f.workspace_id = v_workspace_id
    and f.source_type = 'upload'
    and f.deleted_at is null
    and v.checksum = v_checksum
  order by v.created_at, v.id
  limit 1;

  if v_duplicate_file_id is not null then
    return query
    select
      'duplicate'::text,
      null::uuid,
      null::uuid,
      null::text,
      v_duplicate_file_id;
    return;
  end if;

  v_storage_path := pg_catalog.format(
    '%s/%s/%s/source.%s',
    v_workspace_id,
    p_file_id,
    v_version_id,
    v_extension
  );

  insert into public.file_versions (
    id,
    file_id,
    workspace_id,
    created_by,
    storage_path,
    checksum,
    mime_type,
    size_bytes,
    status
  )
  values (
    v_version_id,
    p_file_id,
    v_workspace_id,
    v_actor,
    v_storage_path,
    v_checksum,
    v_mime_type,
    p_size_bytes,
    'awaiting_upload'
  );

  insert into public.audit_events (
    workspace_id,
    actor_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    v_workspace_id,
    v_actor,
    'file.version_created',
    'file',
    p_file_id,
    pg_catalog.jsonb_build_object('version_id', v_version_id)
  );

  return query
  select
    'created'::text,
    p_file_id,
    v_version_id,
    v_storage_path,
    null::uuid;
end;
$$;

create or replace function public.prepare_web_import(
  p_workspace_id uuid,
  p_display_name text,
  p_original_url text
)
returns table (
  outcome text,
  file_id uuid,
  version_id uuid,
  storage_path text,
  duplicate_file_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_original_url text := btrim(coalesce(p_original_url, ''));
  v_file_id uuid := extensions.gen_random_uuid();
  v_version_id uuid := extensions.gen_random_uuid();
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_workspace_id is null
    or not private.is_workspace_member(p_workspace_id)
  then
    raise exception 'workspace membership required';
  end if;
  if char_length(v_display_name) not between 1 and 255 then
    raise exception 'display name must contain 1 to 255 characters';
  end if;
  if not private.is_safe_https_url(v_original_url) then
    raise exception 'absolute https URL required';
  end if;

  insert into public.files (
    id,
    workspace_id,
    uploader_id,
    display_name,
    source_type
  )
  values (
    v_file_id,
    p_workspace_id,
    v_actor,
    v_display_name,
    'web'
  );

  insert into public.file_versions (
    id,
    file_id,
    workspace_id,
    created_by,
    original_url,
    mime_type,
    status
  )
  values (
    v_version_id,
    v_file_id,
    p_workspace_id,
    v_actor,
    v_original_url,
    'text/html',
    'pending_processing'
  );

  insert into public.processing_jobs (version_id, stage, status)
  values (v_version_id, 'validate', 'pending');

  insert into public.audit_events (
    workspace_id,
    actor_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    p_workspace_id,
    v_actor,
    'file.created',
    'file',
    v_file_id,
    pg_catalog.jsonb_build_object(
      'source_type', 'web',
      'version_id', v_version_id
    )
  );

  return query
  select
    'created'::text,
    v_file_id,
    v_version_id,
    null::text,
    null::uuid;
end;
$$;

create or replace function public.mark_upload_complete(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_workspace_id uuid;
  v_created_by uuid;
  v_storage_path text;
  v_status public.file_version_status;
  v_deleted_at timestamptz;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_version_id is null then
    raise exception 'file version is required';
  end if;

  select
    v.workspace_id,
    v.created_by,
    v.storage_path,
    v.status,
    f.deleted_at
  into
    v_workspace_id,
    v_created_by,
    v_storage_path,
    v_status,
    v_deleted_at
  from public.file_versions v
  join public.files f on f.id = v.file_id
  where v.id = p_version_id
  for update of v;
  if not found then
    raise exception 'file version not found';
  end if;
  if v_deleted_at is not null then
    raise exception 'file has been deleted';
  end if;
  if not private.is_workspace_member(v_workspace_id) then
    raise exception 'workspace membership required';
  end if;
  if v_created_by <> v_actor
    and not private.is_workspace_admin(v_workspace_id)
  then
    raise exception 'upload completion authority required';
  end if;
  if v_status <> 'awaiting_upload' then
    raise exception 'file version is not awaiting upload';
  end if;
  if v_storage_path is null then
    raise exception 'file version has no Storage path';
  end if;
  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'documents'
      and o.name = v_storage_path
  ) then
    raise exception 'uploaded object not found';
  end if;

  update public.file_versions
  set status = 'pending_processing'
  where id = p_version_id;

  insert into public.processing_jobs (version_id, stage, status)
  values (p_version_id, 'validate', 'pending')
  on conflict (version_id, stage) do nothing;
end;
$$;

create or replace function public.soft_delete_file(p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_workspace_id uuid;
  v_uploader_id uuid;
  v_deleted_at timestamptz;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_file_id is null then
    raise exception 'file is required';
  end if;

  select f.workspace_id, f.uploader_id, f.deleted_at
  into v_workspace_id, v_uploader_id, v_deleted_at
  from public.files f
  where f.id = p_file_id
  for update;
  if not found then
    raise exception 'file not found';
  end if;
  if v_deleted_at is not null then
    raise exception 'file has already been deleted';
  end if;
  if not private.is_workspace_member(v_workspace_id) then
    raise exception 'workspace membership required';
  end if;
  if v_uploader_id <> v_actor
    and not private.is_workspace_admin(v_workspace_id)
  then
    raise exception 'file management required';
  end if;

  update public.files
  set deleted_at = now(),
      deleted_by = v_actor,
      updated_at = now()
  where id = p_file_id;

  insert into public.processing_jobs (version_id, stage, status)
  select v.id, 'cleanup', 'pending'
  from public.file_versions v
  where v.file_id = p_file_id
  on conflict (version_id, stage) do nothing;

  insert into public.audit_events (
    workspace_id,
    actor_id,
    action,
    target_type,
    target_id
  )
  values (
    v_workspace_id,
    v_actor,
    'file.deleted',
    'file',
    p_file_id
  );
end;
$$;

alter table storage.objects enable row level security;
revoke update, delete on storage.objects from public, anon, authenticated;

create policy documents_insert_prepared_member on storage.objects
for insert to authenticated
with check (
  bucket_id = 'documents'
  and private.is_workspace_member(
    private.storage_workspace_id(name)
  )
  and exists (
    select 1
    from public.file_versions v
    join public.files f on f.id = v.file_id
    where v.storage_path = name
      and v.workspace_id = private.storage_workspace_id(name)
      and v.created_by = (select auth.uid())
      and v.status = 'awaiting_upload'
      and f.source_type = 'upload'
      and f.deleted_at is null
  )
);

create policy documents_select_member on storage.objects
for select to authenticated
using (
  bucket_id = 'documents'
  and private.is_workspace_member(
    private.storage_workspace_id(name)
  )
  and exists (
    select 1
    from public.file_versions v
    join public.files f on f.id = v.file_id
    where v.storage_path = name
      and v.workspace_id = private.storage_workspace_id(name)
      and f.source_type = 'upload'
      and f.deleted_at is null
  )
);

revoke all on function public.prepare_file_upload(
  uuid,
  text,
  text,
  bigint,
  text
) from public, anon, authenticated;
revoke all on function public.prepare_file_version_upload(
  uuid,
  text,
  bigint,
  text
) from public, anon, authenticated;
revoke all on function public.prepare_web_import(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.mark_upload_complete(uuid)
  from public, anon, authenticated;
revoke all on function public.soft_delete_file(uuid)
  from public, anon, authenticated;

grant execute on function public.prepare_file_upload(
  uuid,
  text,
  text,
  bigint,
  text
) to authenticated;
grant execute on function public.prepare_file_version_upload(
  uuid,
  text,
  bigint,
  text
) to authenticated;
grant execute on function public.prepare_web_import(uuid, text, text)
  to authenticated;
grant execute on function public.mark_upload_complete(uuid)
  to authenticated;
grant execute on function public.soft_delete_file(uuid)
  to authenticated;
