-- 0010_sex_applicability: some specialties and tests only make sense for one sex (e.g. obstetrics & gynecology).
-- A NULL applicable_sex means "everyone". The rule is enforced in the database, not only hidden in the UI:
--   * a record cannot be filed under a specialty (or a result type) that does not apply to the patient's recorded sex;
--   * patients whose sex is 'unspecified' or 'intersex' are never restricted (we do not guess);
--   * the sex of a file cannot be changed to one that conflicts with active records in a restricted specialty.

alter table public.medical_specialties
  add column applicable_sex text check (applicable_sex is null or applicable_sex in ('male', 'female'));
alter table public.observation_types
  add column applicable_sex text check (applicable_sex is null or applicable_sex in ('male', 'female'));

update public.medical_specialties set applicable_sex = 'female' where code = 'obgyn';
update public.observation_types set applicable_sex = 'female' where code in ('beta_hcg', 'pregnancy_test');

insert into public.medical_specialties (code, name_ar, name_en, icon, kind, sort, applicable_sex) values
  ('mens_health', 'صحة الرجل والعقم الذكري', 'Men''s health & andrology', 'mars', 'clinical', 235, 'male')
on conflict (code) do nothing;

create function app.sex_conflict(p_patient_sex text, p_required text) returns boolean
language sql immutable as $$
  select p_required is not null and p_patient_sex in ('male', 'female') and p_required <> p_patient_sex
$$;

create function app.sex_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  j jsonb := to_jsonb(new);
  v_sex text;
  v_spec uuid := nullif(j ->> 'specialty_id', '')::uuid;
  v_type uuid := case when tg_table_name = 'observations' then nullif(j ->> 'type_id', '')::uuid end;
  v_req text;
begin
  if tg_op = 'UPDATE' then
    -- editing an old row (e.g. marking it entered-in-error) must not be blocked by a later sex correction
    if v_spec is not distinct from nullif(to_jsonb(old) ->> 'specialty_id', '')::uuid
       and (tg_table_name <> 'observations' or v_type is not distinct from nullif(to_jsonb(old) ->> 'type_id', '')::uuid) then
      return new;
    end if;
  end if;
  select p.sex into v_sex from public.patients p where p.id = (j ->> 'patient_id')::uuid;
  if v_spec is not null then
    select s.applicable_sex into v_req from public.medical_specialties s where s.id = v_spec;
    if app.sex_conflict(v_sex, v_req) then
      raise exception 'specialty_not_applicable' using errcode = '22023',
        hint = 'This specialty does not apply to the sex recorded for this patient.';
    end if;
  end if;
  if v_type is not null then
    select t.applicable_sex into v_req from public.observation_types t where t.id = v_type;
    if app.sex_conflict(v_sex, v_req) then
      raise exception 'measurement_not_applicable' using errcode = '22023',
        hint = 'This measurement does not apply to the sex recorded for this patient.';
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
     where c.table_schema = 'public' and c.column_name = 'specialty_id'
       and c.table_name in (select table_name from information_schema.columns where table_schema = 'public' and column_name = 'patient_id')
  loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.sex_guard()', t || '_sex_guard', t);
  end loop;
end $$;

-- Changing the recorded sex: refuse while active records sit in a specialty / result type that would no longer apply.
create function app.patients_sex_change_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t text; v_n bigint; v_active text;
begin
  if new.sex = old.sex or new.sex not in ('male', 'female') then return new; end if;
  for t in
    select c.table_name from information_schema.columns c
     where c.table_schema = 'public' and c.column_name = 'specialty_id'
       and c.table_name in (select table_name from information_schema.columns where table_schema = 'public' and column_name = 'patient_id')
  loop
    v_active := case when t = 'observations' then 'x.status <> ''entered_in_error''' else 'x.record_status = ''active''' end;
    execute format('select count(*) from public.%I x join public.medical_specialties s on s.id = x.specialty_id
                     where x.patient_id = $1 and s.applicable_sex is not null and s.applicable_sex <> $2 and %s', t, v_active)
      into v_n using new.id, new.sex;
    if v_n > 0 then
      raise exception 'sex_change_conflict' using errcode = '22023',
        hint = 'Active records exist in a specialty that does not apply to the new sex; mark them entered-in-error first.';
    end if;
  end loop;
  select count(*) into v_n from public.observations o join public.observation_types ot on ot.id = o.type_id
   where o.patient_id = new.id and o.status <> 'entered_in_error' and ot.applicable_sex is not null and ot.applicable_sex <> new.sex;
  if v_n > 0 then
    raise exception 'sex_change_conflict' using errcode = '22023',
      hint = 'Active results exist that do not apply to the new sex; mark them entered-in-error first.';
  end if;
  return new;
end $$;
create trigger patients_sex_change before update of sex on public.patients
  for each row execute function app.patients_sex_change_guard();
