begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(2);

insert into public.spike_chunks (
  id, workspace_id, file_id, file_name, content, source_location, embedding
) values
(
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '团队 A 报价.pdf',
  '年度报价',
  '{"kind":"page","label":"第 1 页"}',
  array_fill(0.1::real, array[384])::extensions.vector
),
(
  '10000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000002',
  '团队 B 私密资料.pdf',
  '私密资料',
  '{"kind":"page","label":"第 1 页"}',
  array_fill(0.1::real, array[384])::extensions.vector
);

select extensions.is(
  (
    select count(*)::integer
    from public.match_spike_chunks(
      '20000000-0000-0000-0000-000000000001',
      array_fill(0.1::real, array[384])::extensions.vector,
      10
    )
  ),
  1,
  'workspace filter returns exactly one row'
);

select extensions.is(
  (
    select file_name
    from public.match_spike_chunks(
      '20000000-0000-0000-0000-000000000001',
      array_fill(0.1::real, array[384])::extensions.vector,
      10
    )
  ),
  '团队 A 报价.pdf',
  'workspace B file is not returned'
);

select * from extensions.finish();
rollback;
