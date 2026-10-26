-- 0004_audit_and_guards: provenance columns, immutability rules, result interpretation, audit trail.
--
-- Rules enforced here (not only in the UI):
--   * clinical rows are never hard-deleted; a mistaken row is marked entered_in_error with a reason;
--   * an approved (final) result cannot be edited in place - it is corrected by a NEW row that supersedes it;
--   * recorded_by / recorded_at are stamped by the database, a client cannot spoof them;
--   * only a clinician member (or the service role) can mark data as clinician-confirmed / verified;
--   * every change is written to the append-only public.audit_logs.

-- ---------------------------------------------------------------- audit log
create table public.audit_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_kind text not null check (actor_kind in ('user', 'system')),
  patient_id uuid,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('insert', 'update', 'invalidate')),
  changed_fields text[],
  old_data jsonb,
  new_data jsonb
);
create index audit_logs_patient_idx on public.audit_logs (patient_id, at desc);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id);

create function app.audit_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '42501';
end $$;
create trigger audit_logs_no_change before update or delete on public.audit_logs
  for each row execute function app.audit_immutable();

-- Generic row audit. TG_ARGV = columns whose values must never be copied into the log.
create function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  j_new jsonb := to_jsonb(new);
  j_old jsonb;
  v_changed text[];
  v_old jsonb;
  v_new jsonb;
  v_action text;
  v_col text;
begin
  if tg_op = 'UPDATE' then
    j_old := to_jsonb(old);
    select coalesce(array_agg(n.key order by n.key), '{}') into v_changed
      from jsonb_each(j_new) n where j_old -> n.key is distinct from n.value;
    v_changed := array_remove(v_changed, 'updated_at');
    v_changed := array_remove(v_changed, 'updated_by');
    if cardinality(v_changed) = 0 then return null; end if;
    select jsonb_object_agg(k, j_old -> k), jsonb_object_agg(k, j_new -> k) into v_old, v_new from unnest(v_changed) k;
    v_action := case
      when j_new ->> 'record_status' = 'entered_in_error' and j_old ->> 'record_status' is distinct from 'entered_in_error' then 'invalidate'
      when j_new ->> 'status' = 'entered_in_error' and j_old ->> 'status' is distinct from 'entered_in_error' then 'invalidate'
      else 'update' end;
  else
    v_new := j_new; v_action := 'insert';
  end if;
  if tg_argv is not null then   -- NULL (not empty) when the trigger was declared without arguments
    foreach v_col in array tg_argv loop
      if v_new ? v_col then v_new := jsonb_set(v_new, array[v_col], '"[redacted]"'); end if;
      if v_old ? v_col then v_old := jsonb_set(v_old, array[v_col], '"[redacted]"'); end if;
    end loop;
  end if;
  insert into public.audit_logs (actor_id, actor_kind, patient_id, table_name, record_id, action, changed_fields, old_data, new_data)
  values (auth.uid(), case when auth.uid() is null then 'system' else 'user' end,
          coalesce((j_new ->> 'patient_id')::uuid, case when tg_table_name = 'patients' then (j_new ->> 'id')::uuid end),
          tg_table_name, (j_new ->> 'id')::uuid, v_action, v_changed, v_old, v_new);
  return null;
end $$;

