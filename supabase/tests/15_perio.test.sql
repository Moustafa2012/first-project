\pset tuples_only on
\set alice 'a1111111-1111-1111-1111-111111111111'
\set bob 'b2222222-2222-2222-2222-222222222222'

select test.as_user(:'alice'::uuid);
select public.create_patient('Perio Patient', date '1975-01-01', 'female', null, null, null, null, null, null, 'self', true) as pp \gset
insert into public.recalls (patient_id, kind, interval_months, due_on) values (:'pp', 'perio_maintenance', 3, current_date - 5) returning id as rc \gset

-- a draft with two teeth
select public.perio_exam_save(:'pp', null, jsonb_build_object('exam_date', current_date - 1, 'examiner_name', 'Dr Gum'),
  '[{"tooth":16,"pd":[3,2,5,4,3,6],"gm":[0,-1,-2,0,null,1],"bop":[false,false,true,false,false,true],"plaque":[true,false,false,false,false,false],"mobility":1,"furcation_b":2},
    {"tooth":11,"pd":[2,2,2,2,2,2]}]'::jsonb) as ex \gset
select test.ok((select status = 'draft' and finalized_at is null from public.perio_exams where id = :'ex'), 'a new periodontal chart is a draft');
select test.ok((select cal = '{3,3,7,4,3,5}'::smallint[] from public.perio_teeth where exam_id = :'ex' and tooth = 16),
  'CAL = PD - GM per site (recession is a negative margin; an unmeasured margin is at the CEJ)');
select test.ok((select cal = '{2,2,2,2,2,2}'::smallint[] from public.perio_teeth where exam_id = :'ex' and tooth = 11), 'without margins CAL equals PD');
select test.throws(format($$update public.perio_teeth set cal = '{1,1,1,1,1,1}' where exam_id = %L$$, :'ex'), 'generated|can only be updated to DEFAULT', 'CAL is computed, never typed');

-- checks
select test.throws(format($$insert into public.perio_teeth (patient_id, exam_id, tooth, pd) values (%L, %L, 21, '{1,2,3}')$$, :'pp', :'ex'),
  'check constraint|violates', 'six sites per tooth');
select test.throws(format($$insert into public.perio_teeth (patient_id, exam_id, tooth, pd) values (%L, %L, 21, '{1,2,3,4,5,25}')$$, :'pp', :'ex'),
  'check constraint|violates', 'probing depths stay in range');
select test.throws(format($$insert into public.perio_teeth (patient_id, exam_id, tooth, furcation_b) values (%L, %L, 13, 1)$$, :'pp', :'ex'),
  'check constraint|violates', 'no furcation on a canine');
select test.throws(format($$insert into public.perio_teeth (patient_id, exam_id, tooth, missing, pd) values (%L, %L, 22, true, '{1,1,1,1,1,1}')$$, :'pp', :'ex'),
  'check constraint|violates', 'a missing tooth has no measurements');
select test.throws(format($$select public.perio_exam_save(%L, null, '{"exam_date":"2020-01-01"}', '[]')$$, :'pp'),
  'unique|duplicate', 'one open draft per file');

-- the draft is edited; resaving the same values writes nothing
select count(*) as audits0 from public.audit_logs where table_name = 'perio_teeth' and patient_id = :'pp' \gset
select public.perio_exam_save(:'pp', :'ex', jsonb_build_object('exam_date', current_date - 1, 'examiner_name', 'Dr Gum'),
  '[{"tooth":11,"pd":[2,2,2,2,2,2]},{"tooth":46,"missing":true}]'::jsonb) as ex2 \gset
select test.ok(:'ex2' = :'ex' and (select count(*) = 3 from public.perio_teeth where exam_id = :'ex'), 'the draft is updated in place');
select count(*) as audits1 from public.audit_logs where table_name = 'perio_teeth' and patient_id = :'pp' \gset
select test.ok(:audits1 = :audits0 + 1, 'an unchanged tooth is not rewritten (only the new one is audited)');

