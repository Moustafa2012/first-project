\pset tuples_only on
\set alice 'a1111111-1111-1111-1111-111111111111'
\set bob 'b2222222-2222-2222-2222-222222222222'
select id as s_dent from public.medical_specialties where code = 'dentistry' \gset

select test.as_user(:'alice'::uuid);
select public.create_patient('Baseline Patient', date '1980-01-01', 'male', null, null, null, null, null, null, 'self', true) as pb \gset

-- a baseline exam: teeth, the exam sections and pulp tests together
select public.dental_exam_create(:'pb', jsonb_build_object('exam_date', current_date, 'kind', 'comprehensive', 'is_baseline', true,
  'sections', jsonb_build_object(
    'extraoral', jsonb_build_object('face', 'normal', 'tmj_sounds', 'click', 'mouth_opening_mm', 42),
    'soft_tissue', jsonb_build_object('tongue', 'abnormal', 'cancer_screening', 'suspicious', 'note', 'white patch, left lateral tongue'),
    'occlusion', jsonb_build_object('molar_right', 'II', 'overjet_mm', 6, 'crossbite', 'none'),
    'hygiene', jsonb_build_object('calculus', 'both', 'bleeding', 'generalized')),
  'pulp_tests', '[{"tooth":36,"test":"cold","result":"no_response"},{"tooth":36,"test":"percussion","result":"tender"},{"tooth":11,"test":"ept","result":"normal","value":"38/80"}]'::jsonb),
  '[{"tooth":36,"status":"present"},{"tooth":18,"status":"impacted"}]',
  '[{"tooth":46,"kind":"calculus","evidence":"clinical"},{"tooth":36,"kind":"bone_loss","evidence":"radiographic","severity":"moderate"},{"tooth":26,"kind":"retained_root","evidence":"clinical_radiographic"}]') as ex \gset
select test.ok((select is_baseline and sections -> 'extraoral' ->> 'mouth_opening_mm' = '42' and sections -> 'soft_tissue' ->> 'cancer_screening' = 'suspicious'
                from public.dental_exams where id = :'ex'), 'a baseline exam keeps its sections');
select test.ok((select count(*) = 3 from public.dental_pulp_tests where exam_id = :'ex')
               and (select value = '38/80' from public.dental_pulp_tests where exam_id = :'ex' and test = 'ept'), 'pulp tests are kept per tooth');
select test.ok((select count(*) = 3 from public.dental_findings where exam_id = :'ex' and kind in ('calculus', 'bone_loss', 'retained_root')),
  'calculus, bone loss and a retained root can be recorded');

-- the database checks every key and value
select test.throws(format($$select public.dental_exam_create(%L, '{"exam_date":"2024-01-01","sections":{"extraoral":{"face":"weird"}}}', '[]', '[]')$$, :'pb'),
  'check constraint|violates', 'an unknown value is refused');
select test.throws(format($$select public.dental_exam_create(%L, '{"exam_date":"2024-01-01","sections":{"extraoral":{"mouth_opening_mm":200}}}', '[]', '[]')$$, :'pb'),
  'check constraint|violates', 'a measure out of range is refused');
select test.throws(format($$select public.dental_exam_create(%L, '{"exam_date":"2024-01-01","sections":{"astrology":{"x":"y"}}}', '[]', '[]')$$, :'pb'),
  'check constraint|violates', 'an unknown section is refused');
select test.throws(format($$select public.dental_exam_create(%L, '{"exam_date":"2024-01-01","pulp_tests":[{"tooth":11,"test":"percussion","result":"lingering"}]}', '[]', '[]')$$, :'pb'),
  'check constraint|violates', 'a pulp result must suit its test');
select test.ok(app.dental_sections_ok('{"occlusion":{"overjet_mm":-3,"incisor":"II_2"}}') and not app.dental_sections_ok('{"occlusion":{"overjet_mm":2.5}}'),
  'measures are whole millimetres');

