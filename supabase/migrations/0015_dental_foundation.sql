-- 0015: the clinical foundation of the dental file.
--
-- * FDI numbering is checked in the database: permanent 11–48, primary 51–85.
-- * Surfaces are stored as five canonical codes (M mesial, D distal, O occlusal/incisal, B buccal/labial,
--   L lingual/palatal); the screen names them per tooth (incisal / labial on front teeth).
-- * A dental exam records the state of each tooth it looked at (present, missing, extracted, unerupted...). A tooth
--   with no row in an exam was not examined in it: absence of data is never shown as "healthy".
-- * Findings (caries, fillings, crowns, root canals, fractures...) are events on a tooth and its surfaces, dated and
--   with their evidence. The current chart is derived from them (latest tooth state + unresolved findings); nothing is
--   overwritten, so the history (filling -> root canal -> extraction) stays complete.
-- * Diagnoses stay in public.conditions (summary, share and PDF keep working) and can name the teeth they concern.
-- * A clinician with a contributing share link can record a whole exam in one step.

-- ---------------------------------------------------------------- helpers
create function app.is_fdi_tooth(p smallint) returns boolean
language sql immutable set search_path = '' as $$
  select p is not null and ((p / 10 between 1 and 4 and p % 10 between 1 and 8) or (p / 10 between 5 and 8 and p % 10 between 1 and 5))
$$;

create function app.valid_teeth(p smallint[]) returns boolean
language sql immutable set search_path = '' as $$
  select p is null or (cardinality(p) between 1 and 52
    and not exists (select 1 from unnest(p) t where not app.is_fdi_tooth(t))
    and cardinality(p) = (select count(distinct t) from unnest(p) t))
$$;

create function app.valid_surfaces(p text[]) returns boolean
language sql immutable set search_path = '' as $$
  select p is not null and p <@ array['M', 'D', 'O', 'B', 'L']::text[] and cardinality(p) = (select count(distinct s) from unnest(p) s)
$$;

grant execute on function app.is_fdi_tooth(smallint) to authenticated, service_role;
grant execute on function app.valid_teeth(smallint[]) to authenticated, service_role;
grant execute on function app.valid_surfaces(text[]) to authenticated, service_role;

-- ---------------------------------------------------------------- dental profile (one per patient)
create table public.dental_profiles (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null unique references public.patients (id) on delete restrict,
  dentition text not null default 'permanent' check (dentition in ('permanent', 'primary', 'mixed')),
  brushing text check (brushing in ('none', 'irregular', 'once', 'twice', 'more')),
  flossing text check (flossing in ('never', 'sometimes', 'daily')),
  bruxism boolean,
  dry_mouth boolean,
  dental_anxiety text check (dental_anxiety in ('none', 'mild', 'moderate', 'severe')),
  orthodontic_history text check (length(orthodontic_history) <= 1000),
  last_visit_on date,
  last_cleaning_on date,
  notes text check (length(notes) <= 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) default auth.uid()
);

create function app.touch_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.patient_id <> old.patient_id then
    raise exception 'immutable fields cannot be changed' using errcode = '42501';
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
create trigger dental_profiles_touch before insert or update on public.dental_profiles for each row execute function app.touch_row();
create trigger dental_profiles_audit after insert or update on public.dental_profiles for each row execute function app.audit_row();

-- ---------------------------------------------------------------- exams
create table public.dental_exams (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  encounter_id uuid,
  exam_date date not null,
  kind text not null default 'comprehensive' check (kind in
    ('comprehensive', 'periodic', 'limited', 'emergency', 'orthodontic', 'self_report', 'other')),
  dentition text not null default 'permanent' check (dentition in ('permanent', 'primary', 'mixed')),
  examiner_name text check (length(examiner_name) <= 200),
  facility_name text check (length(facility_name) <= 200),
  chief_complaint text check (length(chief_complaint) <= 1000),
  oral_hygiene text check (oral_hygiene in ('good', 'fair', 'poor')),
  notes text check (length(notes) <= 4000),
  unique (id, patient_id),
  foreign key (encounter_id, patient_id) references public.encounters (id, patient_id)
);
create index dental_exams_patient_idx on public.dental_exams (patient_id, exam_date desc);

