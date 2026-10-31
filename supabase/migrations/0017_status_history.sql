-- 0017: a visible life cycle for health problems, medications and allergies.
--
-- Every change of status (a diagnosis that becomes resolved or recurs, a medication stopped or resumed, an allergy that
-- resolved) is kept in public.status_history with who, when, the date it took effect and the reason. Rows are written
-- by a trigger only, so the history cannot be edited. public.record_set_status changes a status in one step (with its
-- date and reason) under the caller's own rights, so RLS and the clinician guards still apply.

create table public.status_history (
  id bigint generated always as identity primary key,
  patient_id uuid not null references public.patients (id) on delete restrict,
  table_name text not null check (table_name in ('conditions', 'medications', 'allergies')),
  record_id uuid not null,
  field text not null check (field in ('clinical_status', 'certainty', 'status')),
  from_value text,
  to_value text not null,
  effective_date date,
  reason text check (length(reason) <= 500),
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users (id),
  contributed_by uuid
);
create index status_history_record_idx on public.status_history (table_name, record_id, changed_at);
create index status_history_patient_idx on public.status_history (patient_id, changed_at desc);

create function app.track_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  j_new jsonb := to_jsonb(new);
  j_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  f text;
  v_reason text := nullif(current_setting('app.status_reason', true), '');
  v_date date := nullif(current_setting('app.status_date', true), '')::date;
  v_contrib uuid := nullif(current_setting('app.share_contributor', true), '')::uuid;
begin
  foreach f in array tg_argv loop
    if tg_op = 'INSERT' or (j_old ->> f) is distinct from (j_new ->> f) then
      insert into public.status_history (patient_id, table_name, record_id, field, from_value, to_value, effective_date, reason, changed_by, contributed_by)
      values ((j_new ->> 'patient_id')::uuid, tg_table_name, (j_new ->> 'id')::uuid, f, j_old ->> f, j_new ->> f,
              case when tg_op = 'UPDATE' then v_date end, case when tg_op = 'UPDATE' then left(v_reason, 500) end, auth.uid(),
              case when auth.uid() is null then v_contrib end);
    end if;
  end loop;
  return null;
end $$;
create trigger conditions_status_history after insert or update on public.conditions
  for each row execute function app.track_status('clinical_status', 'certainty');
create trigger medications_status_history after insert or update on public.medications
  for each row execute function app.track_status('status');
create trigger allergies_status_history after insert or update on public.allergies
  for each row execute function app.track_status('status');

-- what exists today starts its history now (the original status as the first entry)
insert into public.status_history (patient_id, table_name, record_id, field, from_value, to_value, changed_at, changed_by)
select patient_id, 'conditions', id, 'clinical_status', null, clinical_status, recorded_at, recorded_by from public.conditions;
insert into public.status_history (patient_id, table_name, record_id, field, from_value, to_value, changed_at, changed_by)
select patient_id, 'medications', id, 'status', null, status, recorded_at, recorded_by from public.medications;
insert into public.status_history (patient_id, table_name, record_id, field, from_value, to_value, changed_at, changed_by)
select patient_id, 'allergies', id, 'status', null, status, recorded_at, recorded_by from public.allergies;

alter table public.status_history enable row level security;
create policy status_history_sel on public.status_history for select to authenticated using (app.has_patient_access(patient_id));
grant select on public.status_history to authenticated;
grant all on public.status_history to service_role;

-- one step: change the status, with the date it took effect and the reason (runs with the caller's rights)
create function public.record_set_status(p_table text, p_id uuid, p_status text, p_reason text default null, p_date date default null)
returns void
language plpgsql set search_path = '' as $$
declare v_date date := coalesce(p_date, current_date); n int;
begin
  if p_date is not null and p_date > current_date + 1 then raise exception 'date_in_future' using errcode = '22023'; end if;
  perform set_config('app.status_reason', coalesce(btrim(p_reason), ''), true);
  perform set_config('app.status_date', v_date::text, true);
  if p_table = 'conditions' then
    if p_status = 'refuted' then
      update public.conditions set certainty = 'refuted' where id = p_id and record_status = 'active';
    elsif p_status in ('active', 'recurrence', 'inactive', 'remission', 'resolved') then
      update public.conditions set clinical_status = p_status,
             resolved_date = case when p_status = 'resolved' then v_date when p_status in ('active', 'recurrence') then null else resolved_date end
       where id = p_id and record_status = 'active';
    else raise exception 'invalid_status' using errcode = '22023';
    end if;
  elsif p_table = 'medications' then
    if p_status not in ('active', 'on_hold', 'stopped', 'completed') then raise exception 'invalid_status' using errcode = '22023'; end if;
    update public.medications set status = p_status,
           end_date = case when p_status in ('stopped', 'completed') then v_date when p_status = 'active' then null else end_date end,
           stop_reason = case when p_status in ('stopped', 'completed') then coalesce(nullif(btrim(p_reason), ''), stop_reason) when p_status = 'active' then null else stop_reason end,
           stopped_by = case when p_status = 'completed' then 'course_completed' when p_status = 'active' then null else stopped_by end
     where id = p_id and record_status = 'active';
  elsif p_table = 'allergies' then
    if p_status not in ('active', 'inactive', 'resolved') then raise exception 'invalid_status' using errcode = '22023'; end if;
    update public.allergies set status = p_status where id = p_id and record_status = 'active';
  else
    raise exception 'invalid_table' using errcode = '22023';
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.record_set_status(text, uuid, text, text, date) from public;
grant execute on function public.record_set_status(text, uuid, text, text, date) to authenticated;
