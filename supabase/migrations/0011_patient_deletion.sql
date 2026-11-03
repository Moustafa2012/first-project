-- 0011_patient_deletion: safe deletion of a whole health file.
--
--   1. request   - owner/guardian confirms by typing the patient's name; the file becomes READ-ONLY and every active
--                  share is revoked immediately. It stays recoverable for 30 days (members can still read/export it).
--   2. restore   - any owner/guardian cancels the request during the 30 days.
--   3. purge     - after the grace period (or on an explicit "delete now" by the owner, re-authenticated by the web
--                  server) the data is erased by the service role only. Nothing clinical survives, including the audit
--                  rows about that patient (they contain copies of clinical data). Only a minimal tombstone is kept.
-- The API never exposes a DELETE on clinical tables; purge is a SECURITY DEFINER function granted to service_role only.

alter table public.patients
  add column deletion_requested_at timestamptz,
  add column deletion_requested_by uuid references auth.users (id),
  add column deletion_scheduled_for timestamptz,
  add constraint patients_deletion_chk check ((deletion_requested_at is null) = (deletion_scheduled_for is null));

-- A file pending deletion is read-only: no writes, no new shares. Reading and managing (restore) stay possible.
create or replace function app.has_patient_access(p_patient uuid, p_need text default 'read') returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.patient_members m
      join public.patients p on p.id = m.patient_id
     where m.patient_id = p_patient
       and m.user_id = auth.uid()
       and m.revoked_at is null
       and case p_need
             when 'read' then true
             when 'write' then m.can_write and p.deletion_requested_at is null
             when 'share' then m.can_share and p.deletion_requested_at is null
             when 'share_read' then m.can_share          -- see the share register even while the file is pending deletion
             when 'manage' then m.role in ('owner', 'guardian')
             else false
           end)
$$;

drop policy shares_select on public.medical_shares;
create policy shares_select on public.medical_shares for select to authenticated using (app.has_patient_access(patient_id, 'share_read'));
drop policy share_items_select on public.medical_share_items;
create policy share_items_select on public.medical_share_items for select to authenticated
  using (exists (select 1 from public.medical_shares s where s.id = share_id and app.has_patient_access(s.patient_id, 'share_read')));
drop policy share_logs_select on public.medical_share_access_logs;
create policy share_logs_select on public.medical_share_access_logs for select to authenticated
  using (exists (select 1 from public.medical_shares s where s.id = share_id and app.has_patient_access(s.patient_id, 'share_read')));
drop policy share_notes_select on public.share_notes;
create policy share_notes_select on public.share_notes for select to authenticated using (app.has_patient_access(patient_id, 'share_read'));

create table public.patient_deletion_log (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null,
  mrn text not null,
  requested_by uuid,
  requested_at timestamptz,
  purged_at timestamptz not null default now(),
  reason text not null check (reason in ('grace_period_elapsed', 'deleted_now_by_owner'))
);
alter table public.patient_deletion_log enable row level security;   -- no policy, no grant: service role only
grant all on public.patient_deletion_log to service_role;

-- audit_logs stays append-only for everybody, except while the purge function runs.
create or replace function app.audit_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('app.purging', true) = 'on' then return old; end if;
  raise exception 'audit_logs is append-only' using errcode = '42501';
end $$;

create function public.patient_request_deletion(p_patient uuid, p_confirm text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  p public.patients;
  v_uid uuid := auth.uid();
  v_when timestamptz := now() + interval '30 days';
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not app.has_patient_access(p_patient, 'manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into p from public.patients where id = p_patient for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if p.deletion_requested_at is not null then raise exception 'already_pending' using errcode = '22023'; end if;
  if lower(btrim(coalesce(p_confirm, ''))) not in (lower(btrim(p.full_name)), lower(p.mrn)) then
    raise exception 'confirmation_mismatch' using errcode = '22023';
  end if;

  update public.patients
     set deletion_requested_at = now(), deletion_requested_by = v_uid, deletion_scheduled_for = v_when
   where id = p_patient;

  update public.medical_shares
     set revoked_at = now(), revoked_by = v_uid, revoke_reason = 'patient_file_deleted'
   where patient_id = p_patient and revoked_at is null;
  delete from public.medical_share_sessions where share_id in (select id from public.medical_shares where patient_id = p_patient);
  insert into public.medical_share_access_logs (share_id, event, detail)
    select id, 'revoked', jsonb_build_object('by', v_uid, 'reason', 'patient_file_deleted')
      from public.medical_shares where patient_id = p_patient and revoke_reason = 'patient_file_deleted' and revoked_at >= now() - interval '1 minute';
  return v_when;
end $$;

create function public.patient_cancel_deletion(p_patient uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not app.has_patient_access(p_patient, 'manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.patients
     set deletion_requested_at = null, deletion_requested_by = null, deletion_scheduled_for = null
   where id = p_patient and deletion_requested_at is not null;
  if not found then raise exception 'not_pending' using errcode = '22023'; end if;
end $$;

-- Erases a file that is pending deletion. p_force = the owner chose "delete now" (checked by the web server).
create function public.patient_purge(p_patient uuid, p_force boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.patients;
  t text; v_pass int := 0; v_left int;
begin
  select * into p from public.patients where id = p_patient for update;
  if not found then return; end if;
  if p.deletion_requested_at is null then raise exception 'not_pending' using errcode = '22023'; end if;
  if not p_force and p.deletion_scheduled_for > now() then raise exception 'grace_period_not_elapsed' using errcode = '22023'; end if;

  perform set_config('app.purging', 'on', true);
  insert into public.patient_deletion_log (patient_id, mrn, requested_by, requested_at, reason)
  values (p.id, p.mrn, p.deletion_requested_by, p.deletion_requested_at, case when p_force then 'deleted_now_by_owner' else 'grace_period_elapsed' end);

  -- children first; foreign keys between the patient's own tables are resolved by repeating until nothing is left
  loop
    v_pass := v_pass + 1; v_left := 0;
    for t in
      select c.table_name from information_schema.columns c
       where c.table_schema = 'public' and c.column_name = 'patient_id' and c.table_name not in ('patients', 'patient_deletion_log')
    loop
      begin
        execute format('delete from public.%I where patient_id = $1', t) using p.id;
      exception when foreign_key_violation then v_left := v_left + 1;
      end;
    end loop;
    exit when v_left = 0;
    if v_pass >= 15 then raise exception 'purge_incomplete' using errcode = '55000'; end if;
  end loop;
  delete from public.patients where id = p.id;
end $$;

create function public.patient_purge_due() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(id), '{}') from public.patients where deletion_scheduled_for is not null and deletion_scheduled_for <= now()
$$;

grant execute on function public.patient_request_deletion(uuid, text) to authenticated;
grant execute on function public.patient_cancel_deletion(uuid) to authenticated;
grant execute on function public.patient_purge(uuid, boolean) to service_role;
grant execute on function public.patient_purge_due() to service_role;
