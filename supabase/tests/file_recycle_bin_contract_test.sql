-- Static contract only; runtime ordinary-JWT/RLS/Storage cleanup remains UNRUN.
select has_column('public', 'files', 'purge_at', 'recycle bin tracks 30-day purge deadline');
select ok((select prosecdef from pg_proc where oid = 'public.restore_file(uuid)'::regprocedure), 'restore is security definer');
select ok((select prosecdef from pg_proc where oid = 'public.permanently_delete_file(uuid)'::regprocedure), 'permanent delete is security definer');
select skip('UNRUN: ordinary JWT RLS, Storage cleanup and 30-day worker purge require an approved non-production target', true);
