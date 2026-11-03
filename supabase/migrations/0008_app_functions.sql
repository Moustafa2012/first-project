-- 0008_app_functions: atomic helpers used by the web app.

-- Registers a document whose bytes the web server already validated and stored in the private bucket.
-- Runs as definer so the row is attributed to the signed-in user (auth.uid()) in the audit trail,
-- while users still cannot insert document rows directly.
create function public.register_document(
  p_patient uuid, p_title text, p_doc_type text, p_storage_path text, p_filename text, p_mime text,
  p_size bigint, p_sha256 text,
  p_specialty uuid default null, p_description text default null, p_document_date date default null,
  p_sensitivity text default 'standard', p_encounter uuid default null, p_lab_report uuid default null,
  p_imaging uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not app.has_patient_access(p_patient, 'write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.medical_documents (patient_id, specialty_id, encounter_id, lab_report_id, imaging_id, doc_type, title,
      description, document_date, uploaded_by, sensitivity, storage_path, original_filename, mime_type, size_bytes, sha256)
  values (p_patient, p_specialty, p_encounter, p_lab_report, p_imaging, p_doc_type, btrim(p_title),
      nullif(btrim(p_description), ''), p_document_date, auth.uid(), coalesce(p_sensitivity, 'standard'), p_storage_path,
      left(p_filename, 255), p_mime, p_size, p_sha256)
  returning id into v_id;
  return v_id;
end $$;

-- Creates a lab report and all of its results in one transaction (invoker: RLS and guards apply).
-- p_report: { title, lab_name, specimen_type, collected_at, performed_at, approved_at, approved_by_name, status,
--             lab_notes, specialty_id, encounter_id }
-- p_results: [ { type_id, value_num, value_text, unit, ref_low, ref_high, ref_text, flag, notes } ]
create function public.create_lab_report(p_patient uuid, p_report jsonb, p_results jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  r jsonb;
  v_when timestamptz;
  v_flag text;
begin
  if jsonb_typeof(coalesce(p_results, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_results) = 0 then
    raise exception 'a lab report needs at least one result' using errcode = '22023';
  end if;
  if jsonb_array_length(p_results) > 200 then
    raise exception 'too many results in one report' using errcode = '22023';
  end if;
  v_when := coalesce(nullif(p_report ->> 'collected_at', '')::timestamptz, nullif(p_report ->> 'performed_at', '')::timestamptz, now());

  insert into public.lab_reports (patient_id, specialty_id, encounter_id, title, lab_name, specimen_type, collected_at,
      performed_at, approved_at, approved_by_name, status, lab_notes, source)
  values (p_patient, nullif(p_report ->> 'specialty_id', '')::uuid, nullif(p_report ->> 'encounter_id', '')::uuid,
      btrim(p_report ->> 'title'), nullif(btrim(p_report ->> 'lab_name'), ''), nullif(btrim(p_report ->> 'specimen_type'), ''),
      nullif(p_report ->> 'collected_at', '')::timestamptz, nullif(p_report ->> 'performed_at', '')::timestamptz,
      nullif(p_report ->> 'approved_at', '')::timestamptz, nullif(btrim(p_report ->> 'approved_by_name'), ''),
      coalesce(nullif(p_report ->> 'status', ''), 'final'), nullif(btrim(p_report ->> 'lab_notes'), ''), 'laboratory')
  returning id into v_id;

  for r in select * from jsonb_array_elements(p_results) loop
    v_flag := nullif(r ->> 'flag', '');
    insert into public.observations (patient_id, type_id, report_id, specialty_id, encounter_id, value_num, value_text, unit,
        effective_at, setting, ref_low, ref_high, ref_text, interpretation, notes, status, source, source_detail, custom_name)
    values (p_patient, (r ->> 'type_id')::uuid, v_id, nullif(p_report ->> 'specialty_id', '')::uuid,
        nullif(p_report ->> 'encounter_id', '')::uuid,
        nullif(r ->> 'value_num', '')::numeric, nullif(btrim(r ->> 'value_text'), ''), nullif(btrim(r ->> 'unit'), ''),
        v_when, 'lab', nullif(r ->> 'ref_low', '')::numeric, nullif(r ->> 'ref_high', '')::numeric,
        nullif(btrim(r ->> 'ref_text'), ''),
        case when v_flag in ('normal', 'low', 'high', 'critical_low', 'critical_high', 'abnormal') then v_flag else 'not_assessed' end,
        nullif(btrim(r ->> 'notes'), ''),
        case when coalesce(nullif(p_report ->> 'status', ''), 'final') = 'preliminary' then 'preliminary' else 'final' end,
        'laboratory', nullif(btrim(p_report ->> 'lab_name'), ''), nullif(btrim(r ->> 'custom_name'), ''));
  end loop;
  return v_id;
end $$;

grant execute on function public.register_document(uuid, text, text, text, text, text, bigint, text, uuid, text, date, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.create_lab_report(uuid, jsonb, jsonb) to authenticated;

-- Document rows are registered through register_document(); afterwards users may only edit descriptive
-- metadata, never the storage path, checksum, size or type of a stored file.
revoke update on public.medical_documents from authenticated;
grant update (specialty_id, encounter_id, lab_report_id, imaging_id, doc_type, title, description, document_date, sensitivity,
              record_status, invalidated_reason) on public.medical_documents to authenticated;
