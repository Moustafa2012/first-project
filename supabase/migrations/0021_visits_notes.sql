-- 0021: the visit and the notes.
--
-- 1. A dental visit records what was done in the chair: the teeth, the anaesthesia (kind, agent and amount), the
--    materials, complications and the instructions given.
-- 2. Notes are signed: a draft can be edited; once signed its text is fixed, and any later change is an amendment
--    (with its reason, who and when) that is added next to the original, never over it. A clinician's note added
--    through a share is signed with their name from the start; only they can amend it, through the share.
-- 3. Note templates: a small shared catalogue (dentistry) and each user's own.
-- 4. Recalls: the periodic check-up, cleaning, X-rays…, with an interval and a due date that moves forward on its
--    own when the matching exam or treatment is recorded.

-- ---------------------------------------------------------------- 1. the dental visit
alter table public.encounters
  add column teeth smallint[] check (app.valid_teeth(teeth)),
  add column anesthesia_kind text check (anesthesia_kind in
    ('none', 'topical', 'local_infiltration', 'nerve_block', 'intraligamentary', 'nitrous_oxide', 'sedation_oral', 'sedation_iv', 'general')),
  add column anesthetic text check (length(anesthetic) <= 300),
  add column materials text check (length(materials) <= 1000),
  add column complications text check (length(complications) <= 2000),
  add column instructions text check (length(instructions) <= 4000);
create index encounters_teeth_idx on public.encounters using gin (teeth) where teeth is not null;

-- a clinician adding a visit through a share records the same details
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
                                      'impression', 'encounter_id', 'teeth']
    else null end
$$;

-- ---------------------------------------------------------------- 2. signed notes and amendments
alter table public.clinical_notes
  add column status text not null default 'draft' check (status in ('draft', 'signed')),
  add column signed_at timestamptz,
  add column signed_by uuid references auth.users (id),
  add column signed_name text check (length(signed_name) <= 200),
  add column template_code text check (length(template_code) <= 60),
  add constraint clinical_notes_signed_chk check (status = 'draft' or signed_at is not null);

-- notes already written by clinicians through a share were theirs from the start: they count as signed by them
update public.clinical_notes n set status = 'signed', signed_at = n.recorded_at,
       signed_name = (select left(sc.full_name, 200) from public.share_contributors sc where sc.id = n.contributed_by)
 where n.contributed_by is not null;

create function app.note_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if tg_op = 'INSERT' then
    if new.contributed_by is not null then
      -- a clinician's note through a share: signed with their name now
      new.status := 'signed'; new.signed_at := now(); new.signed_by := null;
      select left(full_name, 200) into new.signed_name from public.share_contributors where id = new.contributed_by;
    elsif new.status = 'signed' then
      new.signed_at := now(); new.signed_by := auth.uid();
      select left(nullif(btrim(full_name), ''), 200) into v_name from public.profiles where id = auth.uid();
      new.signed_name := coalesce(v_name, new.signed_name);
    else
      new.signed_at := null; new.signed_by := null; new.signed_name := null;
    end if;
    return new;
  end if;
  if old.status = 'signed' then
    if new.status <> 'signed' or new.signed_at is distinct from old.signed_at or new.signed_by is distinct from old.signed_by
       or new.signed_name is distinct from old.signed_name or new.body <> old.body or new.title is distinct from old.title
       or new.kind <> old.kind or new.noted_at <> old.noted_at or new.author_name is distinct from old.author_name
       or new.encounter_id is distinct from old.encounter_id or new.specialty_id is distinct from old.specialty_id then
      raise exception 'note_signed' using errcode = '42501', hint = 'A signed note is not edited; add an amendment with its reason.';
    end if;
  elsif new.status = 'signed' then
    -- signing a draft: who and when are set here, not by the client
    new.signed_at := now(); new.signed_by := auth.uid();
    select left(nullif(btrim(full_name), ''), 200) into v_name from public.profiles where id = auth.uid();
    new.signed_name := v_name;
  elsif new.signed_at is not null or new.signed_name is not null then
    new.signed_at := null; new.signed_by := null; new.signed_name := null;
  end if;
  return new;
