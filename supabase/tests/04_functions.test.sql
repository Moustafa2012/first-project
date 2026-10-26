\pset tuples_only on
\set alice 'a1111111-1111-1111-1111-111111111111'
\set bob 'b2222222-2222-2222-2222-222222222222'
select v as pa from test.ctx where k = 'pa' \gset
select v as pb from test.ctx where k = 'pb' \gset
select id as t_hb from public.observation_types where code = 'hemoglobin' \gset
select id as t_wbc from public.observation_types where code = 'wbc' \gset
select id as t_prot from public.observation_types where code = 'urine_protein' \gset

select test.as_user(:'alice'::uuid);

-- ---------------------------------------------------------------- create_lab_report is atomic
select public.create_lab_report(:'pa',
  jsonb_build_object('title', 'CBC panel', 'lab_name', 'Lab One', 'collected_at', (now() - interval '2 days')::text, 'status', 'final'),
  jsonb_build_array(
    jsonb_build_object('type_id', :'t_hb', 'value_num', '9.8', 'unit', 'g/dL', 'ref_low', '12', 'ref_high', '16'),
    jsonb_build_object('type_id', :'t_wbc', 'value_num', '6.1', 'unit', '10^3/µL', 'ref_low', '4', 'ref_high', '11'),
    jsonb_build_object('type_id', :'t_prot', 'value_text', 'Negative'))) as rep \gset
select test.ok((select count(*) from public.observations where report_id = :'rep') = 3, 'report and all three results were created');
select test.ok((select interpretation from public.observations where report_id = :'rep' and type_id = :'t_hb') = 'low', 'results are interpreted against the report reference range');
select test.ok((select bool_and(setting = 'lab' and source = 'laboratory') from public.observations where report_id = :'rep'), 'results are marked as laboratory results');
select test.ok((select bool_and(effective_at = (select collected_at from public.lab_reports where id = :'rep')) from public.observations where report_id = :'rep'), 'results take the sample collection time');

select test.throws(format($$select public.create_lab_report(%L, '{"title":"Bad panel"}'::jsonb, jsonb_build_array(
    jsonb_build_object('type_id', %L, 'value_num', '10', 'unit', 'g/dL'),
    jsonb_build_object('type_id', %L, 'value_num', '9999', 'unit', 'g/dL')))$$, :'pa', :'t_hb', :'t_hb'), 'plausible', 'an implausible result fails the whole report');
select test.ok(not exists (select 1 from public.lab_reports where title = 'Bad panel'), 'nothing of the failed report was kept (atomic)');
select test.throws(format($$select public.create_lab_report(%L, '{"title":"Empty"}'::jsonb, '[]'::jsonb)$$, :'pa'), 'at least one result', 'empty report rejected');
select test.as_user(:'bob'::uuid);
select test.throws(format($$select public.create_lab_report(%L, '{"title":"Intruder"}'::jsonb, jsonb_build_array(jsonb_build_object('type_id', %L, 'value_num', '10', 'unit', 'g/dL')))$$, :'pa', :'t_hb'),
  '42501|row-level security', 'bob cannot create a report in alice file');

-- ---------------------------------------------------------------- register_document
select test.as_user(:'alice'::uuid);
select public.register_document(:'pa', 'CBC scan', 'lab_report', :'pa' || '/f1.pdf', 'cbc.pdf', 'application/pdf', 1234, repeat('e', 64),
  null, 'scan of the printed result', current_date, 'standard', null, :'rep') as doc \gset
select test.ok((select uploaded_by from public.medical_documents where id = :'doc') = :'alice'::uuid, 'document is attributed to the signed-in user');
select test.ok((select lab_report_id from public.medical_documents where id = :'doc') = :'rep'::uuid, 'document can be linked to the lab report');
select test.throws(format($$select public.register_document(%L, 'x doc', 'other', %L, 'a.pdf', 'application/pdf', 10, repeat('f', 64))$$, :'pb', :'pb' || '/z.pdf'), 'forbidden', 'cannot register a document for another patient');
select test.throws(format($$select public.register_document(%L, 'x doc', 'other', %L, 'a.pdf', 'application/pdf', 10, repeat('f', 64))$$, :'pa', :'pb' || '/z.pdf'), 'check constraint', 'storage path must live under the patient folder');
select test.throws(format($$select public.register_document(%L, 'x doc', 'other', %L, 'a.exe', 'application/x-msdownload', 10, repeat('f', 64))$$, :'pa', :'pa' || '/z.exe'), 'check constraint', 'only whitelisted mime types are accepted');
select test.throws(format($$select public.register_document(%L, 'x doc', 'other', %L, 'a.pdf', 'application/pdf', 99999999, repeat('f', 64))$$, :'pa', :'pa' || '/big.pdf'), 'check constraint', 'oversized document rejected');
select test.throws(format($$select public.register_document(%L, 'x doc', 'other', %L, 'a.pdf', 'application/pdf', 10, 'nothex')$$, :'pa', :'pa' || '/h.pdf'), 'check constraint', 'a malformed checksum is rejected');
select test.as_anon();
select test.throws(format($$select public.register_document(%L, 'x doc', 'other', %L, 'a.pdf', 'application/pdf', 10, repeat('f', 64))$$, :'pa', :'pa' || '/q.pdf'), 'permission denied', 'anon cannot register documents');
select test.as_user(:'alice'::uuid);
select test.throws(format($$insert into public.medical_documents (patient_id, title, storage_path, original_filename, mime_type, size_bytes, sha256) values (%L, 'direct', %L, 'a.pdf', 'application/pdf', 10, repeat('f', 64))$$, :'pa', :'pa' || '/direct.pdf'),
  'permission denied', 'documents cannot be inserted directly');
select test.as_super();
select test.ok(exists (select 1 from public.audit_logs where table_name = 'medical_documents' and record_id = :'doc'::uuid and actor_id = :'alice'::uuid), 'document registration is audited with the user as actor');
