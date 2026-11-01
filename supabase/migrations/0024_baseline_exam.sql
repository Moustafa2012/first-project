-- ح1: the comprehensive (baseline) dental exam.
--
-- An exam now records, besides the teeth: the extraoral exam and the jaw joint, the intraoral soft tissues with the oral
-- cancer screening, the occlusion, hygiene, gums and saliva (dental_exams.sections), and pulp tests per tooth
-- (dental_pulp_tests). An exam can be marked as the baseline: the full starting picture later exams are read against.
-- Findings gain what was missing: calculus, bone loss, retained root, open contact, root resorption, cyst, sinus tract.

-- ---------------------------------------------------------------- 1. exam sections
-- the keys and values allowed; generated from src/lib/dental-exam.ts (tests/dental-exam.test.ts checks they match)
create function app.dental_section_spec() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"extraoral":{"face":["enum",["normal","swelling","asymmetry"]],"lymph_nodes":["enum",["normal","palpable","tender"]],"tmj_pain":["enum",["none","right","left","both"]],"tmj_sounds":["enum",["none","click","crepitus"]],"mouth_opening_mm":["int",5,80],"deviation":["enum",["none","right","left"]],"muscles":["enum",["normal","tender"]],"note":["text",1000]},"soft_tissue":{"lips":["enum",["normal","abnormal"]],"buccal_mucosa":["enum",["normal","abnormal"]],"tongue":["enum",["normal","abnormal"]],"floor_of_mouth":["enum",["normal","abnormal"]],"hard_palate":["enum",["normal","abnormal"]],"soft_palate":["enum",["normal","abnormal"]],"gingiva":["enum",["normal","abnormal"]],"cancer_screening":["enum",["no_suspicious","suspicious"]],"note":["text",1000]},"occlusion":{"molar_right":["enum",["I","II","III"]],"molar_left":["enum",["I","II","III"]],"incisor":["enum",["I","II_1","II_2","III"]],"overjet_mm":["int",-10,20],"overbite_mm":["int",-10,15],"crossbite":["enum",["none","anterior","posterior_right","posterior_left","posterior_both"]],"open_bite":["enum",["none","anterior","posterior"]],"crowding":["enum",["none","mild","moderate","severe"]],"spacing":["enum",["none","present"]],"midline_mm":["int",-10,10],"note":["text",1000]},"hygiene":{"plaque":["enum",["none","light","moderate","heavy"]],"calculus":["enum",["none","supragingival","subgingival","both"]],"gingiva":["enum",["healthy","gingivitis_localized","gingivitis_generalized","enlargement","recession"]],"bleeding":["enum",["none","localized","generalized"]],"saliva":["enum",["normal","reduced","thick","increased"]],"halitosis":["enum",["none","present"]],"note":["text",1000]}}'::jsonb
$$;