-- finalising
select test.throws(format($$select public.perio_exam_save(%L, %L, '{"exam_date":"2999-01-01"}', '[]')$$, :'pp', :'ex'), 'exam_date_invalid', 'no future exam date');
select public.perio_exam_save(:'pp', :'ex', jsonb_build_object('exam_date', current_date - 1, 'examiner_name', 'Dr Gum'), '[]', true);
select test.ok((select status = 'final' and finalized_at is not null and finalized_by = :'alice'::uuid from public.perio_exams where id = :'ex'),
  'finalising records who and when');
select test.ok((select last_done_on = current_date - 1 from public.recalls where id = :'rc'), 'a final chart moves the periodontal maintenance recall forward');
select test.throws(format($$update public.perio_teeth set pd = '{9,9,9,9,9,9}' where exam_id = %L and tooth = 11$$, :'ex'), 'perio_final', 'a final chart''s teeth are not edited');
select test.throws(format($$update public.perio_exams set notes = 'later' where id = %L$$, :'ex'), 'perio_final', 'nor its header');
select test.throws(format($$update public.perio_exams set status = 'draft' where id = %L$$, :'ex'), 'perio_final', 'nor turned back into a draft');
select test.throws(format($$select public.perio_exam_save(%L, %L, '{"exam_date":"2020-01-01"}', '[{"tooth":21,"pd":[1,1,1,1,1,1]}]')$$, :'pp', :'ex'),
  'perio_final', 'nor saved over');

-- an empty draft is not finalised; a draft can be discarded (marked in error with the reason)
select public.perio_exam_save(:'pp', null, jsonb_build_object('exam_date', current_date), '[]') as ex3 \gset
select test.throws(format($$select public.perio_exam_save(%L, %L, '{"exam_date":"%s"}', '[]', true)$$, :'pp', :'ex3', current_date), 'exam_empty',
  'an empty chart is not finalised');
update public.perio_exams set record_status = 'entered_in_error', invalidated_reason = 'discarded draft' where id = :'ex3';
select test.throws(format($$insert into public.perio_teeth (patient_id, exam_id, tooth, pd) values (%L, %L, 21, '{1,1,1,1,1,1}')$$, :'pp', :'ex3'),
  'entered in error', 'nothing is added to a discarded chart');
select public.perio_exam_save(:'pp', null, jsonb_build_object('exam_date', current_date), '[{"tooth":21,"pd":[3,3,3,3,3,3]}]') as ex4 \gset
select test.ok(:'ex4' is not null, 'after discarding, a new draft can be started');
update public.perio_exams set record_status = 'entered_in_error', invalidated_reason = 'wrong patient' where id = :'ex';
select test.ok((select record_status = 'entered_in_error' and status = 'final' from public.perio_exams where id = :'ex'), 'a final chart can still be marked entered in error');

-- isolation
select test.as_user(:'bob'::uuid);
select test.ok((select count(*) = 0 from public.perio_exams where patient_id = :'pp') and (select count(*) = 0 from public.perio_teeth where patient_id = :'pp'),
  'another account sees no periodontal chart');
select test.throws(format($$select public.perio_exam_save(%L, null, '{"exam_date":"2020-01-01"}', '[]')$$, :'pp'), 'forbidden', 'nor writes one');
select test.throws(format($$insert into public.perio_teeth (patient_id, exam_id, tooth) values (%L, %L, 21)$$, :'pp', :'ex4'), 'row-level|permission', 'nor adds a tooth');

-- purge
select test.as_user(:'alice'::uuid);
select public.patient_request_deletion(:'pp', 'Perio Patient');
select test.as_service();
select public.patient_purge(:'pp', true);
select test.ok((select count(*) = 0 from public.perio_exams where patient_id = :'pp') and (select count(*) = 0 from public.perio_teeth where patient_id = :'pp'),
  'the periodontal charts are purged with the file');
select test.as_super();
