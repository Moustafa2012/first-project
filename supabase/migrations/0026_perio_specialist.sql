-- 0026: the periodontal chart reaches the periodontist.
--
-- After the general dentist the patient goes to a periodontist with a NEW share link (the patient names the doctor on the link;
-- there is no referral entity). That doctor sees the dental file, charts the gums themselves through the link, records the
-- periodontal diagnosis (2017 AAP/EFP: stage, grade, extent) and can lay out the treatment in phases. Every later doctor
-- sees the final chart and its diagnosis.
--
--  1. contribution module 'perio_exams'; perio_exams.contributed_by / encounter_id
--  2. the diagnosis columns (dx_*) with their checks
--  3. a chart a doctor recorded is theirs: accounts cannot edit it or add teeth to it, but can mark it entered in error
--  4. one open draft per author (the patient, or each contributor)
--  5. share_perio (read) and share_perio_save (write) — service role only
--  6. catalogue codes for the phased periodontal plan
--  7. withdrawal / "my additions" / "invalidate everything from one clinician" know perio_exams

-- ---------------------------------------------------------------- 1. the module and the provenance
alter table public.medical_shares drop constraint if exists medical_shares_contribute_modules_check;
alter table public.medical_shares add constraint medical_shares_contribute_modules_check
  check (contribute_modules <@ array['encounters', 'conditions', 'procedures', 'clinical_notes', 'medications', 'appointments',
                                     'test_orders', 'imaging_studies', 'medical_documents', 'dental_exams', 'treatment_plans',
                                     'perio_exams']::text[]);

alter table public.perio_exams
  add column contributed_by uuid,
  add column encounter_id uuid,
  add constraint perio_exams_contributed_by_fkey foreign key (contributed_by, patient_id) references public.share_contributors (id, patient_id),
  add constraint perio_exams_encounter_fkey foreign key (encounter_id, patient_id) references public.encounters (id, patient_id);
create index perio_exams_contributed_idx on public.perio_exams (contributed_by) where contributed_by is not null;
create index perio_exams_encounter_idx on public.perio_exams (encounter_id) where encounter_id is not null;

-- ---------------------------------------------------------------- 2. the periodontal diagnosis (2017 AAP/EFP classification)
-- Entered by the clinician. The app only suggests it from the chart; what is stored is what the clinician confirmed or changed.
alter table public.perio_exams
  add column dx_kind text check (dx_kind in ('health', 'gingivitis', 'periodontitis', 'other')),
  add column dx_stage text check (dx_stage in ('I', 'II', 'III', 'IV')),
  add column dx_grade text check (dx_grade in ('A', 'B', 'C')),
  add column dx_extent text check (dx_extent in ('localized', 'generalized', 'molar_incisor')),
  -- radiographic bone loss at the worst site, as a percentage of the root length
  add column dx_rbl_pct smallint check (dx_rbl_pct between 0 and 100),
  add column dx_teeth_lost_perio smallint check (dx_teeth_lost_perio between 0 and 32),
  add column dx_note text check (length(dx_note) <= 2000),
  -- stage, grade and extent describe periodontitis only; a final chart that names periodontitis names all three
  add constraint perio_exams_dx_periodontitis_chk
    check ((dx_stage is null and dx_grade is null and dx_extent is null) or coalesce(dx_kind = 'periodontitis', false)),
  add constraint perio_exams_dx_complete_chk
    check (status = 'draft' or dx_kind is distinct from 'periodontitis' or (dx_stage is not null and dx_grade is not null and dx_extent is not null));

-- ---------------------------------------------------------------- 3. a doctor's chart is the doctor's
-- A chart recorded through a link can be marked entered in error by the patient, but not rewritten.
create trigger perio_exams_contrib_guard before insert or update on public.perio_exams
  for each row execute function app.contribution_guard();

