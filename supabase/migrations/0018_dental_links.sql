-- 0018: one connected dental file.
--
-- Procedures and imaging studies can name the teeth they concern (as diagnoses already can), so the chart and the
-- tooth panel show everything about a tooth: exam findings, diagnoses with their status, procedures and images.
-- The clinician's dental view (share_dental) carries the same: every dental diagnosis (with or without a tooth yet),
-- and the procedures and imaging studies linked to teeth.

alter table public.procedures add column teeth smallint[] check (app.valid_teeth(teeth));
alter table public.imaging_studies add column teeth smallint[] check (app.valid_teeth(teeth));
create index procedures_teeth_idx on public.procedures using gin (teeth) where teeth is not null;
create index imaging_teeth_idx on public.imaging_studies using gin (teeth) where teeth is not null;

-- a clinician adding a procedure or an imaging study through a dental share can name its teeth
create or replace function app.contribution_columns(p_table text) returns text[]
language sql immutable as $$
  select case p_table
    when 'encounters' then array['kind', 'status', 'started_at', 'ended_at', 'facility_name', 'practitioner_name', 'reason', 'symptoms',
                                 'history_of_present_illness', 'examination', 'assessment', 'plan', 'summary', 'follow_up_date']
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

create or replace function public.share_dental(p_session_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_share uuid; v_sid uuid; v_st text;
  s public.medical_shares;
  v_from date; v_to date;
  v_dent uuid;
begin
  select a.o_share_id, a.o_session_id, a.o_status into v_share, v_sid, v_st from app.resolve_share_session(p_session_token) a;
  if v_st <> 'ok' then return jsonb_build_object('status', 'expired'); end if;
  select * into s from public.medical_shares where id = v_share;
  if not app.share_covers_dentistry(s)
     or not ('specialty_records' = any (s.include) or (s.allow_contribute and 'dental_exams' = any (s.contribute_modules))) then
    return jsonb_build_object('status', 'none');
  end if;
  select id into v_dent from public.medical_specialties where code = 'dentistry';
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
    -- every dental diagnosis: those that name teeth, and those of the dental specialty that do not (yet)
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
      where x.patient_id = s.patient_id and x.record_status = 'active' and x.teeth is not null
        and (x.performed_on is null or x.performed_on between v_from and v_to)), '[]'));
end $$;