create function app.dental_sections_ok(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare spec jsonb := app.dental_section_spec(); s record; f record; rule jsonb; n numeric;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p) <> 'object' then return false; end if;
  for s in select key, value from jsonb_each(p) loop
    if not spec ? s.key or jsonb_typeof(s.value) <> 'object' then return false; end if;
    for f in select key, value from jsonb_each(s.value) loop
      rule := spec -> s.key -> f.key;
      if rule is null then return false; end if;
      case rule ->> 0
        when 'enum' then
          if jsonb_typeof(f.value) <> 'string' or not (rule -> 1) ? (f.value #>> '{}') then return false; end if;
        when 'int' then
          if jsonb_typeof(f.value) <> 'number' then return false; end if;
          n := (f.value #>> '{}')::numeric;
          if n <> trunc(n) or n < (rule ->> 1)::numeric or n > (rule ->> 2)::numeric then return false; end if;
        when 'text' then
          if jsonb_typeof(f.value) <> 'string' or length(f.value #>> '{}') > (rule ->> 1)::int then return false; end if;
        else return false;
      end case;
    end loop;
  end loop;
  return true;
end $$;
grant execute on function app.dental_section_spec() to authenticated, service_role;
grant execute on function app.dental_sections_ok(jsonb) to authenticated, service_role;

alter table public.dental_exams
  add column sections jsonb check (app.dental_sections_ok(sections)),
  add column is_baseline boolean not null default false;
create index dental_exams_baseline_idx on public.dental_exams (patient_id, exam_date desc) where is_baseline and record_status = 'active';

-- ---------------------------------------------------------------- 2. pulp tests (per tooth, inside an exam; never edited)
create table public.dental_pulp_tests (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  exam_id uuid not null,
  tooth smallint not null check (app.is_fdi_tooth(tooth)),
  test text not null check (test in ('cold', 'heat', 'ept', 'percussion', 'palpation', 'bite')),
  result text not null check (result in ('normal', 'no_response', 'reduced', 'exaggerated', 'lingering', 'tender')),
  value text check (length(value) <= 40),
  note text check (length(note) <= 500),
  contributed_by uuid,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references auth.users (id) default auth.uid(),
  foreign key (exam_id, patient_id) references public.dental_exams (id, patient_id),
  foreign key (contributed_by, patient_id) references public.share_contributors (id, patient_id),
  -- results that make sense for the test
  check (case test when 'percussion' then result in ('normal', 'tender') when 'palpation' then result in ('normal', 'tender')
                   when 'bite' then result in ('normal', 'tender') when 'ept' then result in ('normal', 'no_response', 'reduced', 'exaggerated')
                   else result in ('normal', 'no_response', 'reduced', 'exaggerated', 'lingering') end)
);
create index dental_pulp_tests_exam_idx on public.dental_pulp_tests (exam_id);
create index dental_pulp_tests_patient_idx on public.dental_pulp_tests (patient_id, tooth);
-- the same rules as the other rows of an exam (nothing added to an invalidated exam or to a clinician's exam from an account)
create trigger dental_pulp_tests_exam_guard before insert on public.dental_pulp_tests for each row execute function app.dental_exam_child_guard();
create trigger dental_pulp_tests_contrib_guard before insert on public.dental_pulp_tests for each row execute function app.contribution_guard();
create trigger dental_pulp_tests_audit after insert on public.dental_pulp_tests for each row execute function app.audit_row();
alter table public.dental_pulp_tests enable row level security;
create policy dental_pulp_tests_sel on public.dental_pulp_tests for select to authenticated using (app.has_patient_access(patient_id));
create policy dental_pulp_tests_ins on public.dental_pulp_tests for insert to authenticated with check (app.has_patient_access(patient_id, 'write'));
grant select, insert on public.dental_pulp_tests to authenticated;
grant all on public.dental_pulp_tests to service_role;

-- ---------------------------------------------------------------- 3. findings that were missing
alter table public.dental_findings drop constraint dental_findings_kind_check;
alter table public.dental_findings add constraint dental_findings_kind_check check (kind in (
  'caries', 'secondary_caries', 'fracture', 'crack', 'wear', 'defective_restoration', 'periapical_lesion', 'abscess',
  'recession', 'mobility', 'discoloration', 'hypoplasia',
  'calculus', 'bone_loss', 'retained_root', 'open_contact', 'root_resorption', 'cyst', 'sinus_tract',
  'filling', 'sealant', 'inlay_onlay', 'veneer', 'crown', 'bridge_abutment', 'bridge_pontic', 'root_canal', 'post_core',
  'implant', 'denture', 'ortho_appliance',
  'other'));

-- ---------------------------------------------------------------- 4. writing an exam: sections, baseline and pulp tests too
create or replace function app.dental_exam_write(p_patient uuid, p_exam jsonb, p_states jsonb, p_findings jsonb,
                                      p_specialty uuid, p_contributor uuid default null, p_source_detail text default null)
returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid; v_date date; x jsonb; v_surf text[];
  v_src text := case when p_contributor is null then coalesce(nullif(p_exam ->> 'source', ''), 'self') else 'clinic' end;
  v_detail text := case when p_contributor is null then nullif(btrim(p_exam ->> 'source_detail'), '') else p_source_detail end;
  v_ver text := case when p_contributor is null then 'reported' else 'confirmed' end;
  v_sections jsonb := case when jsonb_typeof(p_exam -> 'sections') = 'object' and p_exam -> 'sections' <> '{}'::jsonb then p_exam -> 'sections' end;
  v_pulp jsonb := case when jsonb_typeof(p_exam -> 'pulp_tests') = 'array' then p_exam -> 'pulp_tests' else '[]'::jsonb end;
begin
  if jsonb_typeof(coalesce(p_exam, 'null')) <> 'object' then raise exception 'invalid exam' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_states, '[]')) <> 'array' or jsonb_typeof(coalesce(p_findings, '[]')) <> 'array'
     or jsonb_array_length(coalesce(p_states, '[]')) > 60 or jsonb_array_length(coalesce(p_findings, '[]')) > 200
     or jsonb_array_length(v_pulp) > 200 then
    raise exception 'invalid exam' using errcode = '22023';
  end if;
  v_date := (p_exam ->> 'exam_date')::date;
  if v_date is null or v_date > current_date + 1 then raise exception 'exam_date_invalid' using errcode = '22023'; end if;
  -- an exam records something: teeth, findings, a section of the exam or a pulp test
  if jsonb_array_length(coalesce(p_states, '[]')) = 0 and jsonb_array_length(coalesce(p_findings, '[]')) = 0
     and v_sections is null and jsonb_array_length(v_pulp) = 0 then
    raise exception 'exam_empty' using errcode = '22023';
  end if;

  insert into public.dental_exams (patient_id, specialty_id, encounter_id, exam_date, kind, dentition, examiner_name, facility_name,
                                   chief_complaint, oral_hygiene, notes, source, source_detail, verification, contributed_by,
                                   sections, is_baseline)
  values (p_patient, p_specialty, nullif(p_exam ->> 'encounter_id', '')::uuid, v_date, coalesce(nullif(p_exam ->> 'kind', ''), 'comprehensive'),
          coalesce(nullif(p_exam ->> 'dentition', ''), 'permanent'), nullif(btrim(p_exam ->> 'examiner_name'), ''),
          nullif(btrim(p_exam ->> 'facility_name'), ''), nullif(btrim(p_exam ->> 'chief_complaint'), ''),
          nullif(p_exam ->> 'oral_hygiene', ''), nullif(btrim(p_exam ->> 'notes'), ''), v_src, v_detail, v_ver, p_contributor,
          v_sections, coalesce((p_exam ->> 'is_baseline')::boolean, false))
  returning id into v_id;

  for x in select * from jsonb_array_elements(coalesce(p_states, '[]')) loop
    insert into public.dental_tooth_states (patient_id, exam_id, tooth, status, note)
    values (p_patient, v_id, (x ->> 'tooth')::smallint, x ->> 'status', nullif(btrim(x ->> 'note'), ''));
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p_findings, '[]')) loop
    select coalesce(array_agg(s order by s), '{}') into v_surf from jsonb_array_elements_text(coalesce(x -> 'surfaces', '[]')) s;
    insert into public.dental_findings (patient_id, specialty_id, exam_id, condition_id, tooth, surfaces, kind, evidence, severity, material,
                                        observed_on, notes, source, source_detail, verification, contributed_by)
    values (p_patient, p_specialty, v_id, nullif(x ->> 'condition_id', '')::uuid, (x ->> 'tooth')::smallint, v_surf, x ->> 'kind',
            coalesce(nullif(x ->> 'evidence', ''), 'unknown'), nullif(x ->> 'severity', ''), nullif(x ->> 'material', ''),
            v_date, nullif(btrim(x ->> 'notes'), ''), v_src, v_detail, v_ver, p_contributor);
  end loop;

  for x in select * from jsonb_array_elements(v_pulp) loop
    insert into public.dental_pulp_tests (patient_id, exam_id, tooth, test, result, value, note, contributed_by)
    values (p_patient, v_id, (x ->> 'tooth')::smallint, x ->> 'test', x ->> 'result', nullif(btrim(x ->> 'value'), ''),
            nullif(btrim(x ->> 'note'), ''), p_contributor);
  end loop;
  return v_id;
end $$;

-- ---------------------------------------------------------------- 5. the share link: sections, baseline and pulp tests of the exams it shows
create function public.share_dental_exam_extras(p_session_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d jsonb; v_ids uuid[];
begin
  d := public.share_dental(p_session_token);
  if d ->> 'status' <> 'ok' then return jsonb_build_object('status', d ->> 'status'); end if;
  select coalesce(array_agg((e ->> 'id')::uuid), '{}') into v_ids from jsonb_array_elements(d -> 'exams') e;
  return jsonb_build_object('status', 'ok', 'exams', coalesce((select jsonb_object_agg(x.id, jsonb_build_object(
      'sections', x.sections, 'is_baseline', x.is_baseline,
      'pulp_tests', coalesce((select jsonb_agg(jsonb_build_object('tooth', p.tooth, 'test', p.test, 'result', p.result, 'value', p.value, 'note', p.note)
                                               order by p.tooth, p.test) from public.dental_pulp_tests p where p.exam_id = x.id), '[]')))
    from public.dental_exams x where x.id = any (v_ids)), '{}'));
end $$;
revoke all on function public.share_dental_exam_extras(text) from public, anon, authenticated;
grant execute on function public.share_dental_exam_extras(text) to service_role;