-- a final chart is never edited: that now covers the diagnosis, the visit it is linked to and who recorded it
create or replace function app.perio_exam_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'final' then new.finalized_at := now(); new.finalized_by := auth.uid();
    else new.finalized_at := null; new.finalized_by := null; end if;
    return new;
  end if;
  if old.status = 'final' then
    if new.status <> 'final' or new.finalized_at is distinct from old.finalized_at or new.finalized_by is distinct from old.finalized_by
       or new.exam_date <> old.exam_date or new.examiner_name is distinct from old.examiner_name
       or new.facility_name is distinct from old.facility_name or new.notes is distinct from old.notes
       or new.specialty_id is distinct from old.specialty_id or new.source <> old.source or new.source_detail is distinct from old.source_detail
       or new.encounter_id is distinct from old.encounter_id or new.dx_kind is distinct from old.dx_kind
       or new.dx_stage is distinct from old.dx_stage or new.dx_grade is distinct from old.dx_grade or new.dx_extent is distinct from old.dx_extent
       or new.dx_rbl_pct is distinct from old.dx_rbl_pct or new.dx_teeth_lost_perio is distinct from old.dx_teeth_lost_perio
       or new.dx_note is distinct from old.dx_note then
      raise exception 'perio_final' using errcode = '42501', hint = 'A final periodontal exam is not edited; mark it entered in error and record a new one.';
    end if;
  elsif new.status = 'final' then
    new.finalized_at := now(); new.finalized_by := auth.uid();
  else
    new.finalized_at := null; new.finalized_by := null;
  end if;
  return new;
end $$;

-- the teeth of a chart a doctor recorded are not written from an account
create or replace function app.perio_tooth_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e record;
begin
  if tg_op = 'UPDATE' and (new.exam_id <> old.exam_id or new.patient_id <> old.patient_id or new.tooth <> old.tooth) then
    raise exception 'immutable fields cannot be changed' using errcode = '42501';
  end if;
  select x.status, x.record_status, x.contributed_by into e from public.perio_exams x where x.id = new.exam_id and x.patient_id = new.patient_id;
  if not found then return new; end if;   -- the foreign key reports it
  if e.contributed_by is not null and auth.uid() is not null then
    raise exception 'contributed_record_readonly' using errcode = '42501',
      hint = 'A chart recorded by a clinician through a share can be invalidated but not edited.';
  end if;
  if e.record_status <> 'active' then raise exception 'the exam was marked entered in error' using errcode = '22023'; end if;
  if e.status = 'final' then
    raise exception 'perio_final' using errcode = '42501', hint = 'A final periodontal exam is not edited; mark it entered in error and record a new one.';
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;

