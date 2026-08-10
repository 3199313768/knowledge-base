create extension if not exists vector with schema extensions;
create extension if not exists citext with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.workspace_role as enum ('admin', 'member');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');
create type public.file_source_type as enum ('upload', 'web');
create type public.file_version_status as enum (
  'awaiting_upload',
  'pending_processing',
  'processing',
  'searchable',
  'partially_searchable',
  'failed'
);
create type public.processing_stage as enum (
  'validate',
  'extract',
  'ocr',
  'chunk',
  'embed',
  'finalize',
  'cleanup'
);
create type public.processing_job_status as enum ('pending', 'running', 'succeeded', 'failed');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email extensions.citext not null,
  role public.workspace_role not null default 'member' check (role = 'member'),
  status public.invitation_status not null default 'pending',
  invited_by uuid not null references auth.users(id),
  accepted_by uuid references auth.users(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz
);

create unique index workspace_invitations_one_pending
  on public.workspace_invitations (workspace_id, email)
  where status = 'pending';

create table public.files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  uploader_id uuid not null references auth.users(id),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 255),
  source_type public.file_source_type not null,
  current_version_id uuid,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create table public.file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null,
  workspace_id uuid not null,
  created_by uuid not null references auth.users(id),
  storage_path text,
  original_url text,
  checksum text,
  mime_type text,
  size_bytes bigint,
  status public.file_version_status not null,
  error_code text,
  created_at timestamptz not null default now(),
  unique (id, file_id, workspace_id),
  foreign key (file_id, workspace_id)
    references public.files(id, workspace_id) on delete cascade,
  check (
    (
      storage_path is not null
      and original_url is null
      and checksum is not null
      and checksum ~ '^sha256:[0-9a-f]{64}$'
      and mime_type is not null
      and size_bytes is not null
      and size_bytes between 1 and 100000000
    )
    or
    (
      storage_path is null
      and original_url is not null
      and checksum is null
      and size_bytes is null
    )
  )
);

alter table public.files add constraint files_current_version_fk
  foreign key (current_version_id, id, workspace_id)
  references public.file_versions(id, file_id, workspace_id)
  on delete set null (current_version_id)
  deferrable initially deferred;

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.file_versions(id) on delete cascade,
  stage public.processing_stage not null,
  status public.processing_job_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  error_code text,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (version_id, stage)
);

create table public.content_chunks (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.file_versions(id) on delete cascade,
  content text not null,
  source_location jsonb not null,
  embedding extensions.vector(384) not null,
  created_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('macos', 'ios')),
  notification_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, notification_token)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index memberships_user_idx on public.memberships(user_id, workspace_id);
create index files_workspace_active_idx
  on public.files(workspace_id, updated_at desc)
  where deleted_at is null;
create index file_versions_file_idx on public.file_versions(file_id, created_at desc);
create index content_chunks_version_idx on public.content_chunks(version_id);
create index audit_events_workspace_idx on public.audit_events(workspace_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  100000000,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.files enable row level security;
alter table public.file_versions enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.content_chunks enable row level security;
alter table public.devices enable row level security;
alter table public.audit_events enable row level security;

alter table public.spike_chunks enable row level security;
revoke all on public.spike_chunks from anon, authenticated;
revoke execute on function public.match_spike_chunks(uuid, extensions.vector, integer)
  from public, anon, authenticated;
grant all on public.spike_chunks to service_role;
grant execute on function public.match_spike_chunks(uuid, extensions.vector, integer)
  to service_role;
