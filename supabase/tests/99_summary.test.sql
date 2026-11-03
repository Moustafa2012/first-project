\pset tuples_only on
select test.as_super();
select format('assertions: %s passed, %s failed', count(*) filter (where passed), count(*) filter (where not passed)) from test.results;
select format('FAILED: %s %s', name, coalesce(detail, '')) from test.results where not passed;
do $$ begin
  if exists (select 1 from test.results where not passed) then raise exception 'database tests failed'; end if;
  if (select count(*) from test.results) < 50 then raise exception 'suspiciously few assertions ran'; end if;
end $$;