end $$;
create trigger clinical_notes_sign_guard before insert or update on public.clinical_notes for each row execute function app.note_guard();

create table public.note_amendments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  note_id uuid not null,
  body text not null check (length(btrim(body)) between 1 and 20000),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  amended_at timestamptz not null default now(),
  amended_by uuid references auth.users (id) default auth.uid(),
  amended_name text check (length(amended_name) <= 200),
  contributed_by uuid,
  foreign key (note_id, patient_id) references public.clinical_notes (id, patient_id),
  foreign key (contributed_by, patient_id) references public.share_contributors (id, patient_id)
);
create index note_amendments_note_idx on public.note_amendments (note_id, amended_at);

-- an amendment belongs to a signed, valid note; a clinician's note is amended only by that clinician (through the share)
create function app.note_amendment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n record;
begin
  select x.status, x.record_status, x.contributed_by into n from public.clinical_notes x where x.id = new.note_id and x.patient_id = new.patient_id;
  if not found then return new; end if;   -- the foreign key reports it
  if n.status <> 'signed' then raise exception 'note_not_signed' using errcode = '22023', hint = 'A draft is edited directly.'; end if;
  if n.record_status <> 'active' then raise exception 'the note was marked entered in error' using errcode = '22023'; end if;
  if auth.uid() is not null then
    if n.contributed_by is not null then
      raise exception 'contributed_record_readonly' using errcode = '42501', hint = 'Only the clinician who wrote it can amend it.';
    end if;
    if new.contributed_by is not null then raise exception 'contributed_by is set by the share functions only' using errcode = '42501'; end if;
    new.amended_by := auth.uid();
    select left(nullif(btrim(full_name), ''), 200) into new.amended_name from public.profiles where id = auth.uid();
  else
    new.amended_by := null;
    if new.contributed_by is not null then
      if new.contributed_by is distinct from n.contributed_by then raise exception 'not_your_note' using errcode = '42501'; end if;
      select left(full_name, 200) into new.amended_name from public.share_contributors where id = new.contributed_by;
    end if;
  end if;
  new.amended_at := now();
  return new;
end $$;
create trigger note_amendments_guard before insert on public.note_amendments for each row execute function app.note_amendment_guard();
create trigger note_amendments_audit after insert on public.note_amendments for each row execute function app.audit_row();

alter table public.note_amendments enable row level security;
create policy note_amendments_sel on public.note_amendments for select to authenticated using (app.has_patient_access(patient_id));
create policy note_amendments_ins on public.note_amendments for insert to authenticated with check (app.has_patient_access(patient_id, 'write'));
-- no update and no delete: an amendment is kept as written
grant select, insert on public.note_amendments to authenticated;
grant all on public.note_amendments to service_role;

-- ---------------------------------------------------------------- 3. note templates
create table public.note_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete cascade default auth.uid(),   -- null: the shared catalogue
  code text unique check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  lang text not null default 'ar' check (lang in ('ar', 'en')),
  specialty_code text,
  kind text not null default 'progress' check (kind in ('progress', 'consult', 'nursing', 'patient_note', 'other')),
  title text not null check (length(btrim(title)) between 2 and 120),
  body text not null check (length(btrim(body)) between 1 and 8000),
  sort int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index note_templates_owner_idx on public.note_templates (owner_id);
alter table public.note_templates enable row level security;
create policy note_templates_sel on public.note_templates for select to authenticated using (owner_id is null or owner_id = auth.uid());
create policy note_templates_ins on public.note_templates for insert to authenticated
  with check (owner_id = auth.uid() or (owner_id is null and app.is_admin()));
create policy note_templates_upd on public.note_templates for update to authenticated
  using (owner_id = auth.uid() or (owner_id is null and app.is_admin())) with check (owner_id = auth.uid() or (owner_id is null and app.is_admin()));