-- ---------------------------------------------------------------- 4. one open draft per author
-- the patient has one, and so does each clinician who charts through a link
drop index public.perio_exams_one_draft;
create unique index perio_exams_one_draft on public.perio_exams (patient_id, coalesce(contributed_by, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'draft' and record_status = 'active';

-- ---------------------------------------------------------------- writing the teeth (shared by the account and the link)
create function app.perio_teeth_write(p_patient uuid, p_exam uuid, p_teeth jsonb) returns void
language plpgsql set search_path = '' as $$
declare x jsonb;
begin
  for x in select * from jsonb_array_elements(coalesce(p_teeth, '[]')) loop
    insert into public.perio_teeth as t (patient_id, exam_id, tooth, missing, implant, mobility, furcation_b, furcation_l, furcation_m, furcation_d,
                                         pd, gm, bop, plaque, suppuration, note)
    values (p_patient, p_exam, (x ->> 'tooth')::smallint, coalesce((x ->> 'missing')::boolean, false), coalesce((x ->> 'implant')::boolean, false),
            (x ->> 'mobility')::smallint, (x ->> 'furcation_b')::smallint, (x ->> 'furcation_l')::smallint,
            (x ->> 'furcation_m')::smallint, (x ->> 'furcation_d')::smallint,
            case when jsonb_typeof(x -> 'pd') = 'array' then array(select (v #>> '{}')::smallint from jsonb_array_elements(x -> 'pd') v) end,
            case when jsonb_typeof(x -> 'gm') = 'array' then array(select (v #>> '{}')::smallint from jsonb_array_elements(x -> 'gm') v) end,
            case when jsonb_typeof(x -> 'bop') = 'array' then array(select (v #>> '{}')::boolean from jsonb_array_elements(x -> 'bop') v) end,
            case when jsonb_typeof(x -> 'plaque') = 'array' then array(select (v #>> '{}')::boolean from jsonb_array_elements(x -> 'plaque') v) end,
            case when jsonb_typeof(x -> 'suppuration') = 'array' then array(select (v #>> '{}')::boolean from jsonb_array_elements(x -> 'suppuration') v) end,
            nullif(btrim(x ->> 'note'), ''))
    on conflict (exam_id, tooth) do update set missing = excluded.missing, implant = excluded.implant, mobility = excluded.mobility,
           furcation_b = excluded.furcation_b, furcation_l = excluded.furcation_l, furcation_m = excluded.furcation_m, furcation_d = excluded.furcation_d,
           pd = excluded.pd, gm = excluded.gm, bop = excluded.bop, plaque = excluded.plaque, suppuration = excluded.suppuration, note = excluded.note
     where (t.missing, t.implant, t.mobility, t.furcation_b, t.furcation_l, t.furcation_m, t.furcation_d, t.pd, t.gm, t.bop, t.plaque, t.suppuration, t.note)
           is distinct from (excluded.missing, excluded.implant, excluded.mobility, excluded.furcation_b, excluded.furcation_l, excluded.furcation_m,
                             excluded.furcation_d, excluded.pd, excluded.gm, excluded.bop, excluded.plaque, excluded.suppuration, excluded.note);
  end loop;
end $$;
revoke all on function app.perio_teeth_write(uuid, uuid, jsonb) from public, anon;
grant execute on function app.perio_teeth_write(uuid, uuid, jsonb) to authenticated, service_role;

-- the account's own save: the diagnosis and the linked visit come with the chart; it never touches a doctor's chart
create or replace function public.perio_exam_save(p_patient uuid, p_exam_id uuid, p_exam jsonb, p_teeth jsonb, p_finalize boolean default false)
returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid := p_exam_id; v_date date; v_n int;
  v_kind text := nullif(p_exam ->> 'dx_kind', '');
begin
  if not app.has_patient_access(p_patient, 'write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_exam, 'null')) <> 'object' or jsonb_typeof(coalesce(p_teeth, '[]')) <> 'array'
     or jsonb_array_length(coalesce(p_teeth, '[]')) > 60 then
    raise exception 'invalid exam' using errcode = '22023';
  end if;
  v_date := (p_exam ->> 'exam_date')::date;
  if v_date is null or v_date > current_date + 1 then raise exception 'exam_date_invalid' using errcode = '22023'; end if;

  if v_id is null then
    insert into public.perio_exams (patient_id, specialty_id, exam_date, examiner_name, facility_name, notes, source, source_detail, encounter_id,
                                    dx_kind, dx_stage, dx_grade, dx_extent, dx_rbl_pct, dx_teeth_lost_perio, dx_note)
    values (p_patient, (select id from public.medical_specialties where code = 'dentistry'), v_date,
            nullif(btrim(p_exam ->> 'examiner_name'), ''), nullif(btrim(p_exam ->> 'facility_name'), ''), nullif(btrim(p_exam ->> 'notes'), ''),
            coalesce(nullif(p_exam ->> 'source', ''), 'self'), nullif(btrim(p_exam ->> 'source_detail'), ''), nullif(p_exam ->> 'encounter_id', '')::uuid,
            v_kind, nullif(p_exam ->> 'dx_stage', ''), nullif(p_exam ->> 'dx_grade', ''), nullif(p_exam ->> 'dx_extent', ''),
            nullif(p_exam ->> 'dx_rbl_pct', '')::smallint, nullif(p_exam ->> 'dx_teeth_lost_perio', '')::smallint, nullif(btrim(p_exam ->> 'dx_note'), ''))
    returning id into v_id;
  else
    update public.perio_exams set exam_date = v_date, examiner_name = nullif(btrim(p_exam ->> 'examiner_name'), ''),
           facility_name = nullif(btrim(p_exam ->> 'facility_name'), ''), notes = nullif(btrim(p_exam ->> 'notes'), ''),
           source = coalesce(nullif(p_exam ->> 'source', ''), 'self'), source_detail = nullif(btrim(p_exam ->> 'source_detail'), ''),
           encounter_id = nullif(p_exam ->> 'encounter_id', '')::uuid,
           dx_kind = v_kind, dx_stage = nullif(p_exam ->> 'dx_stage', ''), dx_grade = nullif(p_exam ->> 'dx_grade', ''),
           dx_extent = nullif(p_exam ->> 'dx_extent', ''), dx_rbl_pct = nullif(p_exam ->> 'dx_rbl_pct', '')::smallint,
           dx_teeth_lost_perio = nullif(p_exam ->> 'dx_teeth_lost_perio', '')::smallint, dx_note = nullif(btrim(p_exam ->> 'dx_note'), '')
     where id = v_id and patient_id = p_patient and record_status = 'active';
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;

  perform app.perio_teeth_write(p_patient, v_id, p_teeth);

  if p_finalize then
    select count(*) into v_n from public.perio_teeth where exam_id = v_id and (missing or pd is not null);
    if v_n = 0 then raise exception 'exam_empty' using errcode = '22023'; end if;
    update public.perio_exams set status = 'final' where id = v_id and status = 'draft';
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- 5. the link: read
-- Final charts inside the share's date range, and this clinician's own open draft, with their teeth; the factors the
-- grade suggestion needs (age, tobacco, diabetes and — only when the link shares observations — the latest HbA1c).
create function public.share_perio(p_session_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_share uuid; v_sid uuid; v_st text;
  s public.medical_shares;
  v_from date; v_to date; v_ctr uuid; v_dob date;
begin
  select a.o_share_id, a.o_session_id, a.o_status into v_share, v_sid, v_st from app.resolve_share_session(p_session_token) a;
  if v_st <> 'ok' then return jsonb_build_object('status', 'expired'); end if;
  select * into s from public.medical_shares where id = v_share;
  if not app.share_covers_dentistry(s)
     or not ('specialty_records' = any (s.include) or (s.allow_contribute and 'perio_exams' = any (s.contribute_modules))) then
    return jsonb_build_object('status', 'none');
  end if;
  select id into v_ctr from public.share_contributors where session_id = v_sid;
  v_from := coalesce(s.date_from, '-infinity'::date);
  v_to := coalesce(s.date_to, 'infinity'::date);
  select p.date_of_birth into v_dob from public.patients p where p.id = s.patient_id;
  return jsonb_build_object(
    'status', 'ok',
    'can_add', s.allow_contribute and 'perio_exams' = any (s.contribute_modules),
    'contributor_id', v_ctr,
    'exams', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'exam_date', e.exam_date, 'status', e.status, 'examiner_name', e.examiner_name, 'facility_name', e.facility_name,
        'notes', e.notes, 'source', e.source, 'source_detail', e.source_detail, 'verification', e.verification,
        'contributed_by', e.contributed_by, 'encounter_id', e.encounter_id, 'finalized_at', e.finalized_at,
        'dx_kind', e.dx_kind, 'dx_stage', e.dx_stage, 'dx_grade', e.dx_grade, 'dx_extent', e.dx_extent, 'dx_rbl_pct', e.dx_rbl_pct,
        'dx_teeth_lost_perio', e.dx_teeth_lost_perio, 'dx_note', e.dx_note,
        'teeth', coalesce((select jsonb_agg(jsonb_build_object(
            'tooth', t.tooth, 'missing', t.missing, 'implant', t.implant, 'mobility', t.mobility,
            'furcation_b', t.furcation_b, 'furcation_l', t.furcation_l, 'furcation_m', t.furcation_m, 'furcation_d', t.furcation_d,
            'pd', to_jsonb(t.pd), 'gm', to_jsonb(t.gm), 'bop', to_jsonb(t.bop), 'plaque', to_jsonb(t.plaque),
            'suppuration', to_jsonb(t.suppuration), 'cal', to_jsonb(t.cal), 'note', t.note) order by t.tooth)
          from public.perio_teeth t where t.exam_id = e.id), '[]'))
        order by e.exam_date desc, e.recorded_at desc)
      from public.perio_exams e
      where e.patient_id = s.patient_id and e.record_status = 'active'
        and ((e.status = 'final' and e.exam_date between v_from and v_to)
             or (e.status = 'draft' and v_ctr is not null and e.contributed_by = v_ctr))), '[]'),
    'factors', jsonb_build_object(
      'date_of_birth', v_dob,
      'tobacco_status', (select h.tobacco_status from public.patient_health_profile h where h.patient_id = s.patient_id),
      'cigarettes_per_day', (select h.cigarettes_per_day from public.patient_health_profile h where h.patient_id = s.patient_id),
      'waterpipe_per_week', (select h.waterpipe_per_week from public.patient_health_profile h where h.patient_id = s.patient_id),
      'diabetes', exists (select 1 from public.conditions c
                           where c.patient_id = s.patient_id and c.record_status = 'active' and c.certainty <> 'refuted'
                             and c.clinical_status in ('active', 'recurrence') and (not c.sensitive or s.include_sensitive)
                             and (c.icd10_code ~* '^E1[0-4]' or c.name ~* '(diabet|سكر)')),
      'hba1c', case when 'observations' = any (s.include) then
        (select jsonb_build_object('value', o.value_num, 'at', o.effective_at)
           from public.observations o join public.observation_types ty on ty.id = o.type_id
          where o.patient_id = s.patient_id and ty.code = 'hba1c' and o.status in ('final', 'preliminary', 'amended') and o.value_num is not null
            and o.effective_at::date <= v_to
          order by o.effective_at desc limit 1) end));
end $$;

-- ---------------------------------------------------------------- 5b. the link: write
-- The doctor charts through the link: a draft of their own (one open at a time) which they save as often as they like and
-- finalise once. The chart carries their name (examiner), source 'clinic', and counts as ONE addition however often it is saved.
create function public.share_perio_save(p_session_token text, p_exam_id uuid, p_exam jsonb, p_teeth jsonb, p_finalize boolean default false,
                                        p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c record; v_used int; v_name text; v_who text; v_facility text; v_id uuid; v_date date; v_enc uuid; v_n int; v_new boolean := false;
  v_pat uuid;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  if not ('perio_exams' = any ((c.o_share).contribute_modules)) or not app.share_covers_dentistry(c.o_share) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  v_pat := (c.o_share).patient_id;
  if jsonb_typeof(coalesce(p_exam, 'null')) <> 'object' or jsonb_typeof(coalesce(p_teeth, '[]')) <> 'array'
     or jsonb_array_length(coalesce(p_teeth, '[]')) > 60 then
    return jsonb_build_object('status', 'invalid');
  end if;

  begin
    v_date := (p_exam ->> 'exam_date')::date;
    if v_date is null or v_date > current_date + 1 then return jsonb_build_object('status', 'invalid', 'reason', 'exam_date_invalid'); end if;
    -- the visit link may only point at a visit added through this share
    v_enc := nullif(p_exam ->> 'encounter_id', '')::uuid;
    if v_enc is not null and not exists (select 1 from public.encounters e join public.share_contributors sc on sc.id = e.contributed_by
                                          where e.id = v_enc and e.patient_id = v_pat and e.record_status = 'active' and sc.share_id = (c.o_share).id) then
      return jsonb_build_object('status', 'invalid', 'reason', 'encounter_invalid');
    end if;

    select sc.full_name, left(sc.full_name || coalesce(' — ' || sc.facility, ''), 300), sc.facility into v_who, v_name, v_facility
      from public.share_contributors sc where sc.id = c.o_contributor;

    -- a doctor edits only their own open draft; with no id given, their open draft is resumed
    select e.id into v_id from public.perio_exams e
     where e.patient_id = v_pat and e.contributed_by = c.o_contributor and e.status = 'draft' and e.record_status = 'active'
       and (p_exam_id is null or e.id = p_exam_id);
    if v_id is null and p_exam_id is not null then return jsonb_build_object('status', 'not_found'); end if;

    if v_id is null then
      select coalesce(sum(contribution_count), 0) into v_used from public.share_contributors where share_id = (c.o_share).id;
      if v_used >= (c.o_share).max_contributions then return jsonb_build_object('status', 'limit'); end if;
      perform set_config('app.share_contributor', c.o_contributor::text, true);
      insert into public.perio_exams (patient_id, specialty_id, exam_date, examiner_name, facility_name, notes, source, source_detail, verification,
                                      contributed_by, encounter_id, dx_kind, dx_stage, dx_grade, dx_extent, dx_rbl_pct, dx_teeth_lost_perio, dx_note)
      values (v_pat, (select id from public.medical_specialties where code = 'dentistry'), v_date, v_who,
              coalesce(nullif(btrim(p_exam ->> 'facility_name'), ''), v_facility), nullif(btrim(p_exam ->> 'notes'), ''),
              'clinic', v_name, 'confirmed', c.o_contributor, v_enc,
              nullif(p_exam ->> 'dx_kind', ''), nullif(p_exam ->> 'dx_stage', ''), nullif(p_exam ->> 'dx_grade', ''), nullif(p_exam ->> 'dx_extent', ''),
              nullif(p_exam ->> 'dx_rbl_pct', '')::smallint, nullif(p_exam ->> 'dx_teeth_lost_perio', '')::smallint, nullif(btrim(p_exam ->> 'dx_note'), ''))
      returning id into v_id;
      v_new := true;
    else
      perform set_config('app.share_contributor', c.o_contributor::text, true);
      update public.perio_exams set exam_date = v_date, notes = nullif(btrim(p_exam ->> 'notes'), ''),
             facility_name = coalesce(nullif(btrim(p_exam ->> 'facility_name'), ''), v_facility), encounter_id = v_enc,
             dx_kind = nullif(p_exam ->> 'dx_kind', ''), dx_stage = nullif(p_exam ->> 'dx_stage', ''), dx_grade = nullif(p_exam ->> 'dx_grade', ''),
             dx_extent = nullif(p_exam ->> 'dx_extent', ''), dx_rbl_pct = nullif(p_exam ->> 'dx_rbl_pct', '')::smallint,
             dx_teeth_lost_perio = nullif(p_exam ->> 'dx_teeth_lost_perio', '')::smallint, dx_note = nullif(btrim(p_exam ->> 'dx_note'), '')
       where id = v_id;
    end if;

    perform app.perio_teeth_write(v_pat, v_id, p_teeth);

    if p_finalize then
      select count(*) into v_n from public.perio_teeth where exam_id = v_id and (missing or pd is not null);
      if v_n = 0 then raise exception 'exam_empty' using errcode = '22023'; end if;
      update public.perio_exams set status = 'final' where id = v_id and status = 'draft';
    end if;

    if v_new then
      update public.share_contributors set contribution_count = contribution_count + 1, last_contribution_at = now() where id = c.o_contributor;
      perform app.share_log((c.o_share).id, 'contribution_added', p_ip_hash, p_user_agent,
                            jsonb_build_object('contributor', c.o_contributor, 'table', 'perio_exams', 'id', v_id));
    else
      update public.share_contributors set last_contribution_at = now() where id = c.o_contributor;
    end if;
  exception
    when sqlstate '22023' or check_violation or invalid_text_representation or numeric_value_out_of_range
         or datetime_field_overflow or invalid_datetime_format then
      return jsonb_build_object('status', 'invalid', 'reason', sqlerrm);
  end;
  return jsonb_build_object('status', 'ok', 'id', v_id, 'final', coalesce(p_finalize, false));
end $$;

revoke all on function public.share_perio(text) from public, anon, authenticated;
revoke all on function public.share_perio_save(text, uuid, jsonb, jsonb, boolean, text, text) from public, anon, authenticated;
grant execute on function public.share_perio(text) to service_role;
grant execute on function public.share_perio_save(text, uuid, jsonb, jsonb, boolean, text, text) to service_role;

-- ---------------------------------------------------------------- 6. the phased periodontal plan: codes it needs
insert into public.procedure_catalog (code, category, name_ar, name_en, scope, surgical, finding_kind, material, tooth_state, resolves, sort) values
  ('perio_reevaluation', 'periodontal', 'إعادة تقييم اللثة بعد العلاج الأولي', 'Periodontal re-evaluation after initial therapy', 'mouth', false, null, null, null, '{}', 56),
  ('perio_flap_surgery', 'periodontal', 'جراحة لثوية (رفع شريحة)',            'Periodontal flap surgery',                         'teeth', true,  null, null, null, '{}', 57)
on conflict (code) do nothing;

-- ---------------------------------------------------------------- 7. withdrawal, "my additions" and the patient's bulk invalidation know the chart
create or replace function public.share_retract(p_session_token text, p_table text, p_id uuid, p_reason text, p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_ok boolean;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  if p_table not in ('encounters', 'conditions', 'procedures', 'clinical_notes', 'medications', 'appointments', 'test_orders',
                     'imaging_studies', 'medical_documents', 'dental_exams', 'treatment_plans', 'treatment_costs', 'imaging_annotations', 'perio_exams') then
    return jsonb_build_object('status', 'invalid');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('status', 'reason_required'); end if;
  perform set_config('app.share_contributor', c.o_contributor::text, true);
  execute format('update public.%I x set record_status = ''entered_in_error'', invalidated_reason = $1
                   where x.id = $2 and x.patient_id = $3 and x.record_status = ''active''
                     and x.contributed_by in (select sc.id from public.share_contributors sc where sc.share_id = $4)
                  returning true', p_table)
    into v_ok using left('سحبه الطبيب / withdrawn by the clinician: ' || btrim(p_reason), 500), p_id, (c.o_share).patient_id, (c.o_share).id;
  if not coalesce(v_ok, false) then return jsonb_build_object('status', 'not_found'); end if;
  perform app.share_log((c.o_share).id, 'contribution_retracted', p_ip_hash, p_user_agent,
                        jsonb_build_object('contributor', c.o_contributor, 'table', p_table, 'id', p_id));
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.share_contrib_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_ctr jsonb; v_items jsonb; v_encs jsonb; v_conds jsonb; v_used int;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  select to_jsonb(x) - 'ip_hash' - 'user_agent' - 'signature_path' - 'session_id' into v_ctr
    from public.share_contributors x where x.id = c.o_contributor;
  select coalesce(sum(contribution_count), 0) into v_used from public.share_contributors where share_id = (c.o_share).id;
  with mine as (
    select 'encounters' as tbl, e.id, coalesce(e.reason, e.kind) as label, e.started_at as at, e.record_status, e.contributed_by from public.encounters e
    union all select 'conditions', x.id, x.name, x.recorded_at, x.record_status, x.contributed_by from public.conditions x
    union all select 'procedures', x.id, x.name, x.recorded_at, x.record_status, x.contributed_by from public.procedures x
    union all select 'clinical_notes', x.id, coalesce(x.title, left(x.body, 80)), x.noted_at, x.record_status, x.contributed_by from public.clinical_notes x
    union all select 'medications', x.id, coalesce(x.name_generic, x.name_brand), x.recorded_at, x.record_status, x.contributed_by from public.medications x
    union all select 'appointments', x.id, coalesce(x.reason, ''), x.scheduled_at, x.record_status, x.contributed_by from public.appointments x
    union all select 'test_orders', x.id, x.name, x.recorded_at, x.record_status, x.contributed_by from public.test_orders x
    union all select 'imaging_studies', x.id, x.modality || coalesce(' — ' || x.body_site, ''), x.recorded_at, x.record_status, x.contributed_by from public.imaging_studies x
    union all select 'medical_documents', x.id, x.title, x.uploaded_at, x.record_status, x.contributed_by from public.medical_documents x
    union all select 'dental_exams', x.id, x.exam_date::text || ' · ' || x.kind, x.recorded_at, x.record_status, x.contributed_by from public.dental_exams x
    union all select 'treatment_plans', x.id, x.title, x.recorded_at, x.record_status, x.contributed_by from public.treatment_plans x
    union all select 'treatment_costs', x.id, x.amount::text || ' ' || x.currency, x.recorded_at, x.record_status, x.contributed_by from public.treatment_costs x
    union all select 'imaging_annotations', x.id, jsonb_array_length(x.shapes)::text || ' ✎', x.recorded_at, x.record_status, x.contributed_by from public.imaging_annotations x
    union all select 'perio_exams', x.id, x.exam_date::text || ' · ' || x.status, x.recorded_at, x.record_status, x.contributed_by from public.perio_exams x
  )
  select coalesce(jsonb_agg(jsonb_build_object('table', m.tbl, 'id', m.id, 'label', m.label, 'at', m.at, 'record_status', m.record_status,
                                               'by', sc.full_name, 'mine', m.contributed_by = c.o_contributor) order by m.at desc), '[]')
    into v_items
    from mine m join public.share_contributors sc on sc.id = m.contributed_by
   where sc.share_id = (c.o_share).id;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'started_at', e.started_at, 'reason', e.reason, 'kind', e.kind) order by e.started_at desc), '[]')
    into v_encs
    from public.encounters e join public.share_contributors sc on sc.id = e.contributed_by
   where sc.share_id = (c.o_share).id and e.record_status = 'active';
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'teeth', to_jsonb(k.teeth)) order by k.recorded_at desc), '[]')
    into v_conds
    from public.conditions k join public.share_contributors sc on sc.id = k.contributed_by
   where sc.share_id = (c.o_share).id and k.record_status = 'active';
  return jsonb_build_object('status', 'ok', 'patient_id', (c.o_share).patient_id, 'modules', to_jsonb((c.o_share).contribute_modules), 'max', (c.o_share).max_contributions,
                            'used', v_used, 'contributor', v_ctr, 'items', v_items, 'encounters', v_encs, 'conditions', v_conds,
                            'covers_dentistry', app.share_covers_dentistry(c.o_share));
end $$;

create or replace function public.share_invalidate_contributions(p_contributor uuid, p_reason text) returns int
language plpgsql security definer set search_path = '' as $$
declare v_patient uuid; t text; n int; v_total int := 0;
begin
  select patient_id into v_patient from public.share_contributors where id = p_contributor;
  if v_patient is null or not app.has_patient_access(v_patient, 'write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required to mark a record as entered in error' using errcode = '22023'; end if;
  -- exams and plans first: what belongs to them follows (and is counted with them)
  foreach t in array array['dental_exams', 'perio_exams', 'treatment_plans', 'treatment_costs', 'imaging_annotations', 'encounters', 'conditions', 'procedures', 'clinical_notes',
                           'medications', 'appointments', 'test_orders', 'imaging_studies', 'medical_documents'] loop
    execute format('update public.%I set record_status = ''entered_in_error'', invalidated_reason = $1
                     where contributed_by = $2 and patient_id = $3 and record_status = ''active''', t)
      using left(btrim(p_reason), 500), p_contributor, v_patient;
    get diagnostics n = row_count;
    v_total := v_total + n;
  end loop;
  update public.share_contributors set reviewed_at = now(), reviewed_by = auth.uid() where id = p_contributor;
  return v_total;
end $$;
