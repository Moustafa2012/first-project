-- ح2 / هـ: the image as a source, and the dental images.
--
-- 1. Dental image types (periapical, bitewing, occlusal, photos, CBCT, cephalometric). A panoramic, a CBCT and a cephalometric
--    image with no teeth named is a "whole mouth" image: it shows in the dental chart and in the dental share view.
-- 2. A radiographic finding names the image it was read on (dental_findings.imaging_id).
-- 3. A structured reading of the bone level per sextant (imaging_studies.bone_levels).
-- 4. A study recorded for a requested imaging test closes the request (imaging_studies.test_order_id), as a lab report does.
-- 5. Annotations (arrows, circles, rectangles, text) kept apart from the image file: imaging_annotations.
-- 6. A clinician through a share can attach the image file to a study, read it, link findings to it and annotate it.

-- ---------------------------------------------------------------- 1. modalities and the whole-mouth rule
alter table public.imaging_studies drop constraint imaging_studies_modality_check;
alter table public.imaging_studies add constraint imaging_studies_modality_check check (modality in
  ('xray', 'dental_xray', 'panoramic', 'periapical', 'bitewing', 'occlusal', 'intraoral_photo', 'extraoral_photo', 'cbct', 'cephalometric',
   'ct', 'mri', 'ultrasound', 'echo', 'mammography', 'fluoroscopy', 'nuclear', 'other'));

create function app.is_whole_mouth(p_modality text, p_teeth smallint[]) returns boolean
language sql immutable set search_path = '' as $$
  select p_modality in ('panoramic', 'cbct', 'cephalometric') and (p_teeth is null or cardinality(p_teeth) = 0)
$$;
grant execute on function app.is_whole_mouth(text, smallint[]) to authenticated, service_role;

-- ---------------------------------------------------------------- 2. the bone level, read per sextant
-- { "s1": { "level": "coronal_third", "pattern": "horizontal" }, ... } with s1 = 18-14, s2 = 13-23, s3 = 24-28,
-- s4 = 38-34, s5 = 33-43, s6 = 44-48; the pattern is optional (src/lib/dental-imaging.ts has the same spec and a test that
-- reads this file).
create function app.bone_levels_ok(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; kk text;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p) <> 'object' or p = '{}'::jsonb then return false; end if;
  for k, v in select key, value from jsonb_each(p) loop
    if k not in ('s1', 's2', 's3', 's4', 's5', 's6') or jsonb_typeof(v) <> 'object' then return false; end if;
    if coalesce(jsonb_typeof(v -> 'level'), '') <> 'string'
       or (v ->> 'level') not in ('none', 'coronal15', 'coronal_third', 'middle_third', 'apical_third') then return false; end if;
    if v ? 'pattern' and (jsonb_typeof(v -> 'pattern') <> 'string' or (v ->> 'pattern') not in ('horizontal', 'vertical', 'mixed')) then return false; end if;
    for kk in select jsonb_object_keys(v) loop
      if kk not in ('level', 'pattern') then return false; end if;
    end loop;
  end loop;
  return true;
end $$;
grant execute on function app.bone_levels_ok(jsonb) to authenticated, service_role;

alter table public.imaging_studies
  add column bone_levels jsonb check (app.bone_levels_ok(bone_levels)),
  add column test_order_id uuid,
  add constraint imaging_studies_test_order_fkey foreign key (test_order_id, patient_id) references public.test_orders (id, patient_id);
create index imaging_test_order_idx on public.imaging_studies (test_order_id) where test_order_id is not null;