create policy note_templates_del on public.note_templates for delete to authenticated using (owner_id = auth.uid());
grant select, insert, update, delete on public.note_templates to authenticated;
grant all on public.note_templates to service_role;

insert into public.note_templates (owner_id, code, lang, specialty_code, kind, title, body, sort) values
  (null, 'soap_ar', 'ar', null, 'progress', 'ملاحظة SOAP',
   E'الشكوى (S):\n\nالفحص (O):\n\nالتقييم (A):\n\nالخطة (P):\n', 10),
  (null, 'soap_en', 'en', null, 'progress', 'SOAP note',
   E'Subjective:\n\nObjective:\n\nAssessment:\n\nPlan:\n', 10),
  (null, 'dental_filling_ar', 'ar', 'dentistry', 'progress', 'زيارة حشوة',
   E'السن والأسطح:\nالتخدير:\nالعزل: حاجز مطاطي / لفائف قطنية\nإزالة التسوس: \nالمادة واللون:\nفحص الإطباق: \nالتعليمات: تجنّب الأكل حتى يزول التخدير.\n', 20),
  (null, 'dental_filling_en', 'en', 'dentistry', 'progress', 'Filling visit',
   E'Tooth and surfaces:\nAnaesthesia:\nIsolation: rubber dam / cotton rolls\nCaries removal:\nMaterial and shade:\nOcclusion checked:\nInstructions: avoid eating until the numbness wears off.\n', 20),
  (null, 'dental_extraction_ar', 'ar', 'dentistry', 'progress', 'خلع وتعليمات ما بعده',
   E'السن:\nالسبب:\nالتخدير:\nطريقة الخلع: بسيط / جراحي\nالنزف والإرقاء:\nالغرز:\nالتعليمات: عض الشاش 30 دقيقة، لا مضمضة ولا شفّاط 24 ساعة، أكل لين وبارد، لا تدخين.\nالأدوية الموصوفة:\nالمراجعة:\n', 30),
  (null, 'dental_extraction_en', 'en', 'dentistry', 'progress', 'Extraction and aftercare',
   E'Tooth:\nReason:\nAnaesthesia:\nTechnique: simple / surgical\nBleeding and haemostasis:\nSutures:\nInstructions: bite on gauze 30 min, no rinsing or straws for 24 h, soft cold food, no smoking.\nMedication prescribed:\nReview:\n', 30),
  (null, 'dental_rct_ar', 'ar', 'dentistry', 'progress', 'زيارة علاج عصب',
   E'السن:\nالتشخيص اللبي وحول الذروي:\nالتخدير:\nالعزل:\nعدد القنوات وأطوالها:\nالتحضير والإرواء:\nالدواء داخل القناة / الحشو:\nالترميم المؤقت:\nالزيارة التالية:\n', 40),
  (null, 'dental_rct_en', 'en', 'dentistry', 'progress', 'Root canal visit',
   E'Tooth:\nPulpal and periapical diagnosis:\nAnaesthesia:\nIsolation:\nCanals and working lengths:\nPreparation and irrigation:\nIntracanal medicament / obturation:\nTemporary restoration:\nNext visit:\n', 40),
  (null, 'dental_hygiene_ar', 'ar', 'dentistry', 'progress', 'تنظيف وصحة الفم',
   E'البلاك والجير:\nنزف اللثة:\nالتنظيف المُجرى:\nالتلميع / الفلورايد:\nتعليمات العناية:\nالفحص الدوري التالي:\n', 50),
  (null, 'dental_hygiene_en', 'en', 'dentistry', 'progress', 'Cleaning and oral hygiene',
   E'Plaque and calculus:\nGingival bleeding:\nCleaning performed:\nPolishing / fluoride:\nHome-care advice:\nNext recall:\n', 50),
  (null, 'dental_emergency_ar', 'ar', 'dentistry', 'progress', 'زيارة طارئة (ألم)',
   E'الشكوى ومدتها:\nطبيعة الألم (تلقائي، بالحرارة، بالعض، ليلي):\nالتورم / الحمى:\nالفحص والاختبارات:\nالأشعة:\nالتشخيص:\nالإجراء الإسعافي:\nالأدوية:\nالخطة:\n', 60),
  (null, 'dental_emergency_en', 'en', 'dentistry', 'progress', 'Emergency visit (pain)',
   E'Complaint and duration:\nPain (spontaneous, thermal, on biting, at night):\nSwelling / fever:\nExamination and tests:\nX-rays:\nDiagnosis:\nEmergency treatment:\nMedication:\nPlan:\n', 60);

