-- 0032_account: sign-in sessions, the account's own activity log, and deletion of the account itself.
--
--   1. sessions  - the caller's own rows of auth.sessions, exposed through security-definer functions that filter on
--                  auth.uid() (the auth schema is not reachable from the API). One session can be ended; "all other
--                  sessions" is GoTrue's own signOut(scope: 'others'). account_session_alive() lets the web server refuse
--                  an access token whose session was ended, instead of trusting it until it expires.
--   2. activity  - public.account_events: sign-ins (time and the browser's User-Agent, from which the page shows an approximate device), password changes, sessions ended and
--                  deletion requests. Private to the account; written only through account_record_event / the functions below.
--   3. deletion  - the user deletes their own account after typing their e-mail and re-entering the password (checked by
--                  the web server).
--                  * a health file the user owns ALONE enters the existing 30-day file deletion (read-only, shares revoked,
--                    purge by patient_purge); signing in again inside the grace period restores it;
--                  * a file owned together with other members is never deleted with the account: the owner first transfers
--                    ownership to another member (patient_transfer_ownership) or removes the other members
--                    (patient_remove_member); account_request_deletion refuses while such a file exists;
--                  * every share link the user created is revoked at once (not restored by a cancellation);
--                  * what remains when the grace period ends: the user's memberships in other people's files, templates
--                    and activity log are erased and the profile is blanked (account_finalize), then the web server deletes
--                    the sign-in identity. If records of OTHER accounts still carry this user's id as their author, the
--                    identity row cannot be removed without touching those records, so it is anonymised instead (GoTrue
--                    soft delete); nothing of another account is ever modified or deleted;
--                  * the audit trail follows the file policy of 0011: entries about a purged file go with the file; entries
--                    about files that remain keep only the opaque id of the actor. account_deletions is the tombstone.

-- ---------------------------------------------------------------- helpers
-- The session id carried by the caller's access token (null when the token has none).
create function app.current_session_id() returns uuid
language sql stable set search_path = '' as $$
  select case when c ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then c::uuid end
    from (select coalesce(nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id', ''),
                          nullif(current_setting('request.jwt.claim.session_id', true), '')) as c) x
$$;

-- ---------------------------------------------------------------- activity log
create table public.account_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('sign_in', 'password_changed', 'session_revoked', 'sessions_revoked', 'deletion_requested', 'deletion_cancelled')),
  user_agent text check (user_agent is null or length(user_agent) <= 300)
);
create index account_events_user_idx on public.account_events (user_id, at desc);
alter table public.account_events enable row level security;
create policy account_events_select on public.account_events for select to authenticated using (user_id = auth.uid());
revoke all on public.account_events from anon, authenticated;
grant select on public.account_events to authenticated;   -- no insert/update/delete: written by the functions below only