-- a clinician adding a study through a share can give the bone reading too (the request being fulfilled is the patient's to link)
create or replace function app.contribution_columns(p_table text) returns text[]
language sql immutable as $$
  select case p_table
    when 'encounters' then array['kind', 'status', 'started_at', 'ended_at', 'facility_name', 'practitioner_name', 'reason', 'symptoms',
                                 'history_of_present_illness', 'examination', 'assessment', 'plan', 'summary', 'follow_up_date',
                                 'teeth', 'anesthesia_kind', 'anesthetic', 'materials', 'complications', 'instructions']
    when 'conditions' then array['name', 'icd10_code', 'category', 'clinical_status', 'certainty', 'severity', 'onset_date', 'date_precision',
                                 'resolved_date', 'notes', 'sensitive', 'encounter_id', 'teeth', 'evidence']
    when 'procedures' then array['kind', 'name', 'performed_on', 'date_precision', 'body_site', 'facility_name', 'operator_name', 'anesthesia',
                                 'indication', 'outcome', 'complications', 'notes', 'encounter_id', 'teeth']
    when 'clinical_notes' then array['kind', 'title', 'body', 'author_name', 'noted_at', 'encounter_id']
    when 'medications' then array['name_brand', 'name_generic', 'strength', 'form', 'dose', 'route', 'frequency', 'as_needed', 'origin', 'status',
                                  'start_date', 'date_precision', 'end_date', 'indication', 'prescriber_name', 'instructions', 'adverse_effects',
                                  'notes', 'sensitive', 'encounter_id']
    when 'appointments' then array['scheduled_at', 'status', 'facility_name', 'practitioner_name', 'reason', 'notes', 'encounter_id']
    when 'test_orders' then array['kind', 'name', 'reason', 'priority', 'status', 'ordered_by', 'requested_on', 'notes', 'encounter_id']
    when 'imaging_studies' then array['modality', 'body_site', 'performed_on', 'date_precision', 'facility_name', 'radiologist_name', 'findings',
                                      'impression', 'encounter_id', 'teeth', 'bone_levels']
    else null end
$$;


-- ---------------------------------------------------------------- writing an exam: each finding may name the image it was read on
create or replace function app.dental_exam_write(p_patient uuid, p_exam jsonb, p_states jsonb, p_findings jsonb,
                                      p_specialty uuid, p_contributor uuid default null, p_source_detail text default null)
returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid; v_date date; x jsonb; v_surf text[]; v_img uuid; v_ev text;
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
    -- the image a radiographic finding was read on: the patient's own, active, and (for a clinician) one their link shows
    v_img := nullif(x ->> 'imaging_id', '')::uuid;
    v_ev := coalesce(nullif(x ->> 'evidence', ''), 'unknown');
    if v_img is not null then
      if v_ev not in ('radiographic', 'clinical_radiographic') then raise exception 'imaging_needs_radiographic_evidence' using errcode = '22023'; end if;
      if not exists (select 1 from public.imaging_studies i where i.id = v_img and i.patient_id = p_patient and i.record_status = 'active')
         or (p_contributor is not null and not app.contributor_sees_imaging(p_contributor, v_img)) then
        raise exception 'imaging_invalid' using errcode = '22023';
      end if;
    end if;
    insert into public.dental_findings (patient_id, specialty_id, exam_id, condition_id, tooth, surfaces, kind, evidence, severity, material,
                                        observed_on, notes, source, source_detail, verification, contributed_by, imaging_id)
    values (p_patient, p_specialty, v_id, nullif(x ->> 'condition_id', '')::uuid, (x ->> 'tooth')::smallint, v_surf, x ->> 'kind',
            coalesce(nullif(x ->> 'evidence', ''), 'unknown'), nullif(x ->> 'severity', ''), nullif(x ->> 'material', ''),
            v_date, nullif(btrim(x ->> 'notes'), ''), v_src, v_detail, v_ver, p_contributor, v_img);
  end loop;

  for x in select * from jsonb_array_elements(v_pulp) loop
    insert into public.dental_pulp_tests (patient_id, exam_id, tooth, test, result, value, note, contributed_by)
    values (p_patient, v_id, (x ->> 'tooth')::smallint, x ->> 'test', x ->> 'result', nullif(btrim(x ->> 'value'), ''),
            nullif(btrim(x ->> 'note'), ''), p_contributor);
  end loop;
  return v_id;
end $$;

-- ---------------------------------------------------------------- 3. a radiographic finding names its image
alter table public.dental_findings
  add column imaging_id uuid,
  add constraint dental_findings_imaging_fkey foreign key (imaging_id, patient_id) references public.imaging_studies (id, patient_id),
  add constraint dental_findings_imaging_evidence_chk check (imaging_id is null or evidence in ('radiographic', 'clinical_radiographic'));
create index dental_findings_imaging_idx on public.dental_findings (imaging_id) where imaging_id is not null;

-- ---------------------------------------------------------------- 4. a study fulfils the test that was requested
-- Like a lab report closing the requests it answers (observations.ts), but done by the database: the request must be an open
-- imaging request of the same patient (the composite foreign key makes it the same patient), and the study becomes its result.
create function app.imaging_order_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o record;
begin
  if new.test_order_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.test_order_id is not distinct from old.test_order_id then return new; end if;
  select x.kind, x.status, x.record_status into o from public.test_orders x where x.id = new.test_order_id and x.patient_id = new.patient_id;
  if not found then return new; end if;     -- the foreign key reports it
  if o.kind <> 'imaging' or o.record_status <> 'active' or o.status not in ('suggested', 'requested') then
    raise exception 'order_not_open' using errcode = '22023', hint = 'Only an open imaging request can be fulfilled by a study.';
  end if;
  return new;
end $$;
create trigger imaging_studies_order_check before insert or update of test_order_id on public.imaging_studies
  for each row execute function app.imaging_order_check();

create function app.imaging_order_close() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.test_order_id is distinct from old.test_order_id then
    if new.test_order_id is not null and new.record_status = 'active' then
      update public.test_orders set status = 'done', done_on = coalesce(new.performed_on, current_date)
       where id = new.test_order_id and patient_id = new.patient_id and status in ('suggested', 'requested');
    end if;
  end if;
  -- the study was entered in error: the request is open again, unless another live study answers it
  if tg_op = 'UPDATE' and new.record_status = 'entered_in_error' and old.record_status = 'active' and new.test_order_id is not null
     and not exists (select 1 from public.imaging_studies y where y.test_order_id = new.test_order_id and y.patient_id = new.patient_id
                        and y.record_status = 'active' and y.id <> new.id) then
    update public.test_orders set status = 'requested', done_on = null
     where id = new.test_order_id and patient_id = new.patient_id and status = 'done' and record_status = 'active';
  end if;
  return null;
end $$;
create trigger imaging_studies_order_close after insert or update on public.imaging_studies
  for each row execute function app.imaging_order_close();

-- ---------------------------------------------------------------- what a share link shows of the images
-- a dental image the link shows: the patient's, live, in the date range, with teeth or a whole-mouth image of dentistry
create function app.dental_image_in_share(s public.medical_shares, x public.imaging_studies, p_dent uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select x.patient_id = s.patient_id and x.record_status = 'active'
     and (x.teeth is not null or (app.is_whole_mouth(x.modality, x.teeth) and (x.specialty_id = p_dent or (x.specialty_id is null and s.scope_kind = 'full'))))
     and (x.performed_on is null or x.performed_on between coalesce(s.date_from, '-infinity'::date) and coalesce(s.date_to, 'infinity'::date))
$$;

-- any imaging study the link covers (the file attached to a study may be of another specialty than dentistry)
create function app.share_sees_imaging(s public.medical_shares, x public.imaging_studies) returns boolean
language sql stable security definer set search_path = '' as $$
  select x.patient_id = s.patient_id and x.record_status = 'active'
     and (s.scope_kind = 'full' or (s.scope_kind = 'specialty' and x.specialty_id = any (s.specialty_ids)))
     and (x.performed_on is null or x.performed_on between coalesce(s.date_from, '-infinity'::date) and coalesce(s.date_to, 'infinity'::date))
$$;

-- the same document rule public.share_document applies, as a predicate (to list only files the link can open)
create function app.share_doc_visible(s public.medical_shares, d public.medical_documents) returns boolean
language sql stable security definer set search_path = '' as $$
  select 'documents' = any (s.include) and d.patient_id = s.patient_id and d.record_status = 'active'
     and (s.scope_kind <> 'specialty' or d.specialty_id = any (s.specialty_ids))
     and (d.document_date is null or d.document_date between coalesce(s.date_from, '-infinity'::date) and coalesce(s.date_to, 'infinity'::date))
     and (case when s.scope_kind = 'custom'
               then exists (select 1 from public.medical_share_items i where i.share_id = s.id and i.table_name = 'medical_documents' and i.record_id = d.id)
               else d.sensitivity <> 'restricted' end)
$$;

-- may the clinician behind this contributor link a finding to this image?
create function app.contributor_sees_imaging(p_contributor uuid, p_imaging uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.share_contributors c
      join public.medical_shares s on s.id = c.share_id
      join public.imaging_studies x on x.id = p_imaging and x.patient_id = c.patient_id
     where c.id = p_contributor
       and app.dental_image_in_share(s, x, (select id from public.medical_specialties where code = 'dentistry')))
$$;
revoke all on function app.dental_image_in_share(public.medical_shares, public.imaging_studies, uuid) from public;
revoke all on function app.share_sees_imaging(public.medical_shares, public.imaging_studies) from public;
revoke all on function app.share_doc_visible(public.medical_shares, public.medical_documents) from public;
revoke all on function app.contributor_sees_imaging(uuid, uuid) from public;
grant execute on function app.contributor_sees_imaging(uuid, uuid) to authenticated, service_role;
grant execute on function app.dental_image_in_share(public.medical_shares, public.imaging_studies, uuid) to service_role;
grant execute on function app.share_sees_imaging(public.medical_shares, public.imaging_studies) to service_role;
grant execute on function app.share_doc_visible(public.medical_shares, public.medical_documents) to service_role;

-- ---------------------------------------------------------------- 5. annotations, kept apart from the image
-- Shapes use coordinates normalised to 0-1 (fractions of the image width and height), so they follow any zoom:
--   { "type": "arrow",  "x1", "y1", "x2", "y2" }      { "type": "circle", "cx", "cy", "r" }
--   { "type": "rect",   "x", "y", "w", "h" }          { "type": "text",   "x", "y", "text" (1-200 characters) }
-- each with an optional "color" (red, yellow, green, blue, white). The image file itself is never changed.
create function app.annotation_shapes_ok(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare sh jsonb; k text; v jsonb; keys text[]; n numeric;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) not between 1 and 50 then return false; end if;
  for sh in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(sh) <> 'object' or jsonb_typeof(sh -> 'type') <> 'string' then return false; end if;
    keys := case sh ->> 'type'
      when 'arrow' then array['x1', 'y1', 'x2', 'y2']
      when 'circle' then array['cx', 'cy', 'r']
      when 'rect' then array['x', 'y', 'w', 'h']
      when 'text' then array['x', 'y', 'text']
      else null end;
    if keys is null then return false; end if;
    for k, v in select key, value from jsonb_each(sh) loop
      if k = 'type' then continue; end if;
      if k = 'color' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('red', 'yellow', 'green', 'blue', 'white') then return false; end if;
      elsif k = 'text' and sh ->> 'type' = 'text' then
        if jsonb_typeof(v) <> 'string' or length(btrim(v #>> '{}')) not between 1 and 200 then return false; end if;
      elsif k = any (keys) then
        if jsonb_typeof(v) <> 'number' then return false; end if;
        n := (v #>> '{}')::numeric;
        if n < 0 or n > 1 then return false; end if;
        if (k in ('r', 'w', 'h')) and n = 0 then return false; end if;
      else
        return false;
      end if;
    end loop;
    -- every coordinate of the type is there
    if exists (select 1 from unnest(keys) q where not sh ? q) then return false; end if;
  end loop;
  return true;
end $$;
grant execute on function app.annotation_shapes_ok(jsonb) to authenticated, service_role;

create table public.imaging_annotations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  imaging_id uuid not null,
  document_id uuid not null,
  shapes jsonb not null check (app.annotation_shapes_ok(shapes)),
  source text not null default 'self' check (source in ('self', 'clinic', 'hospital', 'laboratory', 'device', 'imported', 'other')),
  source_detail text check (source_detail is null or length(source_detail) <= 300),
  verification text not null default 'reported' check (verification in ('reported', 'confirmed', 'verified')),
  recorded_by uuid references auth.users (id) default auth.uid(),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  record_status text not null default 'active' check (record_status in ('active', 'entered_in_error')),
  invalidated_reason text,
  invalidated_at timestamptz,
  invalidated_by uuid references auth.users (id),
  contributed_by uuid,
  unique (id, patient_id),
  constraint imaging_annotations_invalid_reason_chk check (record_status = 'active' or length(btrim(coalesce(invalidated_reason, ''))) > 0),
  foreign key (imaging_id, patient_id) references public.imaging_studies (id, patient_id),
  foreign key (document_id, patient_id) references public.medical_documents (id, patient_id),
  foreign key (contributed_by, patient_id) references public.share_contributors (id, patient_id)
);
create index imaging_annotations_image_idx on public.imaging_annotations (imaging_id, document_id) where record_status = 'active';
create index imaging_annotations_patient_idx on public.imaging_annotations (patient_id);
create index imaging_annotations_contributed_idx on public.imaging_annotations (contributed_by) where contributed_by is not null;

-- an annotation is drawn on an image file of its own study, and is never edited: it is invalidated (with the reason) or replaced
create function app.imaging_annotation_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d record; v_n int;
begin
  if tg_op = 'UPDATE' then
    if new.imaging_id <> old.imaging_id or new.document_id <> old.document_id or new.shapes <> old.shapes then
      raise exception 'annotation_immutable' using errcode = '42501', hint = 'An annotation is not edited; invalidate it and draw a new one.';
    end if;
    return new;
  end if;
  select m.imaging_id, m.mime_type, m.record_status into d from public.medical_documents m where m.id = new.document_id and m.patient_id = new.patient_id;
  if not found then return new; end if;     -- the foreign key reports it
  if d.imaging_id is distinct from new.imaging_id or d.record_status <> 'active' or d.mime_type not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'annotation_target_invalid' using errcode = '22023', hint = 'Annotate an image file attached to this imaging study.';
  end if;
  if not exists (select 1 from public.imaging_studies i where i.id = new.imaging_id and i.patient_id = new.patient_id and i.record_status = 'active') then
    raise exception 'annotation_target_invalid' using errcode = '22023';
  end if;
  select count(*) into v_n from public.imaging_annotations a where a.document_id = new.document_id and a.record_status = 'active';
  if v_n >= 200 then raise exception 'annotation_limit' using errcode = '54000'; end if;
  return new;
end $$;
create trigger imaging_annotations_guard before insert or update on public.imaging_annotations for each row execute function app.clinical_guard();
create trigger imaging_annotations_target_guard before insert or update on public.imaging_annotations for each row execute function app.imaging_annotation_guard();
create trigger imaging_annotations_contrib_guard before insert or update on public.imaging_annotations for each row execute function app.contribution_guard();
create trigger imaging_annotations_audit after insert or update on public.imaging_annotations for each row execute function app.audit_row();

alter table public.imaging_annotations enable row level security;
create policy imaging_annotations_sel on public.imaging_annotations for select to authenticated using (app.has_patient_access(patient_id));
create policy imaging_annotations_ins on public.imaging_annotations for insert to authenticated with check (app.has_patient_access(patient_id, 'write'));
create policy imaging_annotations_upd on public.imaging_annotations for update to authenticated
  using (app.has_patient_access(patient_id, 'write')) with check (app.has_patient_access(patient_id, 'write'));
-- accounts add and invalidate; they never rewrite
grant select, insert on public.imaging_annotations to authenticated;
grant update (record_status, invalidated_reason) on public.imaging_annotations to authenticated;
grant all on public.imaging_annotations to service_role;

-- ---------------------------------------------------------------- the share link
-- a clinician attaches an image file to a study: the same function as before with the study as one more parameter
drop function public.share_register_document(text, text, text, text, text, text, bigint, text, text, date, text, text);
create function public.share_register_document(p_session_token text, p_title text, p_doc_type text, p_storage_path text, p_filename text,
                                               p_mime text, p_size bigint, p_sha256 text, p_description text default null,
                                               p_document_date date default null, p_ip_hash text default null, p_user_agent text default null,
                                               p_imaging uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_used int; v_name text; v_id uuid; v_img public.imaging_studies;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  if not ('medical_documents' = any ((c.o_share).contribute_modules)) then return jsonb_build_object('status', 'forbidden'); end if;
  select coalesce(sum(contribution_count), 0) into v_used from public.share_contributors where share_id = (c.o_share).id;
  if v_used >= (c.o_share).max_contributions then return jsonb_build_object('status', 'limit'); end if;
  if p_imaging is not null then
    select * into v_img from public.imaging_studies x where x.id = p_imaging;
    if not found or not app.share_sees_imaging(c.o_share, v_img) then return jsonb_build_object('status', 'invalid'); end if;
  end if;
  select left(full_name || coalesce(' — ' || facility, ''), 300) into v_name from public.share_contributors where id = c.o_contributor;
  perform set_config('app.share_contributor', c.o_contributor::text, true);
  insert into public.medical_documents (patient_id, specialty_id, doc_type, title, description, document_date, uploaded_by, sensitivity,
      storage_path, original_filename, mime_type, size_bytes, sha256, contributed_by, source, source_detail, verification, imaging_id)
  values ((c.o_share).patient_id, case when (c.o_share).scope_kind = 'specialty' then ((c.o_share).specialty_ids)[1] end, p_doc_type,
      btrim(p_title), nullif(btrim(p_description), ''), p_document_date, null, 'standard', p_storage_path, left(p_filename, 255),
      p_mime, p_size, p_sha256, c.o_contributor, 'clinic', v_name, 'confirmed', p_imaging)
  returning id into v_id;
  update public.share_contributors set contribution_count = contribution_count + 1, last_contribution_at = now() where id = c.o_contributor;
  perform app.share_log((c.o_share).id, 'contribution_added', p_ip_hash, p_user_agent,
                        jsonb_build_object('contributor', c.o_contributor, 'table', 'medical_documents', 'id', v_id));
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;
revoke all on function public.share_register_document(text, text, text, text, text, text, bigint, text, text, date, text, text, uuid) from public;
grant execute on function public.share_register_document(text, text, text, text, text, text, bigint, text, text, date, text, text, uuid) to service_role;

-- the clinician draws on an image of the patient (it counts as one addition, signed with their name)
create function public.share_add_annotation(p_session_token text, p_imaging uuid, p_document uuid, p_shapes jsonb,
                                            p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_used int; v_name text; v_id uuid; v_img public.imaging_studies; d public.medical_documents;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  if not ('imaging_studies' = any ((c.o_share).contribute_modules)) or not app.share_covers_dentistry(c.o_share) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  select coalesce(sum(contribution_count), 0) into v_used from public.share_contributors where share_id = (c.o_share).id;
  if v_used >= (c.o_share).max_contributions then return jsonb_build_object('status', 'limit'); end if;
  select * into v_img from public.imaging_studies x where x.id = p_imaging;
  if not found or not app.dental_image_in_share(c.o_share, v_img, (select id from public.medical_specialties where code = 'dentistry')) then
    return jsonb_build_object('status', 'not_found');
  end if;
  -- only an image file the link can open (the same rule as the document route), attached to this study
  select * into d from public.medical_documents m where m.id = p_document and m.imaging_id = p_imaging;
  if not found or not app.share_doc_visible(c.o_share, d) or d.mime_type not in ('image/jpeg', 'image/png', 'image/webp') then
    return jsonb_build_object('status', 'not_found');
  end if;
  if not app.annotation_shapes_ok(p_shapes) then return jsonb_build_object('status', 'invalid'); end if;
  select left(full_name || coalesce(' — ' || facility, ''), 300) into v_name from public.share_contributors where id = c.o_contributor;
  perform set_config('app.share_contributor', c.o_contributor::text, true);
  insert into public.imaging_annotations (patient_id, imaging_id, document_id, shapes, source, source_detail, verification, contributed_by)
  values ((c.o_share).patient_id, p_imaging, p_document, p_shapes, 'clinic', v_name, 'confirmed', c.o_contributor)
  returning id into v_id;
  update public.share_contributors set contribution_count = contribution_count + 1, last_contribution_at = now() where id = c.o_contributor;
  perform app.share_log((c.o_share).id, 'contribution_added', p_ip_hash, p_user_agent,
                        jsonb_build_object('contributor', c.o_contributor, 'table', 'imaging_annotations', 'id', v_id));
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;
revoke all on function public.share_add_annotation(text, uuid, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.share_add_annotation(text, uuid, uuid, jsonb, text, text) to service_role;

-- the dental view's images in more detail: the reading, the files of each study (only those the link can open), the annotations
-- on them, and the image each radiographic finding was read on
create function public.share_dental_imaging_extras(p_session_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d jsonb; s public.medical_shares; v_share uuid; v_sid uuid; v_st text; v_ids uuid[]; v_ctr uuid; v_fids uuid[];
begin
  d := public.share_dental(p_session_token);
  if d ->> 'status' <> 'ok' then return jsonb_build_object('status', d ->> 'status'); end if;
  select a.o_share_id, a.o_session_id, a.o_status into v_share, v_sid, v_st from app.resolve_share_session(p_session_token) a;
  select * into s from public.medical_shares where id = v_share;
  select id into v_ctr from public.share_contributors where session_id = v_sid;
  select coalesce(array_agg((e ->> 'id')::uuid), '{}') into v_ids from jsonb_array_elements(d -> 'imaging') e;
  select coalesce(array_agg((e ->> 'id')::uuid), '{}') into v_fids from jsonb_array_elements(d -> 'findings') e;
  return jsonb_build_object('status', 'ok',
    'images', coalesce((select jsonb_object_agg(x.id, jsonb_build_object(
        'findings', x.findings, 'bone_levels', x.bone_levels,
        'documents', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'mime_type', m.mime_type) order by m.uploaded_at)
                                 from public.medical_documents m
                                where m.imaging_id = x.id and m.patient_id = s.patient_id and m.mime_type in ('image/jpeg', 'image/png', 'image/webp')
                                  and app.share_doc_visible(s, m)), '[]')))
      from public.imaging_studies x where x.id = any (v_ids)), '{}'),
    'annotations', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'imaging_id', a.imaging_id, 'document_id', a.document_id, 'shapes', a.shapes,
                                                                 'by', a.source_detail, 'mine', v_ctr is not null and a.contributed_by = v_ctr,
                                                                 'recorded_at', a.recorded_at) order by a.recorded_at)
                               from public.imaging_annotations a join public.medical_documents m on m.id = a.document_id
                              where a.imaging_id = any (v_ids) and a.patient_id = s.patient_id and a.record_status = 'active'
                                and m.record_status = 'active' and app.share_doc_visible(s, m)), '[]'),
    'finding_images', coalesce((select jsonb_object_agg(f.id, f.imaging_id) from public.dental_findings f
                                 where f.id = any (v_fids) and f.imaging_id = any (v_ids)), '{}'));