-- ---------------------------------------------------------------- findings (tooth / surface level)
create table public.dental_findings (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  exam_id uuid,
  condition_id uuid,
  tooth smallint not null check (app.is_fdi_tooth(tooth)),
  surfaces text[] not null default '{}' check (app.valid_surfaces(surfaces)),
  kind text not null check (kind in (
    -- disease / damage
    'caries', 'secondary_caries', 'fracture', 'crack', 'wear', 'defective_restoration', 'periapical_lesion', 'abscess',
    'recession', 'mobility', 'discoloration', 'hypoplasia',
    -- existing work
    'filling', 'sealant', 'inlay_onlay', 'veneer', 'crown', 'bridge_abutment', 'bridge_pontic', 'root_canal', 'post_core',
    'implant', 'denture', 'ortho_appliance',
    'other')),
  evidence text not null default 'unknown' check (evidence in ('patient_reported', 'clinical', 'radiographic', 'clinical_radiographic', 'unknown')),
  severity text check (severity in ('initial', 'moderate', 'advanced')),
  material text check (material in ('amalgam', 'composite', 'glass_ionomer', 'ceramic', 'metal', 'zirconia', 'gold', 'temporary', 'other')),
  observed_on date not null,
  date_precision text not null default 'day' check (date_precision in ('day', 'month', 'year', 'approx')),
  resolved_on date,
  resolved_note text check (length(resolved_note) <= 500),
  notes text check (length(notes) <= 2000),
  unique (id, patient_id),
  foreign key (exam_id, patient_id) references public.dental_exams (id, patient_id),
  foreign key (condition_id, patient_id) references public.conditions (id, patient_id),
  check (resolved_on is null or resolved_on >= observed_on)
);
create index dental_findings_patient_idx on public.dental_findings (patient_id, tooth, observed_on desc);
create index dental_findings_exam_idx on public.dental_findings (exam_id) where exam_id is not null;