create function app.account_event(p_user uuid, p_kind text, p_user_agent text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.account_events (user_id, kind, user_agent)
  values (p_user, p_kind, nullif(left(btrim(coalesce(p_user_agent, '')), 300), ''));
  delete from public.account_events where user_id = p_user and at < now() - interval '180 days';
end $$;

create function public.account_record_event(p_kind text, p_user_agent text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_kind not in ('sign_in', 'password_changed', 'session_revoked', 'sessions_revoked') then
    raise exception 'invalid event' using errcode = '22023';
  end if;
  -- the same sign-in reported twice within seconds (a double submit) is recorded once
  if p_kind = 'sign_in' and exists (select 1 from public.account_events e where e.user_id = auth.uid() and e.kind = 'sign_in'
                                      and e.at > now() - interval '5 seconds' and e.user_agent is not distinct from nullif(left(btrim(coalesce(p_user_agent, '')), 300), '')) then
    return;
  end if;
  perform app.account_event(auth.uid(), p_kind, p_user_agent);
end $$;

-- ---------------------------------------------------------------- sessions
create function public.account_sessions() returns table (id uuid, created_at timestamptz, updated_at timestamptz, user_agent text, is_current boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.created_at, coalesce(s.updated_at, s.created_at), left(s.user_agent, 300), s.id = app.current_session_id()
    from auth.sessions s
   where s.user_id = auth.uid()
   order by coalesce(s.updated_at, s.created_at) desc, s.id
$$;

create function public.account_session_alive() returns boolean
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then false
              when app.current_session_id() is null then true
              else exists (select 1 from auth.sessions s where s.id = app.current_session_id() and s.user_id = auth.uid()) end
$$;

create function public.account_revoke_session(p_session uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); n int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_session is not distinct from app.current_session_id() then raise exception 'cannot_revoke_current' using errcode = '22023'; end if;
  delete from auth.sessions where id = p_session and user_id = v_uid;   -- refresh tokens go with it (cascade)
  get diagnostics n = row_count;
  if n > 0 then perform app.account_event(v_uid, 'session_revoked', null); end if;
  return n > 0;
end $$;

-- ---------------------------------------------------------------- shared files: transfer or remove members
create function public.patient_transfer_ownership(p_patient uuid, p_to uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_to is null or p_to = v_uid then raise exception 'invalid_target' using errcode = '22023'; end if;
  if not exists (select 1 from public.patient_members m where m.patient_id = p_patient and m.user_id = v_uid and m.role = 'owner' and m.revoked_at is null) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from public.patients p where p.id = p_patient and p.deletion_requested_at is not null) then
    raise exception 'file_pending_deletion' using errcode = '22023';
  end if;
  update public.patient_members set role = 'owner', can_write = true, can_share = true
   where patient_id = p_patient and user_id = p_to and revoked_at is null;
  if not found then raise exception 'invalid_target' using errcode = '22023'; end if;
  update public.patient_members set role = 'guardian', can_write = true, can_share = true
   where patient_id = p_patient and user_id = v_uid;
end $$;

create function public.patient_remove_member(p_patient uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not app.has_patient_access(p_patient, 'manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user is null or p_user = v_uid then raise exception 'invalid_target' using errcode = '22023'; end if;
  update public.patient_members set revoked_at = now()
   where patient_id = p_patient and user_id = p_user and revoked_at is null and role <> 'owner';
  if not found then raise exception 'invalid_target' using errcode = '22023'; end if;
end $$;

-- ---------------------------------------------------------------- account deletion
create table public.account_deletions (
  user_id uuid primary key,                       -- deliberately no foreign key: the row outlives the account as its tombstone
  requested_at timestamptz not null default now(),
  scheduled_for timestamptz not null,
  files uuid[] not null default '{}',             -- the files this request put into deletion (restored by a cancellation)
  completed_at timestamptz,
  method text check (method in ('deleted', 'anonymised')),
  check (scheduled_for > requested_at),
  check ((completed_at is null) = (method is null))
);
alter table public.account_deletions enable row level security;
create policy account_deletions_select on public.account_deletions for select to authenticated using (user_id = auth.uid() and completed_at is null);
revoke all on public.account_deletions from anon, authenticated;
grant select on public.account_deletions to authenticated;
create trigger account_deletions_audit after insert or update on public.account_deletions for each row execute function app.audit_row();

-- What the deletion page shows: the pending request, the files that go with the account, and the shared files that block it.
create function public.account_deletion_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_pending jsonb; v_alone jsonb; v_shared jsonb; v_last_admin boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select jsonb_build_object('requested_at', d.requested_at, 'scheduled_for', d.scheduled_for) into v_pending
    from public.account_deletions d where d.user_id = v_uid and d.completed_at is null;
  with mine as (
    select p.id, p.mrn, p.full_name, p.deletion_requested_at,
           (select count(*) from public.patient_members o where o.patient_id = p.id and o.user_id <> v_uid and o.revoked_at is null) as others
      from public.patient_members m join public.patients p on p.id = m.patient_id
     where m.user_id = v_uid and m.role = 'owner' and m.revoked_at is null)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'mrn', mrn, 'name', full_name, 'pending', deletion_requested_at is not null) order by full_name)
                    filter (where others = 0), '[]'),
         coalesce(jsonb_agg(jsonb_build_object('id', id, 'mrn', mrn, 'name', full_name, 'members',
                    (select coalesce(jsonb_agg(jsonb_build_object('user_id', o.user_id, 'name', coalesce(nullif(pr.full_name, ''), '-'), 'role', o.role) order by o.created_at), '[]')
                       from public.patient_members o left join public.profiles pr on pr.id = o.user_id
                      where o.patient_id = mine.id and o.user_id <> v_uid and o.revoked_at is null)) order by full_name)
                    filter (where others > 0 and deletion_requested_at is null), '[]')
    into v_alone, v_shared from mine;
  select (coalesce((select p.role = 'admin' from public.profiles p where p.id = v_uid), false)
          and not exists (select 1 from public.profiles p where p.role = 'admin' and p.id <> v_uid)) into v_last_admin;
  return jsonb_build_object('pending', v_pending, 'alone', v_alone, 'shared', v_shared, 'last_admin', v_last_admin);
end $$;

create function public.account_request_deletion(p_confirm text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_when timestamptz := now() + interval '30 days';
  v_files uuid[];
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = v_uid;
  if v_email is null or lower(btrim(coalesce(p_confirm, ''))) <> v_email then raise exception 'email_mismatch' using errcode = '22023'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  if exists (select 1 from public.account_deletions d where d.user_id = v_uid and d.completed_at is null) then raise exception 'already_pending' using errcode = '22023'; end if;
  if coalesce((select p.role = 'admin' from public.profiles p where p.id = v_uid), false)
     and not exists (select 1 from public.profiles p where p.role = 'admin' and p.id <> v_uid) then
    raise exception 'last_admin' using errcode = '22023';
  end if;
  if exists (select 1 from public.patient_members m join public.patients p on p.id = m.patient_id
              where m.user_id = v_uid and m.role = 'owner' and m.revoked_at is null and p.deletion_requested_at is null
                and exists (select 1 from public.patient_members o where o.patient_id = m.patient_id and o.user_id <> v_uid and o.revoked_at is null)) then
    raise exception 'shared_files_remain' using errcode = '22023';
  end if;

  -- files owned alone follow the file deletion flow of 0011 (read-only, recoverable until the scheduled date)
  select coalesce(array_agg(p.id), '{}') into v_files
    from public.patient_members m join public.patients p on p.id = m.patient_id
   where m.user_id = v_uid and m.role = 'owner' and m.revoked_at is null and p.deletion_requested_at is null;
  update public.patients set deletion_requested_at = now(), deletion_requested_by = v_uid, deletion_scheduled_for = v_when where id = any(v_files);

  -- every link the user created, and every link on a file that goes, stops working now
  with r as (
    update public.medical_shares set revoked_at = now(), revoked_by = v_uid, revoke_reason = 'account_deleted'
     where (created_by = v_uid or patient_id = any(v_files)) and revoked_at is null returning id),
  s as (delete from public.medical_share_sessions where share_id in (select id from r))
  insert into public.medical_share_access_logs (share_id, event, detail)
    select id, 'revoked', jsonb_build_object('by', v_uid, 'reason', 'account_deleted') from r;

  insert into public.account_deletions (user_id, requested_at, scheduled_for, files) values (v_uid, now(), v_when, v_files);
  perform app.account_event(v_uid, 'deletion_requested', null);
  return v_when;
end $$;

-- Signing in again inside the grace period cancels the request and restores the files it put into deletion.
create function public.account_cancel_deletion() returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); d public.account_deletions;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into d from public.account_deletions where user_id = v_uid and completed_at is null for update;
  if not found then return false; end if;
  if (select count(*) from public.patients p where p.id = any(d.files)) <> cardinality(d.files) then
    raise exception 'purge_started' using errcode = '55000';       -- a file was already erased: the request can no longer be undone
  end if;
  update public.patients set deletion_requested_at = null, deletion_requested_by = null, deletion_scheduled_for = null
   where id = any(d.files) and deletion_requested_by = v_uid;
  delete from public.account_deletions where user_id = v_uid and completed_at is null;
  perform app.account_event(v_uid, 'deletion_cancelled', null);
  return true;
end $$;

create function public.account_purge_due() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(user_id), '{}') from public.account_deletions where completed_at is null and scheduled_for <= now()
$$;

-- Database half of the purge, after the web server erased the stored files of the account's patient files.
-- Idempotent: it is repeated by the next run when the identity could not be deleted.
create function public.account_finalize(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.account_deletions;
begin
  select * into d from public.account_deletions where user_id = p_user and completed_at is null for update;
  if not found then raise exception 'not_pending' using errcode = '22023'; end if;
  if d.scheduled_for > now() then raise exception 'grace_period_not_elapsed' using errcode = '22023'; end if;
  if exists (select 1 from public.patient_members m where m.user_id = p_user and m.role = 'owner' and m.revoked_at is null) then
    raise exception 'files_remaining' using errcode = '55000';     -- a file of the account was not purged: nothing is removed
  end if;
  delete from public.patient_members where user_id = p_user;       -- the user's own access to other people's files
  delete from public.note_templates where owner_id = p_user;
  delete from public.account_events where user_id = p_user;
  update public.profiles set full_name = '', role = 'user', date_of_birth = null, sex = null, blood_abo = null, blood_rh = null, phone = null,
         nationality = null, city = null, country = null, avatar_path = null where id = p_user;
end $$;

create function public.account_complete(p_user uuid, p_method text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.account_deletions set completed_at = now(), method = p_method where user_id = p_user and completed_at is null;
  if not found then raise exception 'not_pending' using errcode = '22023'; end if;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function public.account_record_event(text, text) from public, anon;
revoke all on function public.account_sessions() from public, anon;
revoke all on function public.account_session_alive() from public, anon;
revoke all on function public.account_revoke_session(uuid) from public, anon;
revoke all on function public.patient_transfer_ownership(uuid, uuid) from public, anon;
revoke all on function public.patient_remove_member(uuid, uuid) from public, anon;
revoke all on function public.account_deletion_overview() from public, anon;
revoke all on function public.account_request_deletion(text) from public, anon;
revoke all on function public.account_cancel_deletion() from public, anon;
revoke all on function public.account_purge_due() from public, anon, authenticated;
revoke all on function public.account_finalize(uuid) from public, anon, authenticated;
revoke all on function public.account_complete(uuid, text) from public, anon, authenticated;
revoke all on function app.account_event(uuid, text, text) from public, anon, authenticated;
grant execute on function public.account_record_event(text, text) to authenticated;
grant execute on function public.account_sessions() to authenticated;
grant execute on function public.account_session_alive() to authenticated;
grant execute on function public.account_revoke_session(uuid) to authenticated;
grant execute on function public.patient_transfer_ownership(uuid, uuid) to authenticated;
grant execute on function public.patient_remove_member(uuid, uuid) to authenticated;
grant execute on function public.account_deletion_overview() to authenticated;
grant execute on function public.account_request_deletion(text) to authenticated;
grant execute on function public.account_cancel_deletion() to authenticated;
grant execute on function public.account_purge_due() to service_role;
grant execute on function public.account_finalize(uuid) to service_role;
grant execute on function public.account_complete(uuid, text) to service_role;