end $$;
revoke all on function public.share_dental_imaging_extras(text) from public, anon, authenticated;
grant execute on function public.share_dental_imaging_extras(text) to service_role;

-- the whole-mouth images and images with teeth, with the same date and scope rules as before
create or replace function public.share_dental(p_session_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_share uuid; v_sid uuid; v_st text;
  s public.medical_shares;
  v_from date; v_to date;
  v_dent uuid; v_ctr uuid;
begin
  select a.o_share_id, a.o_session_id, a.o_status into v_share, v_sid, v_st from app.resolve_share_session(p_session_token) a;
  if v_st <> 'ok' then return jsonb_build_object('status', 'expired'); end if;
  select * into s from public.medical_shares where id = v_share;
  if not app.share_covers_dentistry(s)
     or not ('specialty_records' = any (s.include)
             or (s.allow_contribute and ('dental_exams' = any (s.contribute_modules) or 'treatment_plans' = any (s.contribute_modules)))) then
    return jsonb_build_object('status', 'none');
  end if;
  select id into v_dent from public.medical_specialties where code = 'dentistry';
  select id into v_ctr from public.share_contributors where session_id = v_sid;
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
        'clinical_status', c.clinical_status, 'onset_date', c.onset_date, 'date_precision', c.date_precision, 'resolved_date', c.resolved_date,
        'contributed_by', c.contributed_by)
        order by c.onset_date desc nulls last)
      from public.conditions c
      where c.patient_id = s.patient_id and c.record_status = 'active' and (c.teeth is not null or c.specialty_id = v_dent)
        and (not c.sensitive or s.include_sensitive)), '[]'),
    'procedures', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'name', x.name, 'kind', x.kind, 'teeth', to_jsonb(x.teeth), 'performed_on', x.performed_on, 'date_precision', x.date_precision,
        'operator_name', x.operator_name, 'facility_name', x.facility_name, 'outcome', x.outcome, 'contributed_by', x.contributed_by)
        order by x.performed_on desc nulls last)
      from public.procedures x
      where x.patient_id = s.patient_id and x.record_status = 'active' and x.teeth is not null
        and (x.performed_on is null or x.performed_on between v_from and v_to)), '[]'),
    'imaging', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'modality', x.modality, 'body_site', x.body_site, 'teeth', to_jsonb(x.teeth), 'performed_on', x.performed_on,
        'date_precision', x.date_precision, 'impression', x.impression, 'contributed_by', x.contributed_by)
        order by x.performed_on desc nulls last)
      from public.imaging_studies x
      where x.patient_id = s.patient_id and x.record_status = 'active' and (x.teeth is not null or (app.is_whole_mouth(x.modality, x.teeth)
             and (x.specialty_id = v_dent or (x.specialty_id is null and s.scope_kind = 'full'))))
        and (x.performed_on is null or x.performed_on between v_from and v_to)), '[]'),
    -- plans that are still current (no superseded versions, nothing invalidated); costs are never included here
    'plans', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'title', p.title, 'status', p.status, 'version', p.version, 'group_id', p.group_id, 'alternative_of', p.alternative_of,
        'presented_by', p.presented_by, 'presented_on', p.presented_on, 'accepted_on', p.accepted_on, 'notes', p.notes,
        'contributed_by', p.contributed_by, 'recorded_at', p.recorded_at,
        'items', coalesce((select jsonb_agg(jsonb_build_object(
            'id', i.id, 'catalog_code', i.catalog_code, 'name', i.name, 'teeth', to_jsonb(i.teeth), 'surfaces', to_jsonb(i.surfaces),
            'condition_id', i.condition_id, 'phase', i.phase, 'status', i.status, 'surgical', i.surgical, 'scheduled_for', i.scheduled_for,
            'completed_on', i.completed_on, 'status_reason', i.status_reason, 'notes', i.notes, 'contributed_by', i.contributed_by)
            order by i.phase, i.sort)
          from public.treatment_items i where i.plan_id = p.id and i.record_status = 'active'), '[]'))
        order by p.recorded_at desc)
      from public.treatment_plans p
      where p.patient_id = s.patient_id and p.record_status = 'active' and p.status <> 'superseded'), '[]'),
    'my_costs', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'item_id', k.item_id, 'amount', k.amount, 'currency', k.currency,
                                                              'kind', k.kind, 'note', k.note) order by k.recorded_at)
      from public.treatment_costs k
      where v_ctr is not null and k.contributed_by = v_ctr and k.patient_id = s.patient_id and k.record_status = 'active'), '[]'));
end $$;


-- withdrawal, the clinician's own list and the patient's "invalidate everything this clinician added" know the annotations
create or replace function public.share_retract(p_session_token text, p_table text, p_id uuid, p_reason text, p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_ok boolean;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  if p_table not in ('encounters', 'conditions', 'procedures', 'clinical_notes', 'medications', 'appointments', 'test_orders',
                     'imaging_studies', 'medical_documents', 'dental_exams', 'treatment_plans', 'treatment_costs', 'imaging_annotations') then
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
  foreach t in array array['dental_exams', 'treatment_plans', 'treatment_costs', 'imaging_annotations', 'encounters', 'conditions', 'procedures', 'clinical_notes',
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