-- an exam of the soft tissues alone is an exam; an empty one is not
select public.dental_exam_create(:'pb', '{"exam_date":"2024-02-01","kind":"limited","sections":{"soft_tissue":{"tongue":"normal","cancer_screening":"no_suspicious"}}}', '[]', '[]') as ex2 \gset
select test.ok(:'ex2' is not null, 'an exam of the soft tissues alone is saved');
select test.throws(format($$select public.dental_exam_create(%L, '{"exam_date":"2024-02-01","sections":{}}', '[]', '[]')$$, :'pb'), 'exam_empty', 'an empty exam is not');

-- pulp tests are never edited, and follow the exam
select test.throws(format($$update public.dental_pulp_tests set result = 'normal' where exam_id = %L$$, :'ex'), 'permission denied|row-level', 'a pulp test is not edited');
update public.dental_exams set record_status = 'entered_in_error', invalidated_reason = 'wrong date' where id = :'ex2';
select test.throws(format($$insert into public.dental_pulp_tests (patient_id, exam_id, tooth, test, result) values (%L, %L, 11, 'cold', 'normal')$$, :'pb', :'ex2'),
  'entered in error', 'nothing is added to an invalidated exam');

-- isolation
select test.as_user(:'bob'::uuid);
select test.ok((select count(*) = 0 from public.dental_pulp_tests where patient_id = :'pb'), 'another account sees no pulp test');

-- the dentist through a share records a baseline exam; the next dentist sees its sections
select test.as_user(:'alice'::uuid);
select public.share_create(p_patient => :'pb', p_title => 'Dentist', p_scope_kind => 'specialty', p_specialty_ids => array[:'s_dent'::uuid],
  p_expires_at => now() + interval '1 day', p_allow_contribute => true, p_contribute_modules => array['dental_exams'],
  p_clinician => '{"name":"Dr Abdullah","specialty":"General dentistry","facility":"Smile"}') as sh \gset
select (:'sh'::jsonb ->> 'token') as tok, (:'sh'::jsonb ->> 'pin') as pin \gset
select test.as_service();
select (public.share_open(:'tok', :'pin', 'ip-b', 'UA') ->> 'session_token') as sess \gset
select public.share_confirm_clinician(:'sess');
select (public.share_contribute_dental_exam(:'sess', jsonb_build_object('exam_date', current_date, 'kind', 'comprehensive', 'is_baseline', true,
  'sections', jsonb_build_object('hygiene', jsonb_build_object('calculus', 'subgingival')),
  'pulp_tests', '[{"tooth":21,"test":"cold","result":"lingering"}]'::jsonb), '[]', '[]') ->> 'id') as dex \gset
select test.ok((select is_baseline and contributed_by is not null from public.dental_exams where id = :'dex')
               and (select contributed_by is not null from public.dental_pulp_tests where exam_id = :'dex'), 'the dentist records a baseline exam with pulp tests through the link');
select test.ok(public.share_dental_exam_extras(:'sess') -> 'exams' -> :'dex' -> 'sections' -> 'hygiene' ->> 'calculus' = 'subgingival'
               and jsonb_array_length(public.share_dental_exam_extras(:'sess') -> 'exams' -> :'ex' -> 'pulp_tests') = 3,
  'the link shows the sections and pulp tests of every exam in scope');
select test.as_user(:'alice'::uuid);
select test.throws(format($$insert into public.dental_pulp_tests (patient_id, exam_id, tooth, test, result) values (%L, %L, 22, 'cold', 'normal')$$, :'pb', :'dex'),
  'contributed_record_readonly', 'the patient does not add to the dentist''s exam');

select test.throws(format($$insert into public.dental_pulp_tests (patient_id, exam_id, tooth, test, result, contributed_by) values (%L, %L, 22, 'cold', 'normal', (select contributed_by from public.dental_exams where id = %L))$$, :'pb', :'ex', :'dex'),
  'set by the share functions only', 'the patient cannot attribute a pulp test to a clinician');

select public.patient_request_deletion(:'pb', 'Baseline Patient');
select test.as_service();
select public.patient_purge(:'pb', true);
select test.ok((select count(*) = 0 from public.dental_pulp_tests where patient_id = :'pb'), 'pulp tests are purged with the file');
select test.as_super();