-- provenance + lifecycle, exactly as on the other clinical tables (0004), and the clinician link (0014)
do $$
declare t text;
begin
  foreach t in array array['dental_exams', 'dental_findings'] loop
    execute format('alter table public.%I
      add column source text not null default ''self'' check (source in (''self'', ''clinic'', ''hospital'', ''laboratory'', ''device'', ''imported'', ''other'')),
      add column source_detail text check (source_detail is null or length(source_detail) <= 300),
      add column verification text not null default ''reported'' check (verification in (''reported'', ''confirmed'', ''verified'')),
      add column recorded_by uuid references auth.users (id) default auth.uid(),
      add column recorded_at timestamptz not null default now(),
      add column updated_at timestamptz not null default now(),
      add column updated_by uuid references auth.users (id),
      add column record_status text not null default ''active'' check (record_status in (''active'', ''entered_in_error'')),
      add column invalidated_reason text,
      add column invalidated_at timestamptz,
      add column invalidated_by uuid references auth.users (id),
      add column contributed_by uuid,
      add constraint %I check (record_status = ''active'' or length(btrim(coalesce(invalidated_reason, ''''))) > 0),
      add constraint %I foreign key (contributed_by, patient_id) references public.share_contributors (id, patient_id)',
      t, t || '_invalid_reason_chk', t || '_contributed_by_fkey');
    execute format('create index %I on public.%I (contributed_by) where contributed_by is not null', t || '_contributed_idx', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.clinical_guard()', t || '_guard', t);
    execute format('create trigger %I after insert or update on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end $$;
create trigger dental_exams_contrib_guard before insert or update on public.dental_exams for each row execute function app.contribution_guard();
create trigger dental_findings_contrib_guard before insert or update on public.dental_findings
  for each row execute function app.contribution_guard('resolved_on', 'resolved_note');

-- ---------------------------------------------------------------- tooth state per exam
create table public.dental_tooth_states (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  exam_id uuid not null,
  tooth smallint not null check (app.is_fdi_tooth(tooth)),
  status text not null check (status in
    ('present', 'missing', 'congenitally_missing', 'extracted', 'unerupted', 'partially_erupted', 'impacted', 'not_examined')),
  note text check (length(note) <= 500),
  contributed_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) default auth.uid(),
  unique (exam_id, tooth),
  foreign key (exam_id, patient_id) references public.dental_exams (id, patient_id),
  foreign key (contributed_by, patient_id) references public.share_contributors (id, patient_id)
);
create index dental_tooth_states_patient_idx on public.dental_tooth_states (patient_id, tooth);

-- Rows that belong to an exam follow it: nothing is added to an invalidated exam, an exam a clinician recorded
-- through a share stays theirs (accounts cannot add to or change it), and the clinician link is copied from the exam.
create function app.dental_exam_child_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e record;
begin
  if new.exam_id is null then return new; end if;
  if tg_op = 'UPDATE' and (new.exam_id is distinct from old.exam_id or new.patient_id <> old.patient_id) then
    raise exception 'immutable fields cannot be changed' using errcode = '42501';
  end if;
  select x.record_status, x.contributed_by into e from public.dental_exams x where x.id = new.exam_id and x.patient_id = new.patient_id;
  if not found then return new; end if;   -- the foreign key reports it
  if tg_op = 'INSERT' and e.record_status <> 'active' then
    raise exception 'the exam was marked entered in error' using errcode = '22023';
  end if;
  if e.contributed_by is not null and auth.uid() is not null
     and (tg_op = 'INSERT' or (tg_table_name = 'dental_tooth_states')) then
    raise exception 'contributed_record_readonly' using errcode = '42501',
      hint = 'A record added by a clinician through a share can be invalidated but not edited.';
  end if;
  if tg_table_name = 'dental_tooth_states' then
    new.contributed_by := e.contributed_by;
    new.updated_at := now(); new.updated_by := auth.uid();
  end if;
  return new;
end $$;
create trigger dental_tooth_states_exam_guard before insert or update on public.dental_tooth_states
  for each row execute function app.dental_exam_child_guard();
create trigger dental_findings_exam_guard before insert or update on public.dental_findings
  for each row execute function app.dental_exam_child_guard();
create trigger dental_tooth_states_audit after insert or update on public.dental_tooth_states for each row execute function app.audit_row();

-- invalidating an exam invalidates the findings recorded in it (each keeps the reason)
create function app.dental_exam_cascade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.record_status = 'entered_in_error' and old.record_status = 'active' then
    update public.dental_findings set record_status = 'entered_in_error',
           invalidated_reason = left('أُبطل مع الفحص / invalidated with the exam: ' || coalesce(new.invalidated_reason, ''), 500)
     where exam_id = new.id and patient_id = new.patient_id and record_status = 'active';
  end if;
  return null;
end $$;
create trigger dental_exams_cascade after update of record_status on public.dental_exams for each row execute function app.dental_exam_cascade();

-- ---------------------------------------------------------------- diagnoses can name their teeth
alter table public.conditions
  add column teeth smallint[] check (app.valid_teeth(teeth)),
  add column evidence text check (evidence in ('patient_reported', 'clinical', 'radiographic', 'clinical_radiographic', 'unknown'));
create index conditions_teeth_idx on public.conditions using gin (teeth) where teeth is not null;

-- the free-text "dental finding" form is replaced by the chart (no rows were ever stored with it)
update public.specialty_record_types set is_active = false where code = 'dental_finding';

-- ---------------------------------------------------------------- access
do $$
declare t text;
begin
  foreach t in array array['dental_profiles', 'dental_exams', 'dental_findings', 'dental_tooth_states'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app.has_patient_access(patient_id))', t || '_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.has_patient_access(patient_id, ''write''))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.has_patient_access(patient_id, ''write'')) with check (app.has_patient_access(patient_id, ''write''))', t || '_upd', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- writing an exam in one step
-- Runs with the caller's rights: from an account RLS and the guards apply; from the share function below it writes
-- for the clinician. Unknown keys are ignored; the database checks every value.
create function app.dental_exam_write(p_patient uuid, p_exam jsonb, p_states jsonb, p_findings jsonb,
                                      p_specialty uuid, p_contributor uuid default null, p_source_detail text default null)
returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid; v_date date; x jsonb; v_surf text[];
  v_src text := case when p_contributor is null then coalesce(nullif(p_exam ->> 'source', ''), 'self') else 'clinic' end;
  v_detail text := case when p_contributor is null then nullif(btrim(p_exam ->> 'source_detail'), '') else p_source_detail end;
  v_ver text := case when p_contributor is null then 'reported' else 'confirmed' end;
begin
  if jsonb_typeof(coalesce(p_exam, 'null')) <> 'object' then raise exception 'invalid exam' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_states, '[]')) <> 'array' or jsonb_typeof(coalesce(p_findings, '[]')) <> 'array'
     or jsonb_array_length(coalesce(p_states, '[]')) > 60 or jsonb_array_length(coalesce(p_findings, '[]')) > 200 then
    raise exception 'invalid exam' using errcode = '22023';
  end if;
  v_date := (p_exam ->> 'exam_date')::date;
  if v_date is null or v_date > current_date + 1 then raise exception 'exam_date_invalid' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p_states, '[]')) = 0 and jsonb_array_length(coalesce(p_findings, '[]')) = 0 then
    raise exception 'exam_empty' using errcode = '22023';
  end if;

  insert into public.dental_exams (patient_id, specialty_id, encounter_id, exam_date, kind, dentition, examiner_name, facility_name,
                                   chief_complaint, oral_hygiene, notes, source, source_detail, verification, contributed_by)
  values (p_patient, p_specialty, nullif(p_exam ->> 'encounter_id', '')::uuid, v_date, coalesce(nullif(p_exam ->> 'kind', ''), 'comprehensive'),
          coalesce(nullif(p_exam ->> 'dentition', ''), 'permanent'), nullif(btrim(p_exam ->> 'examiner_name'), ''),
          nullif(btrim(p_exam ->> 'facility_name'), ''), nullif(btrim(p_exam ->> 'chief_complaint'), ''),
          nullif(p_exam ->> 'oral_hygiene', ''), nullif(btrim(p_exam ->> 'notes'), ''), v_src, v_detail, v_ver, p_contributor)
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
  return v_id;
end $$;
grant execute on function app.dental_exam_write(uuid, jsonb, jsonb, jsonb, uuid, uuid, text) to authenticated, service_role;

create function public.dental_exam_create(p_patient uuid, p_exam jsonb, p_states jsonb, p_findings jsonb) returns uuid
language plpgsql set search_path = '' as $$
begin
  if not app.has_patient_access(p_patient, 'write') then raise exception 'forbidden' using errcode = '42501'; end if;
  return app.dental_exam_write(p_patient, p_exam, p_states, p_findings,
                               (select id from public.medical_specialties where code = 'dentistry'));
end $$;
grant execute on function public.dental_exam_create(uuid, jsonb, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- the share link
alter table public.medical_shares drop constraint if exists medical_shares_contribute_modules_check;
alter table public.medical_shares add constraint medical_shares_contribute_modules_check
  check (contribute_modules <@ array['encounters', 'conditions', 'procedures', 'clinical_notes', 'medications', 'appointments',
                                     'test_orders', 'imaging_studies', 'medical_documents', 'dental_exams']::text[]);

-- does this share cover the dental file? (whole-file shares, or a specialty share that includes dentistry)
create function app.share_covers_dentistry(s public.medical_shares) returns boolean
language sql stable security definer set search_path = '' as $$
  select s.scope_kind = 'full'
      or (s.scope_kind = 'specialty' and exists (select 1 from public.medical_specialties m where m.code = 'dentistry' and m.id = any (s.specialty_ids)))
$$;

-- the dental chart for the clinician (read-only; same session checks as share_bundle, which already logs the view)
create function public.share_dental(p_session_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_share uuid; v_sid uuid; v_st text;
  s public.medical_shares;
  v_from date; v_to date;
begin
  select a.o_share_id, a.o_session_id, a.o_status into v_share, v_sid, v_st from app.resolve_share_session(p_session_token) a;
  if v_st <> 'ok' then return jsonb_build_object('status', 'expired'); end if;
  select * into s from public.medical_shares where id = v_share;
  if not app.share_covers_dentistry(s)
     or not ('specialty_records' = any (s.include) or (s.allow_contribute and 'dental_exams' = any (s.contribute_modules))) then
    return jsonb_build_object('status', 'none');
  end if;
  v_from := coalesce(s.date_from, '-infinity'::date);
  v_to := coalesce(s.date_to, 'infinity'::date);
  return jsonb_build_object(
    'status', 'ok',
    'profile', (select to_jsonb(d) - 'id' - 'patient_id' - 'updated_by' from public.dental_profiles d where d.patient_id = s.patient_id),
    'exams', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'exam_date', e.exam_date, 'kind', e.kind, 'dentition', e.dentition, 'examiner_name', e.examiner_name,
        'facility_name', e.facility_name, 'chief_complaint', e.chief_complaint, 'oral_hygiene', e.oral_hygiene, 'notes', e.notes,
        'source', e.source, 'source_detail', e.source_detail, 'verification', e.verification, 'contributed_by', e.contributed_by,
        'states', coalesce((select jsonb_agg(jsonb_build_object('tooth', t.tooth, 'status', t.status, 'note', t.note) order by t.tooth)
                              from public.dental_tooth_states t where t.exam_id = e.id), '[]'))
        order by e.exam_date desc, e.recorded_at desc)
      from public.dental_exams e
      where e.patient_id = s.patient_id and e.record_status = 'active' and e.exam_date between v_from and v_to), '[]'),
    'findings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', f.id, 'exam_id', f.exam_id, 'condition_id', f.condition_id, 'tooth', f.tooth, 'surfaces', to_jsonb(f.surfaces), 'kind', f.kind,
        'evidence', f.evidence, 'severity', f.severity, 'material', f.material, 'observed_on', f.observed_on, 'date_precision', f.date_precision,
        'resolved_on', f.resolved_on, 'resolved_note', f.resolved_note, 'notes', f.notes, 'source', f.source, 'source_detail', f.source_detail,
        'verification', f.verification, 'contributed_by', f.contributed_by)
        order by f.observed_on desc, f.recorded_at desc)
      from public.dental_findings f
      where f.patient_id = s.patient_id and f.record_status = 'active' and f.observed_on <= v_to
        and (f.resolved_on is null or f.resolved_on >= v_from)), '[]'),
    'diagnoses', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'icd10_code', c.icd10_code, 'teeth', to_jsonb(c.teeth), 'evidence', c.evidence, 'certainty', c.certainty,
        'clinical_status', c.clinical_status, 'onset_date', c.onset_date, 'date_precision', c.date_precision)
        order by c.onset_date desc nulls last)
      from public.conditions c
      where c.patient_id = s.patient_id and c.record_status = 'active' and c.teeth is not null
        and (not c.sensitive or s.include_sensitive)), '[]'));
end $$;

create function public.share_contribute_dental_exam(p_session_token text, p_exam jsonb, p_states jsonb, p_findings jsonb,
                                                    p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_used int; v_name text; v_id uuid; v_enc uuid; v_cond uuid; x jsonb;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  if not ('dental_exams' = any ((c.o_share).contribute_modules)) or not app.share_covers_dentistry(c.o_share) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  select coalesce(sum(contribution_count), 0) into v_used from public.share_contributors where share_id = (c.o_share).id;
  if v_used >= (c.o_share).max_contributions then return jsonb_build_object('status', 'limit'); end if;
  -- links may only point at what this clinician added through this share
  v_enc := nullif(p_exam ->> 'encounter_id', '')::uuid;
  if v_enc is not null and not exists (select 1 from public.encounters e join public.share_contributors sc on sc.id = e.contributed_by
                                        where e.id = v_enc and sc.share_id = (c.o_share).id) then
    return jsonb_build_object('status', 'invalid');
  end if;
  for x in select * from jsonb_array_elements(case when jsonb_typeof(p_findings) = 'array' then p_findings else '[]' end) loop
    v_cond := nullif(x ->> 'condition_id', '')::uuid;
    if v_cond is not null and not exists (select 1 from public.conditions k join public.share_contributors sc on sc.id = k.contributed_by
                                           where k.id = v_cond and sc.share_id = (c.o_share).id) then
      return jsonb_build_object('status', 'invalid');
    end if;
  end loop;
  select left(full_name || coalesce(' — ' || facility, ''), 300) into v_name from public.share_contributors where id = c.o_contributor;
  perform set_config('app.share_contributor', c.o_contributor::text, true);
  v_id := app.dental_exam_write((c.o_share).patient_id, p_exam - 'source' - 'source_detail', p_states, p_findings,
                                (select id from public.medical_specialties where code = 'dentistry'), c.o_contributor, v_name);
  update public.share_contributors set contribution_count = contribution_count + 1, last_contribution_at = now() where id = c.o_contributor;
  perform app.share_log((c.o_share).id, 'contribution_added', p_ip_hash, p_user_agent,
                        jsonb_build_object('contributor', c.o_contributor, 'table', 'dental_exams', 'id', v_id));
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

-- diagnoses added through the share can name their teeth
create or replace function app.contribution_columns(p_table text) returns text[]
language sql immutable as $$
  select case p_table
    when 'encounters' then array['kind', 'status', 'started_at', 'ended_at', 'facility_name', 'practitioner_name', 'reason', 'symptoms',
                                 'history_of_present_illness', 'examination', 'assessment', 'plan', 'summary', 'follow_up_date']
    when 'conditions' then array['name', 'icd10_code', 'category', 'clinical_status', 'certainty', 'severity', 'onset_date', 'date_precision',
                                 'resolved_date', 'notes', 'sensitive', 'encounter_id', 'teeth', 'evidence']
    when 'procedures' then array['kind', 'name', 'performed_on', 'date_precision', 'body_site', 'facility_name', 'operator_name', 'anesthesia',
                                 'indication', 'outcome', 'complications', 'notes', 'encounter_id']
    when 'clinical_notes' then array['kind', 'title', 'body', 'author_name', 'noted_at', 'encounter_id']
    when 'medications' then array['name_brand', 'name_generic', 'strength', 'form', 'dose', 'route', 'frequency', 'as_needed', 'origin', 'status',
                                  'start_date', 'date_precision', 'end_date', 'indication', 'prescriber_name', 'instructions', 'adverse_effects',
                                  'notes', 'sensitive', 'encounter_id']
    when 'appointments' then array['scheduled_at', 'status', 'facility_name', 'practitioner_name', 'reason', 'notes', 'encounter_id']
    when 'test_orders' then array['kind', 'name', 'reason', 'priority', 'status', 'ordered_by', 'requested_on', 'notes', 'encounter_id']
    when 'imaging_studies' then array['modality', 'body_site', 'performed_on', 'date_precision', 'facility_name', 'radiologist_name', 'findings',
                                      'impression', 'encounter_id']
    else null end
$$;

-- the clinician's own list now shows exams; diagnoses they added are offered for linking findings
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
  -- patient_id is for the web server (storage paths); it is never rendered
  return jsonb_build_object('status', 'ok', 'patient_id', (c.o_share).patient_id, 'modules', to_jsonb((c.o_share).contribute_modules), 'max', (c.o_share).max_contributions,
                            'used', v_used, 'contributor', v_ctr, 'items', v_items, 'encounters', v_encs, 'conditions', v_conds,
                            'covers_dentistry', app.share_covers_dentistry(c.o_share));
end $$;

create or replace function public.share_retract(p_session_token text, p_table text, p_id uuid, p_reason text, p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_ok boolean;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  if p_table not in ('encounters', 'conditions', 'procedures', 'clinical_notes', 'medications', 'appointments', 'test_orders',
                     'imaging_studies', 'medical_documents', 'dental_exams') then
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

create or replace function public.share_invalidate_contributions(p_contributor uuid, p_reason text) returns int
language plpgsql security definer set search_path = '' as $$
declare v_patient uuid; t text; n int; v_total int := 0;
begin
  select patient_id into v_patient from public.share_contributors where id = p_contributor;
  if v_patient is null or not app.has_patient_access(v_patient, 'write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required to mark a record as entered in error' using errcode = '22023'; end if;
  -- exams first: their findings follow them (and are counted with the exam)
  foreach t in array array['dental_exams', 'encounters', 'conditions', 'procedures', 'clinical_notes', 'medications', 'appointments', 'test_orders',
                           'imaging_studies', 'medical_documents'] loop
    execute format('update public.%I set record_status = ''entered_in_error'', invalidated_reason = $1
                     where contributed_by = $2 and patient_id = $3 and record_status = ''active''', t)
      using left(btrim(p_reason), 500), p_contributor, v_patient;
    get diagnostics n = row_count;
    v_total := v_total + n;
  end loop;
  update public.share_contributors set reviewed_at = now(), reviewed_by = auth.uid() where id = p_contributor;
  return v_total;
end $$;

revoke all on function public.share_dental(text) from public;
revoke all on function public.share_contribute_dental_exam(text, jsonb, jsonb, jsonb, text, text) from public;
grant execute on function public.share_dental(text) to service_role;
grant execute on function public.share_contribute_dental_exam(text, jsonb, jsonb, jsonb, text, text) to service_role;
revoke all on function app.share_covers_dentistry(public.medical_shares) from public;