-- ---------------------------------------------------------------- provenance + lifecycle columns
do $$
declare t text;
begin
  foreach t in array array['encounters', 'conditions', 'allergies', 'medications', 'procedures', 'medical_documents',
                           'lab_reports', 'observations', 'test_orders', 'imaging_studies', 'immunizations',
                           'family_history', 'appointments', 'care_plans', 'clinical_notes', 'specialty_records']
  loop
    execute format('alter table public.%I
      add column source text not null default ''self'' check (source in (''self'', ''clinic'', ''hospital'', ''laboratory'', ''device'', ''imported'', ''other'')),
      add column source_detail text check (source_detail is null or length(source_detail) <= 300),
      add column verification text not null default ''reported'' check (verification in (''reported'', ''confirmed'', ''verified'')),
      add column recorded_by uuid references auth.users (id) default auth.uid(),
      add column recorded_at timestamptz not null default now(),
      add column updated_at timestamptz not null default now(),
      add column updated_by uuid references auth.users (id)', t);
    if t <> 'observations' then   -- observations carry the lifecycle in their own "status"
      execute format('alter table public.%I
        add column record_status text not null default ''active'' check (record_status in (''active'', ''entered_in_error'')),
        add column invalidated_reason text,
        add column invalidated_at timestamptz,
        add column invalidated_by uuid references auth.users (id),
        add constraint %I check (record_status = ''active'' or length(btrim(coalesce(invalidated_reason, ''''))) > 0)',
        t, t || '_invalid_reason_chk');
    end if;
  end loop;
end $$;

create function app.is_clinician_member(p_patient uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.patient_members m
                  where m.patient_id = p_patient and m.user_id = auth.uid() and m.revoked_at is null
                    and m.role = 'clinician' and m.can_write)
$$;

create function app.clinical_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  j_new jsonb := to_jsonb(new);
  j_old jsonb;
  v_trusted boolean := auth.uid() is null or app.is_clinician_member((j_new ->> 'patient_id')::uuid);
  v_has_rs boolean := j_new ? 'record_status';
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.recorded_by := auth.uid(); end if;
    new.recorded_at := now(); new.updated_at := now(); new.updated_by := auth.uid();
    if not v_trusted then new.verification := 'reported'; end if;
    if v_has_rs and j_new ->> 'record_status' <> 'active' then
      raise exception 'new records must be active' using errcode = '22023';
    end if;
    return new;
  end if;

  j_old := to_jsonb(old);
  if new.id <> old.id or new.patient_id <> old.patient_id or new.recorded_by is distinct from old.recorded_by
     or new.recorded_at <> old.recorded_at then
    raise exception 'immutable fields cannot be changed' using errcode = '42501';
  end if;
  if not v_trusted then new.verification := old.verification; end if;
  new.updated_at := now(); new.updated_by := auth.uid();

  if v_has_rs then
    if j_old ->> 'record_status' = 'entered_in_error' then
      raise exception 'a record marked entered-in-error cannot be modified' using errcode = '42501';
    end if;
    if j_new ->> 'record_status' = 'entered_in_error' then
      if length(btrim(coalesce(j_new ->> 'invalidated_reason', ''))) = 0 then
        raise exception 'a reason is required to mark a record as entered in error' using errcode = '22023';
      end if;
      new.invalidated_at := now(); new.invalidated_by := auth.uid();
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['encounters', 'conditions', 'allergies', 'medications', 'procedures', 'medical_documents',
                           'lab_reports', 'observations', 'test_orders', 'imaging_studies', 'immunizations',
                           'family_history', 'appointments', 'care_plans', 'clinical_notes', 'specialty_records']
  loop
    if t <> 'observations' then   -- observations get their own pair of triggers below
      execute format('create trigger %I before insert or update on public.%I for each row execute function app.clinical_guard()', t || '_guard', t);
    end if;
    execute format('create trigger %I after insert or update on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end $$;

create trigger patients_audit after insert or update on public.patients for each row execute function app.audit_row();
create trigger patient_members_audit after insert or update on public.patient_members for each row execute function app.audit_row();
create trigger emergency_contacts_audit after insert or update on public.emergency_contacts for each row execute function app.audit_row();
create trigger patient_insurance_audit after insert or update on public.patient_insurance for each row execute function app.audit_row();
create trigger patient_identifiers_audit after insert or update on public.patient_identifiers
  for each row execute function app.audit_row('id_value');

-- ---------------------------------------------------------------- alert bands (screening aid, never a diagnosis)
create function app.screen_observation(
  p_type uuid, p_v1 numeric, p_v2 numeric, p_unit text, p_context text, p_age numeric
) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.observation_types;
  v_factor numeric := 1;
  v1 numeric; v2 numeric;
  v_band text; v_best text; v_rank int := 0; v_r int;
  v_comp smallint; v_val numeric;
begin
  select * into t from public.observation_types where id = p_type;
  if not found or p_v1 is null then return null; end if;
  if p_unit is not null and t.default_unit is not null and p_unit <> t.default_unit then
    if t.unit_conversions ? p_unit then v_factor := (t.unit_conversions ->> p_unit)::numeric; else return null; end if;
  end if;
  v1 := p_v1 * v_factor; v2 := p_v2 * v_factor;
  for v_comp in 1..2 loop
    v_val := case v_comp when 1 then v1 else v2 end;
    continue when v_val is null;
    select b.band into v_band from public.observation_bands b
     where b.type_id = p_type and b.component = v_comp
       and (b.context is null or b.context = p_context)
       and (p_context is null or not (p_context = any(b.exclude_contexts)))
       and p_age >= b.age_min_years and (b.age_max_years is null or p_age < b.age_max_years)
       and (b.lo is null or v_val >= b.lo) and (b.hi is null or v_val < b.hi)
     order by (b.context is not null) desc
     limit 1;
    continue when v_band is null;
    v_r := case v_band when 'normal' then 1 when 'borderline' then 2 when 'low' then 3 when 'high' then 3 else 4 end;
    if v_r > v_rank then v_rank := v_r; v_best := v_band; end if;
  end loop;
  return v_best;
end $$;

-- ---------------------------------------------------------------- observation rules
create function app.observations_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t public.observation_types;
  v_dob date;
  v_age numeric;
  v_factor numeric := 1;
  v_prev public.observations;
  v_screen text;
begin
  if tg_op = 'UPDATE' then
    if new.status = 'amended' and old.status = 'final' then
      if not exists (select 1 from public.observations n where n.supersedes_id = old.id) then
        raise exception 'a result can only be amended by recording a correction' using errcode = '42501';
      end if;
    elsif old.status in ('final', 'amended', 'entered_in_error') then
      if old.status = 'entered_in_error' then
        raise exception 'a result marked entered-in-error cannot be modified' using errcode = '42501';
      end if;
      if (new.type_id, new.value_num, new.value_num2, new.value_text, new.unit, new.effective_at, new.ref_low, new.ref_high,
          new.ref_text, new.interpretation, new.report_id, new.custom_name, new.supersedes_id, new.context)
         is distinct from
         (old.type_id, old.value_num, old.value_num2, old.value_text, old.unit, old.effective_at, old.ref_low, old.ref_high,
          old.ref_text, old.interpretation, old.report_id, old.custom_name, old.supersedes_id, old.context) then
        raise exception 'an approved result cannot be edited; record a correction instead' using errcode = '42501';
      end if;
      if new.status = 'entered_in_error' and length(btrim(coalesce(new.amendment_reason, ''))) = 0 then
        raise exception 'a reason is required to mark a result as entered in error' using errcode = '22023';
      end if;
      if new.status not in (old.status, 'entered_in_error') then
        raise exception 'invalid status change' using errcode = '22023';
      end if;
      return new;
    end if;
    if old.status = 'preliminary' and new.status = 'amended' then
      raise exception 'invalid status change' using errcode = '22023';
    end if;
    if new.status = 'entered_in_error' and length(btrim(coalesce(new.amendment_reason, ''))) = 0 then
      raise exception 'a reason is required to mark a result as entered in error' using errcode = '22023';
    end if;
    if new.status = 'amended' then return new; end if;
  else
    if new.status not in ('preliminary', 'final') then
      raise exception 'a new result must be preliminary or final' using errcode = '22023';
    end if;
  end if;

  select * into t from public.observation_types where id = new.type_id;
  if not found or not t.is_active then raise exception 'unknown observation type' using errcode = '22023'; end if;

  if t.value_kind = 'bp' then
    if new.value_num is null or new.value_num2 is null then
      raise exception 'blood pressure needs systolic and diastolic together' using errcode = '22023';
    end if;
    if new.value_num <= new.value_num2 then
      raise exception 'systolic must be greater than diastolic' using errcode = '22023';
    end if;
  elsif new.value_num2 is not null then
    raise exception 'second value is only valid for blood pressure' using errcode = '22023';
  end if;
  if t.value_kind = 'numeric' and new.value_num is null then
    raise exception 'a numeric value is required' using errcode = '22023';
  end if;
  if t.value_kind = 'text' and new.value_text is null and new.value_num is null then
    raise exception 'a result is required' using errcode = '22023';
  end if;
  if t.default_unit is not null and (t.value_kind in ('numeric', 'bp')) then
    new.unit := coalesce(nullif(btrim(new.unit), ''), t.default_unit);
    if new.unit <> t.default_unit then
      if t.unit_conversions ? new.unit then v_factor := (t.unit_conversions ->> new.unit)::numeric;
      else raise exception 'unsupported unit % for %', new.unit, t.code using errcode = '22023'; end if;
    end if;
  end if;
  if new.value_num is not null and t.plausible_min is not null
     and (new.value_num * v_factor < t.plausible_min or new.value_num * v_factor > t.plausible_max) then
    raise exception 'value is outside the plausible range for %', t.code using errcode = '22003';
  end if;
  if new.value_num2 is not null and (new.value_num2 * v_factor < 10 or new.value_num2 * v_factor > 250) then
    raise exception 'diastolic value is outside the plausible range' using errcode = '22003';
  end if;
  if new.effective_at > now() + interval '10 minutes' then
    raise exception 'effective_at cannot be in the future' using errcode = '22023';
  end if;
  if new.supersedes_id is not null then
    select * into v_prev from public.observations where id = new.supersedes_id;
    if not found or v_prev.patient_id <> new.patient_id or v_prev.type_id <> new.type_id then
      raise exception 'a correction must supersede a result of the same patient and type' using errcode = '22023';
    end if;
  end if;

  if new.interpretation = 'not_assessed' then
    new.interpretation_basis := 'none';
    if new.value_num is not null and (new.ref_low is not null or new.ref_high is not null) then
      new.interpretation := case
        when new.ref_low is not null and new.value_num < new.ref_low then 'low'
        when new.ref_high is not null and new.value_num > new.ref_high then 'high'
        else 'normal' end;
      new.interpretation_basis := 'lab_reference_range';
    elsif new.value_num is not null and t.category in ('vital', 'activity') then
      select p.date_of_birth into v_dob from public.patients p where p.id = new.patient_id;
      v_age := date_part('year', age(new.effective_at::date, v_dob));
      v_screen := app.screen_observation(new.type_id, new.value_num, new.value_num2, new.unit, new.context, v_age);
      if v_screen is not null then
        new.interpretation := v_screen; new.interpretation_basis := 'screening_rule';
      end if;
    end if;
  elsif new.interpretation_basis is null then
    new.interpretation_basis := 'reported_by_lab';
  end if;
  return new;
end $$;

-- BEFORE triggers fire in name order: rules/validation first, then provenance stamping.
create trigger observations_a_rules before insert or update on public.observations
  for each row execute function app.observations_guard();
create trigger observations_b_stamp before insert or update on public.observations
  for each row execute function app.clinical_guard();

-- Records a correction: inserts a superseding row, then marks the original amended. Runs as the caller (RLS applies).
create function public.observation_correct(
  p_id uuid, p_value_num numeric, p_value_num2 numeric, p_value_text text, p_unit text, p_reason text,
  p_ref_low numeric default null, p_ref_high numeric default null, p_ref_text text default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare o public.observations; v_new uuid;
begin
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'a reason is required for a correction' using errcode = '22023';
  end if;
  select * into o from public.observations where id = p_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if o.status not in ('final') then
    raise exception 'only an approved result can be corrected' using errcode = '22023';
  end if;
  insert into public.observations (patient_id, type_id, specialty_id, report_id, encounter_id, custom_name, value_num, value_num2,
      value_text, unit, effective_at, setting, device, context, symptoms, notes, ref_low, ref_high, ref_text, status,
      supersedes_id, amendment_reason, source, source_detail)
  values (o.patient_id, o.type_id, o.specialty_id, o.report_id, o.encounter_id, o.custom_name, p_value_num, p_value_num2,
      p_value_text, coalesce(p_unit, o.unit), o.effective_at, o.setting, o.device, o.context, o.symptoms, o.notes,
      coalesce(p_ref_low, o.ref_low), coalesce(p_ref_high, o.ref_high), coalesce(p_ref_text, o.ref_text), 'final',
      o.id, left(p_reason, 500), o.source, o.source_detail)
  returning id into v_new;
  update public.observations set status = 'amended', amendment_reason = left(p_reason, 500) where id = o.id;
  return v_new;
end $$;

-- ---------------------------------------------------------------- specialty record payload validation
create function app.specialty_records_validate() returns trigger
language plpgsql set search_path = '' as $$
declare
  rt public.specialty_record_types;
  f jsonb;
  k text;
  v jsonb;
begin
  select * into rt from public.specialty_record_types where id = new.record_type_id;
  if not found or not rt.is_active then raise exception 'unknown record type' using errcode = '22023'; end if;
  if rt.specialty_id <> new.specialty_id then
    raise exception 'record type does not belong to this specialty' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(new.data) loop
    if not exists (select 1 from jsonb_array_elements(rt.fields) e where e ->> 'key' = k) then
      raise exception 'unknown field %', k using errcode = '22023';
    end if;
  end loop;
  for f in select * from jsonb_array_elements(rt.fields) loop
    v := new.data -> (f ->> 'key');
    if v is null or v = 'null'::jsonb or v = '""'::jsonb then
      if coalesce((f ->> 'required')::boolean, false) then
        raise exception 'field % is required', f ->> 'key' using errcode = '22023';
      end if;
      continue;
    end if;
    case f ->> 'type'
      when 'number' then
        if jsonb_typeof(v) <> 'number' then raise exception 'field % must be a number', f ->> 'key' using errcode = '22023'; end if;
      when 'date' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'field % must be a date', f ->> 'key' using errcode = '22023';
        end if;
      when 'select' then
        if jsonb_typeof(v) <> 'string' or not exists (
             select 1 from jsonb_array_elements(coalesce(f -> 'options', '[]'::jsonb)) o where o ->> 'value' = v #>> '{}') then
          raise exception 'field % has an invalid option', f ->> 'key' using errcode = '22023';
        end if;
      else
        if jsonb_typeof(v) <> 'string' or length(v #>> '{}') > 4000 then
          raise exception 'field % must be text', f ->> 'key' using errcode = '22023';
        end if;
    end case;
  end loop;
  return new;
end $$;
create trigger specialty_records_validate before insert or update on public.specialty_records
  for each row execute function app.specialty_records_validate();
