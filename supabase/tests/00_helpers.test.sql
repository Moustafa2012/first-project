-- Test helpers. Assertions never abort the script: they record a row and 99_summary fails the run if any failed.
create schema test;
grant usage on schema test to public;
create table test.results (id serial primary key, name text not null, passed boolean not null, detail text);
grant all on test.results to public;
grant usage on all sequences in schema test to public;

create function test.ok(cond boolean, name text, detail text default null) returns void language plpgsql as $$
begin
  insert into test.results (name, passed, detail) values (name, coalesce(cond, false), detail);
  if not coalesce(cond, false) then raise warning 'FAIL: % %', name, coalesce(detail, ''); end if;
end $$;

-- passes when the statement raises an error whose SQLSTATE or message matches the pattern
create function test.throws(stmt text, pattern text, name text) returns void language plpgsql as $$
begin
  execute stmt;
  insert into test.results (name, passed, detail) values (name, false, 'no error raised');
  raise warning 'FAIL: % (no error raised)', name;
exception when others then
  if sqlstate = pattern or sqlerrm ~* pattern then
    insert into test.results (name, passed) values (name, true);
  else
    insert into test.results (name, passed, detail) values (name, false, sqlstate || ': ' || sqlerrm);
    raise warning 'FAIL: % (got % %)', name, sqlstate, sqlerrm;
  end if;
end $$;

grant execute on all functions in schema test to public;

-- fixed identities
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-1111-1111-111111111111', 'alice@example.test', '{"full_name":"Alice"}'),
  ('b2222222-2222-2222-2222-222222222222', 'bob@example.test',   '{"full_name":"Bob"}'),
  ('c3333333-3333-3333-3333-333333333333', 'carol@example.test', '{"full_name":"Carol Admin"}'),
  ('d4444444-4444-4444-4444-444444444444', 'dave@example.test',  '{"full_name":"Dave Clinician"}');
update public.profiles set role = 'admin' where id = 'c3333333-3333-3333-3333-333333333333';

-- session switchers
create function test.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  execute 'set role authenticated';
end $$;
create function test.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.role', 'anon', false);
  execute 'set role anon';
end $$;
create function test.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.role', 'service_role', false);
  execute 'set role service_role';
end $$;
create function test.as_super() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
end $$;
grant execute on all functions in schema test to public;
