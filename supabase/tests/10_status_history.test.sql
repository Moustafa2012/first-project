\pset tuples_only on
\set alice 'a1111111-1111-1111-1111-111111111111'
\set bob 'b2222222-2222-2222-2222-222222222222'

select test.as_user(:'alice'::uuid);
select public.create_patient('Status Patient', date '1970-07-07', 'male', null, null, null, null, null, null, 'self', true) as ps \gset
insert into public.conditions (patient_id, name, category, clinical_status) values (:'ps', 'Dental abscess', 'acute', 'active') returning id as c1 \gset
insert into public.medications (patient_id, name_generic, status, start_date) values (:'ps', 'Amoxicillin', 'active', current_date - 10) returning id as m1 \gset
insert into public.allergies (patient_id, substance) values (:'ps', 'Latex') returning id as a1 \gset

select test.ok((select count(*) from public.status_history where record_id in (:'c1', :'m1', :'a1') and from_value is null) = 4,
  'every new record starts its status history (condition status + certainty, medication, allergy)');

select public.record_set_status('conditions', :'c1', 'resolved', 'treated with root canal', current_date - 1);
select test.ok((select clinical_status = 'resolved' and resolved_date = current_date - 1 from public.conditions where id = :'c1'), 'a diagnosis is resolved in one step with its date');
select test.ok((select from_value = 'active' and to_value = 'resolved' and reason = 'treated with root canal' and effective_date = current_date - 1 and changed_by = :'alice'::uuid
                  from public.status_history where record_id = :'c1' and field = 'clinical_status' and from_value is not null),
  'the change is kept with who, the date it took effect and the reason');
select public.record_set_status('conditions', :'c1', 'recurrence', 'swelling again');
select test.ok((select clinical_status = 'recurrence' and resolved_date is null from public.conditions where id = :'c1'), 'a recurrence reopens the diagnosis');
select test.ok((select count(*) from public.status_history where record_id = :'c1' and field = 'clinical_status') = 3, 'the whole sequence is kept');
select public.record_set_status('conditions', :'c1', 'refuted', 'not an abscess after imaging');
select test.ok((select certainty = 'refuted' from public.conditions where id = :'c1')
               and exists (select 1 from public.status_history where record_id = :'c1' and field = 'certainty' and to_value = 'refuted'),
  'ruling a diagnosis out is a certainty change, also kept');

select public.record_set_status('medications', :'m1', 'completed', 'course finished');
select test.ok((select status = 'completed' and end_date = current_date and stopped_by = 'course_completed' and stop_reason = 'course finished' from public.medications where id = :'m1'),
  'a medication course is completed with its end date');
select public.record_set_status('medications', :'m1', 'active');
select test.ok((select status = 'active' and end_date is null and stopped_by is null from public.medications where id = :'m1'), 'and can be resumed');
select public.record_set_status('allergies', :'a1', 'resolved', 'tolerated since');
select test.ok((select status from public.allergies where id = :'a1') = 'resolved', 'an allergy can be marked resolved');

select test.throws(format($$select public.record_set_status('conditions', %L, 'magic')$$, :'c1'), 'invalid_status', 'an unknown status is refused');
select test.throws(format($$select public.record_set_status('patients', %L, 'active')$$, :'c1'), 'invalid_table', 'only the three kinds of record');
select test.throws(format($$select public.record_set_status('conditions', %L, 'resolved', null, current_date + 30)$$, :'c1'), 'date_in_future', 'a future date is refused');
select test.throws($$insert into public.status_history (patient_id, table_name, record_id, field, to_value) values (gen_random_uuid(), 'conditions', gen_random_uuid(), 'status', 'x')$$,
  'permission denied', 'the history cannot be written directly');
select test.throws(format($$update public.status_history set reason = 'rewritten' where record_id = %L$$, :'c1'), 'permission denied', 'nor rewritten');

update public.conditions set record_status = 'entered_in_error', invalidated_reason = 'test' where id = :'c1';
select test.throws(format($$select public.record_set_status('conditions', %L, 'active')$$, :'c1'), 'not_found', 'an invalidated record keeps its last status');

select test.as_user(:'bob'::uuid);
select test.ok((select count(*) from public.status_history where patient_id = :'ps') = 0, 'another account sees none of this history');
select test.throws(format($$select public.record_set_status('medications', %L, 'stopped')$$, :'m1'), 'not_found', 'and cannot change a status');

select test.as_user(:'alice'::uuid);
select public.patient_request_deletion(:'ps', 'Status Patient');
select test.as_service();
select public.patient_purge(:'ps', true);
select test.ok(not exists (select 1 from public.status_history where patient_id = :'ps'), 'purging a file removes its status history');
select test.as_super();
