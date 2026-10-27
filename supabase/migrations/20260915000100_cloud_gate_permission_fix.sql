-- Cloud gate and trusted worker read paths must be able to inspect lifecycle rows.
grant usage on schema public to service_role;
grant select on public.files, public.file_versions, public.processing_jobs
  to service_role;