-- ---------------------------------------------------------------- 4. recalls
create table public.recalls (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  kind text not null check (kind in ('dental_checkup', 'dental_cleaning', 'dental_xray', 'perio_maintenance', 'ortho_review', 'other')),
  label text check (length(label) <= 120),
  interval_months smallint not null check (interval_months between 1 and 60),
  due_on date not null,
  last_done_on date,
  status text not null default 'active' check (status in ('active', 'paused', 'stopped')),
  notes text check (length(notes) <= 1000),
  unique (id, patient_id),
  check (kind <> 'other' or length(btrim(coalesce(label, ''))) >= 2)
);
create index recalls_patient_idx on public.recalls (patient_id, status, due_on);
do $$
begin
  execute 'alter table public.recalls
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
    add constraint recalls_invalid_reason_chk check (record_status = ''active'' or length(btrim(coalesce(invalidated_reason, ''''))) > 0)';
end $$;
create trigger recalls_guard before insert or update on public.recalls for each row execute function app.clinical_guard();
create trigger recalls_audit after insert or update on public.recalls for each row execute function app.audit_row();
alter table public.recalls enable row level security;
create policy recalls_sel on public.recalls for select to authenticated using (app.has_patient_access(patient_id));
create policy recalls_ins on public.recalls for insert to authenticated with check (app.has_patient_access(patient_id, 'write'));
create policy recalls_upd on public.recalls for update to authenticated using (app.has_patient_access(patient_id, 'write')) with check (app.has_patient_access(patient_id, 'write'));
grant select, insert, update on public.recalls to authenticated;
grant all on public.recalls to service_role;

-- done: the next one is due one interval later (from the day it was done, never moving backwards)
create function app.recall_advance(p_patient uuid, p_kinds text[], p_date date) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.recalls r set last_done_on = p_date, due_on = (p_date + make_interval(months => r.interval_months))::date
   where r.patient_id = p_patient and r.kind = any (p_kinds) and r.status = 'active' and r.record_status = 'active'
     and (r.last_done_on is null or r.last_done_on < p_date);
  get diagnostics n = row_count;
  return n;
end $$;

create function public.recall_done(p_recall uuid, p_date date default null) returns void
language plpgsql set search_path = '' as $$
declare r public.recalls; v_date date := coalesce(p_date, current_date);
begin
  if v_date > current_date + 1 then raise exception 'date_in_future' using errcode = '22023'; end if;
  select * into r from public.recalls where id = p_recall and record_status = 'active';
  if not found or not app.has_patient_access(r.patient_id, 'write') then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.recalls set last_done_on = v_date, due_on = (v_date + make_interval(months => interval_months))::date where id = p_recall;
end $$;
revoke all on function public.recall_done(uuid, date) from public, anon;
grant execute on function public.recall_done(uuid, date) to authenticated;

-- a recorded check-up advances the check-up recall; completed treatments advance theirs
create function app.recall_from_exam() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind in ('comprehensive', 'periodic') and new.record_status = 'active' then
    perform app.recall_advance(new.patient_id, array['dental_checkup'], new.exam_date);
  end if;
  return null;
end $$;
create trigger dental_exams_recall after insert on public.dental_exams for each row execute function app.recall_from_exam();

create function app.recall_from_treatment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text[];
begin
  if new.status = 'completed' and old.status <> 'completed' and new.catalog_code is not null then
    k := case
      when new.catalog_code in ('exam_comprehensive', 'exam_periodic') then array['dental_checkup']
      when new.catalog_code in ('scaling') then array['dental_cleaning']
      when new.catalog_code in ('perio_maintenance', 'root_planing') then array['perio_maintenance']
      when new.catalog_code in ('xray_bitewing', 'xray_panoramic', 'xray_periapical') then array['dental_xray']
      else null end;
    if k is not null then perform app.recall_advance(new.patient_id, k, coalesce(new.completed_on, current_date)); end if;
  end if;
  return null;
end $$;
create trigger treatment_items_recall after update of status on public.treatment_items for each row execute function app.recall_from_treatment();

-- ---------------------------------------------------------------- the share: the dentist amends their own note; recalls are shown
create function public.share_amend_note(p_session_token text, p_note uuid, p_body text, p_reason text, p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_id uuid; n record;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  select x.patient_id, x.contributed_by, x.record_status into n from public.clinical_notes x where x.id = p_note;
  if not found or n.patient_id <> (c.o_share).patient_id or n.contributed_by is distinct from c.o_contributor or n.record_status <> 'active' then
    return jsonb_build_object('status', 'not_found');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('status', 'reason_required'); end if;
  if length(btrim(coalesce(p_body, ''))) < 1 then return jsonb_build_object('status', 'invalid'); end if;
  insert into public.note_amendments (patient_id, note_id, body, reason, contributed_by)
  values ((c.o_share).patient_id, p_note, left(p_body, 20000), left(btrim(p_reason), 500), c.o_contributor)
  returning id into v_id;
  perform app.share_log((c.o_share).id, 'contribution_added', p_ip_hash, p_user_agent,
                        jsonb_build_object('contributor', c.o_contributor, 'table', 'note_amendments', 'id', v_id));
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;
revoke all on function public.share_amend_note(text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.share_amend_note(text, uuid, text, text, text, text) to service_role;

-- the clinician's own notes with their amendments, to show and amend them in the share
create function public.share_my_notes(p_session_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' or c.o_contributor is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'body', x.body, 'noted_at', x.noted_at, 'signed_name', x.signed_name,
      'signed_at', x.signed_at, 'record_status', x.record_status,
      'amendments', coalesce((select jsonb_agg(jsonb_build_object('body', a.body, 'reason', a.reason, 'amended_at', a.amended_at, 'amended_name', a.amended_name)
                                                order by a.amended_at) from public.note_amendments a where a.note_id = x.id), '[]'))
      order by x.noted_at desc)
    from public.clinical_notes x where x.contributed_by = c.o_contributor and x.patient_id = (c.o_share).patient_id), '[]'::jsonb);
end $$;
revoke all on function public.share_my_notes(text) from public, anon, authenticated;
grant execute on function public.share_my_notes(text) to service_role;

-- recalls shown in the dentist's view (read only)
create function public.share_recalls(p_session_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_share uuid; v_sid uuid; v_st text; s public.medical_shares;
begin
  select a.o_share_id, a.o_session_id, a.o_status into v_share, v_sid, v_st from app.resolve_share_session(p_session_token) a;
  if v_st <> 'ok' then return '[]'::jsonb; end if;
  select * into s from public.medical_shares where id = v_share;
  if not app.share_covers_dentistry(s) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('kind', r.kind, 'label', r.label, 'interval_months', r.interval_months, 'due_on', r.due_on,
                                                       'last_done_on', r.last_done_on, 'status', r.status) order by r.due_on)
    from public.recalls r where r.patient_id = s.patient_id and r.record_status = 'active' and r.status <> 'stopped'
      and r.kind in ('dental_checkup', 'dental_cleaning', 'dental_xray', 'perio_maintenance', 'ortho_review')), '[]'::jsonb);
end $$;
revoke all on function public.share_recalls(text) from public, anon, authenticated;
grant execute on function public.share_recalls(text) to service_role;
