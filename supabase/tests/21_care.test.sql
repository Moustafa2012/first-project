\pset tuples_only on
\set alice 'a1111111-1111-1111-1111-111111111111'
\set bob 'b2222222-2222-2222-2222-222222222222'
\set dave 'd4444444-4444-4444-4444-444444444444'
\set erin 'e5555555-5555-5555-5555-555555555555'
\set frank 'f6666666-6666-6666-6666-666666666666'
\set gina '91111111-1111-1111-1111-111111111111'

select test.as_super();
insert into auth.users (id, email, raw_user_meta_data) values
  (:'erin', 'erin@example.test', '{"full_name":"Erin Editor"}'),
  (:'frank', 'frank@example.test', '{"full_name":"Frank Viewer"}'),
  (:'gina', 'gina@example.test', '{"full_name":"Gina Counts"}');
select id as t_rdw from public.observation_types where code = 'rdw_cv' \gset
select id as t_rdwsd from public.observation_types where code = 'rdw_sd' \gset
select id as t_mpv from public.observation_types where code = 'mpv' \gset
select id as t_wbc from public.observation_types where code = 'wbc' \gset
select id as t_hb from public.observation_types where code = 'hemoglobin' \gset
select id as t_a1c from public.observation_types where code = 'hba1c' \gset
select id as t_bp from public.observation_types where code = 'blood_pressure' \gset

select test.as_user(:'alice'::uuid);
select public.create_patient('Care Patient', date '1985-04-04', 'female', null, null, null, null, null, null, 'self', true) as pa \gset
select public.create_patient('Care Second File', date '2015-02-02', 'male', null, null, null, null, null, null, 'dependent', true) as pa2 \gset
select test.as_user(:'bob'::uuid);
select public.create_patient('Bob Care File', date '1970-01-01', 'male', null, null, null, null, null, null, 'self', true) as pb \gset
select test.as_user(:'gina'::uuid);
select public.create_patient('Gina Counts File', date '1992-06-06', 'female', null, null, null, null, null, null, 'self', true) as pg1 \gset
select public.create_patient('Gina Dental File', date '1993-07-07', 'female', null, null, null, null, null, null, 'self', true) as pg2 \gset
select test.as_super();
insert into public.patient_members (patient_id, user_id, role, can_write, can_share) values (:'pa', :'dave', 'caregiver', false, false);

-- ============================================================================================================ 1. reminders: the feed
select test.as_user(:'alice'::uuid);
insert into public.recalls (patient_id, kind, interval_months, due_on) values (:'pa', 'dental_checkup', 6, current_date - 3) returning id as rc1 \gset
insert into public.recalls (patient_id, kind, interval_months, due_on) values (:'pa', 'dental_cleaning', 6, current_date + 90);
insert into public.recalls (patient_id, kind, interval_months, due_on, status) values (:'pa', 'dental_xray', 12, current_date - 5, 'paused');
insert into public.recalls (patient_id, kind, interval_months, due_on) values (:'pa2', 'dental_checkup', 6, current_date + 5);
select test.ok((select count(*) = 1 and min(due_on) = current_date - 3 and min(code) = 'dental_checkup' from public.care_reminder_feed(:'pa') where kind = 'recall'),
  'the feed lists an overdue recall, and neither a far one nor a paused one');
select test.ok((select count(*) = 1 from public.care_reminder_feed(:'pa2') where kind = 'recall' and patient_id = :'pa2'::uuid), 'a recall coming up is listed for its own file');
select test.ok((select count(distinct patient_id) = 1 from public.care_reminder_feed(:'pa') where true), 'asking for one file returns that file only');

-- medicines: an end date (no prescription), refills, and the prescription they belong to
insert into public.medications (patient_id, name_generic, start_date, end_date) values (:'pa', 'Antibiotic course', current_date - 5, current_date + 5);
insert into public.medications (patient_id, name_generic, start_date, end_date) values (:'pa', 'Overdue course', current_date - 30, current_date - 10);
insert into public.medications (patient_id, name_generic, start_date, end_date) values (:'pa', 'Far course', current_date, current_date + 100);
insert into public.medications (patient_id, name_generic, start_date, end_date, status, stopped_by) values (:'pa', 'Stopped course', current_date - 5, current_date + 4, 'stopped', 'patient');
insert into public.medications (patient_id, name_generic, start_date, duration_days, refills) values (:'pa', 'Refill medicine', current_date - 40, 30, 2);
insert into public.medications (patient_id, name_generic, start_date, duration_days, refills) values (:'pa', 'No refill medicine', current_date - 40, 30, 0);
select test.ok((select count(*) = 2 and bool_or(label = 'Antibiotic course' and due_on = current_date + 5) and bool_or(label = 'Overdue course' and due_on = current_date - 10)
                  from public.care_reminder_feed(:'pa') where kind = 'medication_end'),
  'a medicine with an end date is listed (coming up or already past), not a far one nor a stopped one');
select test.ok((select count(*) = 1 and min(due_on) = current_date + 20 and min(detail) = '2/2' and min(label) = 'Refill medicine'
                  from public.care_reminder_feed(:'pa') where kind = 'medication_refill'),
  'the next refill is the first supply boundary that is not past yet (refill 2 of 2 in 20 days)');
select public.prescription_create(:'pa', jsonb_build_object('prescriber_name', 'Dr Feed'),
  jsonb_build_array(jsonb_build_object('name_generic', 'Amoxicillin', 'duration_days', 7, 'refills', 0),
                    jsonb_build_object('name_generic', 'Ibuprofen', 'duration_days', 3, 'refills', 1))) as rxf \gset
select test.ok((select count(*) = 1 and min(due_on) = current_date + 6 and min(label) = 'Dr Feed' and min(ref_id::text) = :'rxf'
                  from public.care_reminder_feed(:'pa') where kind = 'prescription_end'),
  'an active prescription ends with its latest line (the last supply, refills included)');
select test.ok((select count(*) = 1 and min(due_on) = current_date + 3 and min(detail) = '1/1' from public.care_reminder_feed(:'pa') where kind = 'medication_refill' and label = 'Ibuprofen'),
  'a prescription line with refills lists its refill');
select test.ok((select count(*) = 0 from public.care_reminder_feed(:'pa') where kind = 'medication_end' and label in ('Amoxicillin', 'Ibuprofen')),
  'the lines of a prescription are read through the prescription, not twice');
select public.prescription_set_status(:'rxf', 'completed');
select test.ok((select count(*) = 0 from public.care_reminder_feed(:'pa') where kind in ('prescription_end') or label in ('Amoxicillin', 'Ibuprofen')), 'a completed prescription is no longer listed');

-- open test requests past their target date
insert into public.test_orders (patient_id, name, priority, requested_on) values (:'pa', 'Urgent CBC', 'urgent', current_date - 10);
insert into public.test_orders (patient_id, name, priority, requested_on) values (:'pa', 'Old routine panel', 'routine', current_date - 40);
insert into public.test_orders (patient_id, name, priority, requested_on) values (:'pa', 'Fresh routine panel', 'routine', current_date);
insert into public.test_orders (patient_id, name, priority, requested_on, target_on) values (:'pa', 'Soon target', 'routine', current_date, current_date + 5);
insert into public.test_orders (patient_id, name, priority, requested_on, target_on) values (:'pa', 'Far target', 'routine', current_date, current_date + 20);
insert into public.test_orders (patient_id, name, priority, requested_on, status, done_on) values (:'pa', 'Done urgent', 'urgent', current_date - 10, 'done', current_date - 2);
select test.ok((select count(*) = 3 from public.care_reminder_feed(:'pa') where kind = 'test_order'), 'three open test requests are listed (past target, or due within a week)');
select test.ok((select due_on = current_date - 7 and code = 'urgent' from public.care_reminder_feed(:'pa') where kind = 'test_order' and label = 'Urgent CBC'), 'urgent: three days after the request');
select test.ok((select due_on = current_date - 10 from public.care_reminder_feed(:'pa') where kind = 'test_order' and label = 'Old routine panel'), 'routine: thirty days after the request');
select test.ok((select due_on = current_date + 5 from public.care_reminder_feed(:'pa') where kind = 'test_order' and label = 'Soon target'), 'a target date set by the person wins');
select test.ok((select count(*) = 0 from public.care_reminder_feed(:'pa') where kind = 'test_order' and label in ('Fresh routine panel', 'Far target', 'Done urgent')),
  'a fresh request, a far target and a done request are not listed');
select test.throws(format($$insert into public.test_orders (patient_id, name, requested_on, target_on) values (%L, 'Backwards', current_date, current_date - 1)$$, :'pa'),
  'check constraint|violates', 'a target date cannot precede the request');

-- appointments
insert into public.appointments (patient_id, scheduled_at, reason) values (:'pa', now() + interval '36 hours', 'Cardiology review');
insert into public.appointments (patient_id, scheduled_at, reason, status) values (:'pa', now() + interval '36 hours', 'Done visit', 'completed');
insert into public.appointments (patient_id, scheduled_at, reason) values (:'pa', now() + interval '40 days', 'Far visit');
insert into public.appointments (patient_id, scheduled_at, reason) values (:'pa', now() - interval '2 days', 'Missed visit');
select test.ok((select count(*) = 1 and bool_and(at_time is not null) and min(label) = 'Cardiology review' from public.care_reminder_feed(:'pa') where kind = 'appointment'),
  'an upcoming scheduled appointment is listed with its time; completed, far and past ones are not');

-- what people write for themselves
insert into public.care_reminders (patient_id, title, due_on, remind_days_before) values (:'pa', 'Renew insurance', current_date + 2, 3) returning id as cr1 \gset
insert into public.care_reminders (patient_id, title, due_on, remind_days_before) values (:'pa', 'Too early', current_date + 10, 3);
insert into public.care_reminders (patient_id, title, due_on, remind_days_before) values (:'pa', 'Long lead', current_date + 10, 14);
insert into public.care_reminders (patient_id, title, due_on, remind_days_before) values (:'pa', 'Late one', current_date - 2, 0) returning id as cr2 \gset
insert into public.care_reminders (patient_id, title, due_on, remind_days_before, repeat_months) values (:'pa', 'Monthly weigh-in', current_date - 1, 0, 1) returning id as cr3 \gset
select test.ok((select count(*) = 4 and bool_and(label <> 'Too early') from public.care_reminder_feed(:'pa') where kind = 'custom'), 'a written reminder shows from its lead time on, not before');
select test.ok((select record_status = 'active' and status = 'open' and verification = 'reported' and recorded_by = :'alice'::uuid from public.care_reminders where id = :'cr1'), 'a reminder carries its provenance');
select test.ok((select count(*) = 1 from public.audit_logs where table_name = 'care_reminders' and record_id = :'cr1' and action = 'insert' and actor_id = :'alice'::uuid), 'a reminder is audited');
select public.care_reminder_done(:'cr2');
select test.ok((select status = 'done' and completed_on = current_date and last_done_on = current_date from public.care_reminders where id = :'cr2'), 'doing a one-off reminder closes it');
select test.ok((select count(*) = 0 from public.care_reminder_feed(:'pa') where kind = 'custom' and label = 'Late one'), 'a closed reminder leaves the feed');
select public.care_reminder_done(:'cr3');
select test.ok((select status = 'open' and due_on > current_date and last_done_on = current_date and due_on = current_date - 1 + interval '1 month' from public.care_reminders where id = :'cr3'),
  'a repeating reminder moves to its next date and stays open');
select test.throws(format($$select public.care_reminder_done(%L)$$, :'cr2'), 'not_found', 'a closed reminder cannot be done again');
select test.throws(format($$select public.care_reminder_done(%L, current_date + 30)$$, :'cr1'), 'date_in_future', 'it cannot be done in the future');
update public.care_reminders set status = 'dismissed', completed_on = current_date where id = :'cr1';
select test.ok((select count(*) = 0 from public.care_reminder_feed(:'pa') where label = 'Renew insurance'), 'a dismissed reminder leaves the feed');
select test.throws(format($$insert into public.care_reminders (patient_id, title, due_on) values (%L, 'x', current_date)$$, :'pa'), 'check constraint|violates', 'a reminder needs a title');
select test.throws(format($$insert into public.care_reminders (patient_id, title, due_on, repeat_months) values (%L, 'Bad repeat', current_date, 0)$$, :'pa'), 'check constraint|violates', 'a repeat is at least a month');
select test.throws(format($$insert into public.care_reminders (patient_id, title, due_on, remind_days_before) values (%L, 'Bad lead', current_date, 500)$$, :'pa'), 'check constraint|violates', 'the lead time is at most a year');
select test.throws(format($$insert into public.care_reminders (patient_id, title, due_on, status) values (%L, 'Closed at birth', current_date, 'done')$$, :'pa'), 'check constraint|violates', 'a closed reminder has a completion date');
select test.throws(format($$update public.care_reminders set record_status = 'entered_in_error' where id = %L$$, :'cr2'), 'reason', 'a reminder cannot be invalidated without a reason');
update public.care_reminders set record_status = 'entered_in_error', invalidated_reason = 'typo' where id = :'cr3';
select test.ok((select count(*) = 0 from public.care_reminder_feed(:'pa') where label = 'Monthly weigh-in'), 'an invalidated reminder leaves the feed (and stays in the record)');
select test.throws(format($$update public.care_reminders set title = 'again' where id = %L$$, :'cr3'), 'entered-in-error', 'an invalidated reminder cannot be edited');
select test.throws(format($$update public.care_reminders set patient_id = %L where id = %L$$, :'pa2', :'cr1'), 'immutable', 'a reminder cannot be moved to another file');

-- who sees what
select test.as_user(:'bob'::uuid);
select test.ok((select count(*) = 0 from public.care_reminder_feed(:'pa')), 'another account gets an empty feed for a file it cannot read');
select test.ok((select count(*) = 0 from public.care_reminders where patient_id = :'pa'), 'nor the reminders themselves');
select test.throws(format($$insert into public.care_reminders (patient_id, title, due_on) values (%L, 'Intruder', current_date)$$, :'pa'), 'row-level security|permission', 'nor can it add one');
select test.as_user(:'dave'::uuid);
select test.ok((select count(*) > 5 from public.care_reminder_feed(:'pa')), 'a read-only member sees the feed');
select test.throws(format($$insert into public.care_reminders (patient_id, title, due_on) values (%L, 'Read only', current_date)$$, :'pa'), 'row-level security|permission', 'but cannot add a reminder');
select test.as_anon();
select test.throws($$select * from public.care_reminder_feed(null)$$, 'permission denied', 'anonymous callers cannot read the feed');
select test.throws($$select public.care_reminder_count()$$, 'permission denied', 'nor the count');
select test.as_super();

-- the number on the bell, with an account that owns one file
select test.as_user(:'gina'::uuid);
insert into public.recalls (patient_id, kind, interval_months, due_on) values (:'pg1', 'dental_checkup', 6, current_date - 3);
insert into public.recalls (patient_id, kind, interval_months, due_on) values (:'pg1', 'dental_cleaning', 6, current_date + 20);
insert into public.care_reminders (patient_id, title, due_on, remind_days_before) values (:'pg1', 'Gina late', current_date - 2, 0);
insert into public.care_reminders (patient_id, title, due_on, remind_days_before) values (:'pg1', 'Gina soon', current_date + 2, 3);
insert into public.care_reminders (patient_id, title, due_on, remind_days_before) values (:'pg1', 'Gina later', current_date + 10, 3);
insert into public.test_orders (patient_id, name, priority, requested_on) values (:'pg1', 'Gina urgent test', 'urgent', current_date - 10);
select test.ok((select count(*) = 5 from public.care_reminder_feed(null)), 'the account-wide feed lists everything of its files');
select test.ok(public.care_reminder_count() = 4, 'the count is overdue + due within a week + written reminders inside their lead time (a recall in 20 days is not counted)');
select test.as_user(:'bob'::uuid);
select test.ok(public.care_reminder_count() = (select count(*)::int from public.care_reminder_feed(null) f where f.kind = 'custom' or f.due_on <= current_date + 7), 'the count follows the caller''s own feed');
select test.ok((select count(*) = 0 from public.care_reminder_feed(null) where patient_id = :'pg1'), 'and never includes another account''s files');

-- ============================================================================================================ 3. needs attention
select test.as_user(:'gina'::uuid);
-- laboratory values: the latest per test, compared with the one before
insert into public.observations (patient_id, type_id, value_num, effective_at, ref_low, ref_high) values (:'pg1', :'t_rdw', 16.4, now() - interval '20 days', 11.5, 14.5);
insert into public.observations (patient_id, type_id, value_num, effective_at, ref_low, ref_high) values (:'pg1', :'t_rdw', 15.2, now() - interval '5 days', 11.5, 14.5);
insert into public.observations (patient_id, type_id, value_num, effective_at, ref_low, ref_high) values (:'pg1', :'t_a1c', 7.4, now() - interval '3 days', 4, 5.6);
insert into public.observations (patient_id, type_id, value_num, effective_at, ref_low, ref_high) values (:'pg1', :'t_wbc', 6.8, now() - interval '3 days', 4, 11);
insert into public.observations (patient_id, type_id, value_num, unit, effective_at, ref_low, ref_high) values (:'pg1', :'t_hb', 80, 'g/L', now() - interval '30 days', 120, 160);
insert into public.observations (patient_id, type_id, value_num, unit, effective_at, ref_low, ref_high) values (:'pg1', :'t_hb', 10, 'g/dL', now() - interval '2 days', 12, 16);
insert into public.observations (patient_id, type_id, value_num, effective_at, ref_low, ref_high) values (:'pg1', :'t_rdwsd', 60, now() - interval '400 days', 39, 46);
insert into public.observations (patient_id, type_id, value_num, effective_at, ref_low, ref_high) values (:'pg1', :'t_mpv', 14, now() - interval '4 days', 7.5, 11.5) returning id as o_mpv \gset
update public.observations set status = 'entered_in_error', amendment_reason = 'wrong patient' where id = :'o_mpv';
insert into public.observations (patient_id, type_id, value_num, value_num2, effective_at) values (:'pg1', :'t_bp', 150, 95, now() - interval '1 day');
select test.ok((select count(*) = 3 from public.care_abnormal_labs(:'pg1')), 'three laboratory tests are outside their range now (latest value of each)');
select test.ok((select value_num = 15.2 and prev_value = 16.4 and prev_unit = '%' and interpretation = 'high' and ref_high = 14.5
                  from public.care_abnormal_labs(:'pg1') a join public.observation_types t on t.id = a.type_id where t.code = 'rdw_cv'),
  'only the latest value is listed, with the value before it');
select test.ok((select prev_value is null from public.care_abnormal_labs(:'pg1') a join public.observation_types t on t.id = a.type_id where t.code = 'hba1c'), 'a first value has no previous one');
select test.ok((select value_num = 10 and unit = 'g/dL' and prev_value = 80 and prev_unit = 'g/L' from public.care_abnormal_labs(:'pg1') a join public.observation_types t on t.id = a.type_id where t.code = 'hemoglobin'),
  'the previous unit is returned, so a unit change is never read as a trend');
select test.ok((select count(*) = 0 from public.care_abnormal_labs(:'pg1') a join public.observation_types t on t.id = a.type_id where t.code in ('wbc', 'rdw_sd', 'mpv', 'blood_pressure')),
  'normal values, values older than a year, invalidated values and vitals are not listed');
select test.as_user(:'bob'::uuid);
select test.ok((select count(*) = 0 from public.care_abnormal_labs(:'pg1')), 'another account sees none of them');
select test.as_user(:'gina'::uuid);

-- overdue, unreviewed doctor additions, an open soft-tissue alert, expiring shares, drafts
select public.share_create(p_patient => :'pg1', p_title => 'Ends tomorrow', p_scope_kind => 'full', p_expires_at => now() + interval '1 day', p_clinician => '{"name":"Dr Soon"}') as sh1 \gset
select public.share_create(p_patient => :'pg1', p_title => 'Ends later', p_scope_kind => 'full', p_expires_at => now() + interval '10 days', p_clinician => '{"name":"Dr Later"}') as sh2 \gset
select (:'sh1'::jsonb ->> 'share_id') as sid1 \gset
select test.as_super();
insert into public.share_notes (share_id, patient_id, author_name, body) values (:'sid1', :'pg1', 'Dr Soon', 'please check the dose');
insert into public.share_contributors (share_id, patient_id, full_name, signature_path, contribution_count, last_contribution_at)
  values (:'sid1', :'pg1', 'Dr Soon', :'pg1' || '/signatures/x.png', 2, now());
select test.as_user(:'gina'::uuid);
insert into public.clinical_notes (patient_id, kind, title, body, noted_at) values (:'pg1', 'patient_note', 'Draft one', 'text', now()) returning id as n1 \gset
insert into public.clinical_notes (patient_id, kind, title, body, noted_at) values (:'pg1', 'patient_note', 'Draft two', 'text', now()) returning id as n2 \gset
update public.clinical_notes set status = 'signed' where id = :'n2';
select public.dental_exam_create(:'pg2', jsonb_build_object('exam_date', current_date - 30, 'kind', 'comprehensive',
  'sections', jsonb_build_object('soft_tissue', jsonb_build_object('cancer_screening', 'suspicious'))), '[]', '[]') as ex1 \gset
select test.ok((select n = 1 from public.care_attention() where patient_id = :'pg2' and code = 'soft_tissue'), 'a suspicious soft-tissue answer is an open alert');
select public.dental_exam_create(:'pg2', jsonb_build_object('exam_date', current_date - 10, 'kind', 'limited',
  'sections', jsonb_build_object('soft_tissue', jsonb_build_object('cancer_screening', 'no_suspicious'))), '[]', '[]') as ex2 \gset
select test.ok((select n = 1 from public.care_attention() where patient_id = :'pg2' and code = 'soft_tissue'), 'a "no suspicious lesion" the patient reported does not close the alert');
select test.as_super();
update public.dental_exams set verification = 'confirmed' where id = :'ex2';
select test.as_user(:'gina'::uuid);
select test.ok((select count(*) = 0 from public.care_attention() where patient_id = :'pg2' and code = 'soft_tissue'), 'the same answer confirmed by a clinician closes it');
select public.dental_exam_create(:'pg2', jsonb_build_object('exam_date', current_date - 1, 'kind', 'limited',
  'sections', jsonb_build_object('soft_tissue', jsonb_build_object('cancer_screening', 'suspicious'))), '[]', '[]') as ex3 \gset
select test.ok((select n = 1 from public.care_attention() where patient_id = :'pg2' and code = 'soft_tissue'), 'a newer suspicious answer opens it again');

select test.ok((select n = 3 from public.care_attention() where patient_id = :'pg1' and code = 'abnormal_labs'), 'attention counts the abnormal laboratory tests');
select test.ok((select n = 3 from public.care_attention() where patient_id = :'pg1' and code = 'overdue'), 'attention counts what is overdue (a recall, a reminder, a test request)');
select test.ok((select n = 2 from public.care_attention() where patient_id = :'pg1' and code = 'unreviewed'), 'attention counts a doctor note and a doctor''s addition not yet reviewed');
select test.ok((select n = 1 from public.care_attention() where patient_id = :'pg1' and code = 'expiring_shares'), 'attention counts a share ending within 72 hours, not a later one');
select test.ok((select n = 1 from public.care_attention() where patient_id = :'pg1' and code = 'drafts'), 'attention counts unsigned notes as drafts');
select public.share_revoke((:'sh1'::jsonb ->> 'share_id')::uuid, 'done');
select public.share_mark_note_reviewed((select id from public.share_notes where patient_id = :'pg1' limit 1));
select test.ok((select count(*) = 0 from public.care_attention() where patient_id = :'pg1' and code = 'expiring_shares'), 'a revoked share is not expiring');
select test.ok((select n = 1 from public.care_attention() where patient_id = :'pg1' and code = 'unreviewed'), 'reviewing a note lowers the count');
select test.as_user(:'bob'::uuid);
select test.ok((select count(*) = 0 from public.care_attention() where patient_id = :'pg1'), 'another account sees no indicator of this file');
select test.as_user(:'dave'::uuid);
select test.ok((select n = 4 from public.care_attention() where patient_id = :'pa' and code = 'overdue'), 'a read-only member sees the indicators of the file it can read');
select test.as_anon();
select test.throws($$select * from public.care_attention()$$, 'permission denied', 'anonymous callers cannot read the indicators');
select test.as_super();

-- ============================================================================================================ 2. the emergency card
select test.as_user(:'alice'::uuid);
select public.create_patient('Emergency Patient', date '1960-09-09', 'male', null, null, 'A', '+', '+966500000099', 'private@example.test', 'self', true) as pe \gset
select test.as_user(:'bob'::uuid);
select public.create_patient('Bob Emergency', date '1971-01-01', 'female', null, null, 'O', '-', '+966500000077', null, 'self', true) as pe2 \gset
insert into public.allergies (patient_id, substance, severity) values (:'pe2', 'Bob-only dust', 'mild');
insert into public.conditions (patient_id, name, category) values (:'pe2', 'Bob-only asthma', 'chronic');
insert into public.emergency_contacts (patient_id, full_name, relation, phone) values (:'pe2', 'Bob Contact', 'wife', '+966511111111');
select public.emergency_enable(:'pe2') as tokb \gset

select test.as_user(:'alice'::uuid);
insert into public.allergies (patient_id, substance, severity, reaction) values (:'pe', 'Penicillin', 'severe', 'anaphylaxis');
insert into public.allergies (patient_id, substance, severity, certainty) values (:'pe', 'Latex refuted', 'mild', 'refuted');
insert into public.allergies (patient_id, substance, severity, status) values (:'pe', 'Old resolved allergy', 'mild', 'resolved');
insert into public.conditions (patient_id, name, category, severity) values (:'pe', 'Hypertension', 'chronic', 'moderate');
insert into public.conditions (patient_id, name, category, sensitive) values (:'pe', 'Secret condition', 'chronic', true);
insert into public.conditions (patient_id, name, category) values (:'pe', 'Seasonal flu', 'acute');
insert into public.conditions (patient_id, name, category, certainty) values (:'pe', 'Refuted epilepsy', 'chronic', 'refuted');
insert into public.medications (patient_id, name_generic, strength, dose, frequency, long_term) values (:'pe', 'Metformin', '500 mg', '1 tablet', 'twice a day', true);
insert into public.medications (patient_id, name_generic, long_term) values (:'pe', 'Paracetamol short', false);
insert into public.medications (patient_id, name_generic, long_term, sensitive) values (:'pe', 'Secret medicine', true, true);
insert into public.medications (patient_id, name_generic, long_term, status, stopped_by) values (:'pe', 'Stopped long medicine', true, 'stopped', 'patient');
insert into public.patient_devices (patient_id, kind, name, mri_safety) values (:'pe', 'pacemaker', 'Dual chamber', 'conditional');
insert into public.patient_devices (patient_id, kind, name, status, removed_on) values (:'pe', 'coronary_stent', 'Removed stent', 'removed', current_date);
insert into public.emergency_contacts (patient_id, full_name, relation, phone, is_legal_representative) values (:'pe', 'Layla Contact', 'wife', '+966522222222', true);
insert into public.patient_insurance (patient_id, provider, policy_number) values (:'pe', 'Private Insurer', 'POL-12345');
insert into public.patient_identifiers (patient_id, id_type, id_value) values (:'pe', 'national_id', '1098765432');
insert into public.clinical_notes (patient_id, kind, title, body, noted_at) values (:'pe', 'patient_note', 'Private note', 'very private text', now());

select test.throws(format($$select public.emergency_regenerate(%L)$$, :'pe'), 'not_enabled', 'there is nothing to regenerate before the link is on');
select test.throws(format($$select public.emergency_disable(%L)$$, :'pe'), 'not_enabled', 'nor to disable');
select public.emergency_enable(:'pe') as tok \gset
select test.ok(length(:'tok') = 32 and :'tok' ~ '^[A-Za-z0-9_-]+$', 'the token is long and url-safe');
select test.as_super();
select test.ok((select enabled and token_hash = app.sha256(:'tok') and not include_sensitive and include_contacts and enabled_at is not null from public.emergency_cards where patient_id = :'pe'),
  'only the SHA-256 of the token is stored; the card starts with no sensitive items and with contacts');
select test.as_user(:'alice'::uuid);
select test.throws(format($$select public.emergency_enable(%L)$$, :'pe'), 'already_enabled', 'turning it on twice is refused: regenerate instead');
select test.throws(format($$select token_hash from public.emergency_cards where patient_id = %L$$, :'pe'), 'permission denied', 'the owner cannot read the hash column either');
select test.ok((select enabled and include_contacts from public.emergency_cards where patient_id = :'pe'), 'the owner reads the card settings');
select test.throws(format($$update public.emergency_cards set enabled = false where patient_id = %L$$, :'pe'), 'permission denied', 'settings are written only through the functions');
select test.throws(format($$insert into public.emergency_cards (patient_id, enabled, token_hash) values (%L, true, '\x0102'::bytea)$$, :'pa'), 'permission denied', 'nor inserted');
select test.ok((select count(*) = 1 from public.audit_logs where table_name = 'emergency_cards' and patient_id = :'pe' and action = 'insert' and new_data ->> 'token_hash' = '[redacted]'),
  'turning it on is audited and the hash is redacted in the log');
select test.ok((select not exists (select 1 from public.audit_logs where patient_id = :'pe' and (coalesce(new_data::text, '') like '%' || :'tok' || '%' or coalesce(old_data::text, '') like '%' || :'tok' || '%'))), 'the token is nowhere in the audit log');

-- what the public link shows
select test.as_service();
select public.emergency_view(:'tok', 'ip-a', 'ua') as v \gset
select test.ok((:'v'::jsonb ->> 'status') = 'ok', 'the link opens the card');
select test.ok((select array_agg(k order by k) = (select array_agg(w order by w) from unnest(array['allergies', 'assertions', 'conditions', 'contacts', 'devices', 'include_sensitive', 'medications', 'patient']) w)
                  from jsonb_object_keys((:'v'::jsonb) -> 'card') k), 'the card has exactly these sections');
select test.ok((select array_agg(k order by k) = (select array_agg(w order by w) from unnest(array['allergy_assertion', 'blood_abo', 'blood_group_verified', 'blood_rh', 'date_of_birth', 'full_name', 'full_name_en', 'sex']) w)
                  from jsonb_object_keys((:'v'::jsonb) -> 'card' -> 'patient') k), 'the patient block has no phone, e-mail, address, MRN, id or nationality');
select test.ok((:'v'::jsonb) -> 'card' -> 'patient' ->> 'full_name' = 'Emergency Patient' and (:'v'::jsonb) -> 'card' -> 'patient' ->> 'blood_abo' = 'A' and (:'v'::jsonb) -> 'card' -> 'patient' ->> 'blood_rh' = '+', 'name and blood group');
select test.ok(jsonb_array_length((:'v'::jsonb) -> 'card' -> 'allergies') = 1 and (:'v'::jsonb) -> 'card' -> 'allergies' -> 0 ->> 'substance' = 'Penicillin'
               and (:'v'::jsonb) -> 'card' -> 'allergies' -> 0 ->> 'reaction' = 'anaphylaxis', 'only the active, un-refuted allergies');
select test.ok(jsonb_array_length((:'v'::jsonb) -> 'card' -> 'conditions') = 1 and (:'v'::jsonb) -> 'card' -> 'conditions' -> 0 ->> 'name' = 'Hypertension',
  'chronic conditions only: no acute one, no refuted one, no sensitive one');
select test.ok(jsonb_array_length((:'v'::jsonb) -> 'card' -> 'medications') = 1 and (:'v'::jsonb) -> 'card' -> 'medications' -> 0 ->> 'name' = 'Metformin',
  'long-term medicines only: no short course, no stopped one, no sensitive one');
select test.ok(jsonb_array_length((:'v'::jsonb) -> 'card' -> 'devices') = 1 and (:'v'::jsonb) -> 'card' -> 'devices' -> 0 ->> 'kind' = 'pacemaker', 'devices in place only');
select test.ok(jsonb_array_length((:'v'::jsonb) -> 'card' -> 'contacts') = 1 and (:'v'::jsonb) -> 'card' -> 'contacts' -> 0 ->> 'phone' = '+966522222222', 'the emergency contacts');
select test.ok((select bool_and(position(w in (:'v'::jsonb)::text) = 0) from unnest(array['Secret', 'Seasonal', 'Latex', 'epilepsy', 'Paracetamol', 'Stopped', 'Removed stent', 'Old resolved',
  '966500000099', 'private@example.test', 'POL-12345', '1098765432', 'very private', 'Private note', 'Private Insurer', 'SH-0', 'Bob-only', 'Bob Contact', 'Bob Emergency']) w),
  'nothing sensitive, private or belonging to another file is in the answer');
select test.ok(not ((:'v'::jsonb) ? 'id') and not exists (select 1 from jsonb_each((:'v'::jsonb) -> 'card') e where jsonb_typeof(e.value) = 'array' and e.value::text like '%"id"%'), 'no record ids are exposed');
select test.ok((select count(*) = 1 from public.emergency_access_logs where patient_id = :'pe' and event = 'viewed' and ip_hash = 'ip-a'), 'the view is logged');
select test.as_user(:'alice'::uuid);
select test.ok(public.emergency_preview(:'pe') = ((:'v'::jsonb) -> 'card'), 'the owner''s own page shows exactly what the link shows');
select test.as_user(:'bob'::uuid);
select test.throws(format($$select public.emergency_preview(%L)$$, :'pe'), 'forbidden', 'another account cannot preview the card');
select test.as_anon();
select test.throws(format($$select public.emergency_preview(%L)$$, :'pe'), 'permission denied', 'nor an anonymous caller');
select test.as_service();

-- another patient's token shows only that patient
select public.emergency_view(:'tokb', 'ip-a', 'ua') as vb \gset
select test.ok((:'vb'::jsonb -> 'card' -> 'patient' ->> 'full_name') = 'Bob Emergency' and (:'vb'::jsonb)::text like '%Bob-only dust%' and (:'vb'::jsonb)::text not like '%Penicillin%'
               and (:'vb'::jsonb)::text not like '%Emergency Patient%', 'each token opens its own patient only');

-- opt-in for sensitive items, and the contacts switch
select test.as_user(:'alice'::uuid);
select public.emergency_set_options(:'pe', true, false);
select test.as_service();
select public.emergency_view(:'tok', 'ip-a', 'ua') as v2 \gset
select test.ok(jsonb_array_length((:'v2'::jsonb) -> 'card' -> 'conditions') = 2 and (:'v2'::jsonb)::text like '%Secret condition%' and (:'v2'::jsonb)::text like '%Secret medicine%'
               and (:'v2'::jsonb) -> 'card' -> 'include_sensitive' = 'true'::jsonb, 'with the patient''s opt-in the sensitive items appear');
select test.ok(jsonb_array_length((:'v2'::jsonb) -> 'card' -> 'contacts') = 0 and (:'v2'::jsonb)::text not like '%966522222222%', 'with contacts off no contact is shown');
select test.as_user(:'alice'::uuid);
select public.emergency_set_options(:'pe', false, true);
select test.as_service();
select test.ok((select public.emergency_view(:'tok', 'ip-a', 'ua')::text not like '%Secret%'), 'turning the opt-in off hides them again at once');

-- wrong, disabled and regenerated links all look the same
select public.emergency_view('not-a-real-token-not-a-real-token', 'ip-b', 'ua') as vbad \gset
select test.ok((:'vbad'::jsonb) = '{"status": "unavailable"}'::jsonb, 'an unknown token answers "unavailable" and nothing else');
select test.as_user(:'alice'::uuid);
select public.emergency_regenerate(:'pe') as tok2 \gset
select test.as_super();
select test.ok(:'tok2' <> :'tok' and (select token_hash = app.sha256(:'tok2') and regenerated_at is not null from public.emergency_cards where patient_id = :'pe'), 'a new token replaces the old hash');
select test.as_user(:'alice'::uuid);
select test.as_service();
select test.ok(public.emergency_view(:'tok', 'ip-b', 'ua') = '{"status": "unavailable"}'::jsonb, 'the old link stops working at once');
select test.ok((public.emergency_view(:'tok2', 'ip-b', 'ua') ->> 'status') = 'ok', 'the new one works');
select test.as_user(:'alice'::uuid);
select test.ok(public.emergency_token_ok(:'pe', :'tok2') and not public.emergency_token_ok(:'pe', :'tok'), 'the printable card can tell the current token from an old one');
select public.emergency_disable(:'pe');
select test.as_service();
select test.ok(public.emergency_view(:'tok2', 'ip-b', 'ua') = '{"status": "unavailable"}'::jsonb, 'a disabled card answers exactly like an unknown one');
select test.ok((select count(*) = 1 from public.emergency_access_logs where patient_id = :'pe' and event = 'blocked'), 'a try on the disabled link is logged');
select test.as_user(:'alice'::uuid);
select test.ok((select count(*) = 1 from public.emergency_access_logs where patient_id = :'pe' and event = 'blocked') and (select count(*) >= 3 from public.emergency_access_logs where patient_id = :'pe' and event = 'viewed'),
  'the owner reads the access log');
select test.throws(format($$select ip_hash from public.emergency_access_logs where patient_id = %L$$, :'pe'), 'permission denied', 'but not the client addresses');
select test.ok(not public.emergency_token_ok(:'pe', :'tok2'), 'a disabled card has no valid token');
select public.emergency_enable(:'pe') as tok3 \gset
select test.ok(:'tok3' <> :'tok2' and :'tok3' <> :'tok', 'turning it on again makes yet another token');
select test.as_service();
select test.ok(public.emergency_view(:'tok2', 'ip-b', 'ua') = '{"status": "unavailable"}'::jsonb and (public.emergency_view(:'tok3', 'ip-b', 'ua') ->> 'status') = 'ok', 'only the newest token works');

-- who may manage it
select test.as_user(:'bob'::uuid);
select test.throws(format($$select public.emergency_enable(%L)$$, :'pe'), 'forbidden', 'another account cannot turn it on');
select test.throws(format($$select public.emergency_disable(%L)$$, :'pe'), 'forbidden', 'nor off');
select test.throws(format($$select public.emergency_regenerate(%L)$$, :'pe'), 'forbidden', 'nor regenerate it');
select test.throws(format($$select public.emergency_set_options(%L, true, true)$$, :'pe'), 'forbidden', 'nor change what it shows');
select test.throws(format($$select public.emergency_token_ok(%L, 'x')$$, :'pe'), 'forbidden', 'nor test a token against it');
select test.ok((select count(*) = 0 from public.emergency_cards where patient_id = :'pe') and (select count(*) = 0 from public.emergency_access_logs where patient_id = :'pe'), 'nor read its settings or log');
select test.as_super();
insert into public.patient_members (patient_id, user_id, role, can_write, can_share) values (:'pe', :'dave', 'caregiver', true, true);
select test.as_user(:'dave'::uuid);
select test.throws(format($$select public.emergency_enable(%L)$$, :'pe'), 'forbidden', 'a caregiver with write and share rights still cannot manage the card');
select test.ok((select count(*) = 0 from public.emergency_cards where patient_id = :'pe'), 'nor read its settings');
select test.as_anon();
select test.throws(format($$select public.emergency_view(%L, 'x', 'y')$$, :'tok3'), 'permission denied', 'the public function is not callable with the anonymous key');
select test.throws(format($$select public.emergency_enable(%L)$$, :'pe'), 'permission denied', 'nor are the management functions');
select test.as_user(:'alice'::uuid);
select test.throws(format($$select public.emergency_view(%L, 'x', 'y')$$, :'tok3'), 'permission denied', 'a signed-in browser cannot call the public function directly (the web server does)');
select test.as_super();
update public.patient_members set can_write = false, can_share = false where patient_id = :'pe' and user_id = :'dave';

-- rate limit
select test.as_service();
select test.ok((select count(*) filter (where public.emergency_view('wrongwrongwrongwrongwrong1', 'ip-bf', 'ua') ->> 'status' = 'unavailable') = 10 from generate_series(1, 10)), 'ten wrong tries are answered "unavailable"');
select test.ok((public.emergency_view('wrongwrongwrongwrongwrong1', 'ip-bf', 'ua') ->> 'status') = 'throttled', 'the eleventh is throttled');
select test.ok((public.emergency_view(:'tok3', 'ip-bf', 'ua') ->> 'status') = 'throttled', 'and so is the right token from that address');
select test.ok((public.emergency_view(:'tok3', 'ip-other', 'ua') ->> 'status') = 'ok', 'another address is not affected');
select test.ok((select count(*) filter (where public.emergency_view(:'tok3', 'ip-flood', 'ua') ->> 'status' = 'ok') = 60 from generate_series(1, 60)), 'sixty requests from one address are answered');
select test.ok((public.emergency_view(:'tok3', 'ip-flood', 'ua') ->> 'status') = 'throttled', 'the sixty-first is throttled even with the right token');
select test.ok((select count(*) = 60 from public.emergency_attempts where ip_hash = 'ip-flood'), 'the attempts are counted per address');

-- a file pending deletion and the purge
select test.as_user(:'alice'::uuid);
select public.patient_request_deletion(:'pe', 'Emergency Patient');
select test.as_service();
select test.ok(public.emergency_view(:'tok3', 'ip-c', 'ua') = '{"status": "unavailable"}'::jsonb, 'a file scheduled for deletion no longer shows its card');
select test.as_user(:'alice'::uuid);
select test.throws(format($$select public.emergency_regenerate(%L)$$, :'pe'), 'forbidden', 'and its card cannot be changed meanwhile');
select public.patient_cancel_deletion(:'pe');
select test.as_service();
select test.ok((public.emergency_view(:'tok3', 'ip-c', 'ua') ->> 'status') = 'ok', 'restoring the file restores the card');
select test.as_user(:'alice'::uuid);
insert into public.care_reminders (patient_id, title, due_on) values (:'pe', 'Purge me', current_date);
select public.member_invite_create(:'pe', 'purge@example.test', 'viewer') as tok_purge \gset
select public.patient_request_deletion(:'pe', 'Emergency Patient');
select test.as_service();
select public.patient_purge(:'pe', true);
select test.ok((select count(*) = 0 from public.emergency_cards where patient_id = :'pe') and (select count(*) = 0 from public.emergency_access_logs where patient_id = :'pe')
               and (select count(*) = 0 from public.care_reminders where patient_id = :'pe') and (select count(*) = 0 from public.patient_invites where patient_id = :'pe'),
  'erasing a file erases its card, access log, reminders and invites');
select test.ok(public.emergency_view(:'tok3', 'ip-c', 'ua') = '{"status": "unavailable"}'::jsonb, 'and its link is gone');

-- the export carries the reminders but no secret
select test.as_user(:'alice'::uuid);
select public.patient_export_data(:'pa') as ex \gset
select test.ok((:'ex'::jsonb) ? 'care_reminders' and not ((:'ex'::jsonb) ? 'emergency_cards') and not ((:'ex'::jsonb) ? 'patient_invites') and not ((:'ex'::jsonb) ? 'emergency_access_logs'),
  'the export includes the reminders and leaves out invites and emergency links');

-- ============================================================================================================ 4. members by invite
select test.as_user(:'alice'::uuid);
select public.member_invite_create(:'pa', ' Erin@Example.Test ', 'editor') as ti_erin \gset
select public.member_invite_create(:'pa', 'frank@example.test', 'viewer') as ti_frank \gset
select test.ok(length(:'ti_erin') = 32 and :'ti_erin' <> :'ti_frank', 'an invite is a one-time token');
select test.as_super();
select test.ok((select invited_email = 'erin@example.test' and access = 'editor' and token_hash = app.sha256(:'ti_erin') and expires_at - created_at = interval '7 days'
                  and accepted_at is null and revoked_at is null and created_by = :'alice'::uuid from public.patient_invites where patient_id = :'pa' and invited_email like 'erin%'),
  'the e-mail is normalised, only the hash is stored, and it lasts 7 days');
select test.as_user(:'alice'::uuid);
select test.ok((select not exists (select 1 from public.audit_logs where table_name = 'patient_invites' and patient_id = :'pa' and (new_data::text like '%' || :'ti_erin' || '%'))
                       and count(*) filter (where new_data ->> 'token_hash' = '[redacted]') = 2 from public.audit_logs where table_name = 'patient_invites' and patient_id = :'pa'),
  'invites are audited with the hash redacted and the token nowhere');
select test.throws(format($$select token_hash from public.patient_invites where patient_id = %L$$, :'pa'), 'permission denied', 'the owner cannot read the hash of an invite');
select test.ok((select count(*) = 2 from public.patient_invites where patient_id = :'pa'), 'the owner lists the pending invites');
select test.throws(format($$select public.member_invite_create(%L, 'not-an-email', 'viewer')$$, :'pa'), 'invalid_email', 'a bad address is refused');
select test.throws(format($$select public.member_invite_create(%L, 'x@example.test', 'owner')$$, :'pa'), 'invalid access', 'only viewer or editor can be offered');
select test.throws(format($$select public.member_invite_create(%L, 'alice@example.test', 'viewer')$$, :'pa'), 'already_member', 'an existing member cannot be invited');
select test.throws(format($$insert into public.patient_invites (patient_id, invited_email, access, token_hash, expires_at) values (%L, 'x@example.test', 'viewer', '\x0102'::bytea, now() + interval '1 day')$$, :'pa'),
  'permission denied', 'invites are written only through the functions');
-- a second invite to the same address replaces the first
select public.member_invite_create(:'pa', 'frank@example.test', 'viewer') as ti_frank2 \gset
select test.ok((select count(*) = 1 from public.patient_invites where patient_id = :'pa' and invited_email = 'frank@example.test' and revoked_at is null and accepted_at is null)
               and (select count(*) = 1 from public.patient_invites where patient_id = :'pa' and invited_email = 'frank@example.test' and revoked_at is not null), 'a new invite to the same address revokes the one still waiting');
select test.as_user(:'frank'::uuid);
select test.throws(format($$select public.member_invite_accept(%L)$$, :'ti_frank'), 'invite_unavailable', 'the replaced token no longer works');
select test.ok((public.member_invite_preview(:'ti_frank') ->> 'status') = 'unavailable', 'nor previews');

-- the wrong account cannot use a link
select test.as_user(:'frank'::uuid);
select test.ok((public.member_invite_preview(:'ti_erin') = '{"status": "email_mismatch"}'::jsonb), 'the preview for another account shows nothing about the file');
select test.throws(format($$select public.member_invite_accept(%L)$$, :'ti_erin'), 'email_mismatch', 'an invite is only for the address it was written for');
select test.ok((select count(*) = 0 from public.patients where id = :'pa'), 'and grants nothing');
select test.as_user(:'bob'::uuid);
select test.throws(format($$select public.member_invite_accept(%L)$$, :'ti_erin'), 'email_mismatch', 'a stranger holding the token gets nothing');
select test.throws(format($$select public.member_invite_accept('short')$$), 'invite_unavailable', 'a malformed token is refused');
select test.as_anon();
select test.throws(format($$select public.member_invite_accept(%L)$$, :'ti_erin'), 'permission denied', 'a signed-out caller cannot accept');
select test.as_user(:'alice'::uuid);
select test.ok((public.member_invite_preview(:'ti_erin') ->> 'status') = 'email_mismatch', 'not even the owner previews it');

-- the editor accepts
select test.as_user(:'erin'::uuid);
select test.ok((public.member_invite_preview(:'ti_erin') ->> 'status') = 'ok' and (public.member_invite_preview(:'ti_erin') ->> 'access') = 'editor'
               and (public.member_invite_preview(:'ti_erin') ->> 'patient_name') = 'Care Patient', 'the invited account sees what it is being invited to');
select test.ok((select count(*) = 0 from public.patients where id = :'pa'), 'before accepting there is no access');
select public.member_invite_accept(:'ti_erin') as accepted \gset
select test.ok(:'accepted' = :'pa', 'accepting returns the file');
select test.ok((select role = 'caregiver' and can_write and not can_share and invited_by = :'alice'::uuid and revoked_at is null from public.patient_members where patient_id = :'pa' and user_id = :'erin'),
  'an editor is a caregiver who can write but not share');
select test.ok((select count(*) = 1 from public.patients where id = :'pa'), 'the editor reads the file');
insert into public.conditions (patient_id, name, category) values (:'pa', 'Added by the editor', 'chronic');
select test.ok((select recorded_by = :'erin'::uuid from public.conditions where patient_id = :'pa' and name = 'Added by the editor'), 'and writes records under their own name');
select test.as_super();
select test.ok((select count(*) = 1 from public.audit_logs where table_name = 'patient_members' and patient_id = :'pa' and action = 'insert' and actor_id = :'erin'::uuid), 'the membership is audited');
select test.as_user(:'erin'::uuid);
select test.throws(format($$select public.member_invite_accept(%L)$$, :'ti_erin'), 'invite_unavailable', 'a used link cannot be used again');
select test.ok((public.member_invite_preview(:'ti_erin') ->> 'status') = 'unavailable', 'nor previewed');

-- an invitee cannot escalate
select test.throws(format($$update public.patient_members set role = 'owner' where patient_id = %L and user_id = %L$$, :'pa', :'erin'), 'permission denied', 'a member cannot rewrite its own role');
select test.throws(format($$update public.patient_members set can_share = true where patient_id = %L and user_id = %L$$, :'pa', :'erin'), 'permission denied', 'nor its rights');
select test.throws(format($$insert into public.patient_members (patient_id, user_id, role, can_write, can_share) values (%L, %L, 'owner', true, true)$$, :'pb', :'erin'), 'permission denied', 'nor add itself to another file');
select test.throws(format($$delete from public.patient_members where patient_id = %L$$, :'pa'), 'permission denied', 'nor delete members');
select test.throws(format($$select public.member_invite_create(%L, 'friend@example.test', 'editor')$$, :'pa'), 'forbidden', 'an editor cannot invite anyone');
select test.throws(format($$select public.member_revoke(%L, %L)$$, :'pa', :'alice'), 'forbidden', 'nor revoke anyone');
select test.throws(format($$select public.member_list(%L)$$, :'pa'), 'forbidden', 'nor list the members');
select test.throws(format($$select public.emergency_enable(%L)$$, :'pa'), 'forbidden', 'nor turn on the emergency card');
select test.throws(format($$select public.share_create(p_patient => %L, p_title => 'Sneaky', p_scope_kind => 'full', p_clinician => '{"name":"Dr Sneak"}')$$, :'pa'), 'forbidden', 'nor share the file');
select test.throws(format($$select public.patient_request_deletion(%L, 'Care Patient')$$, :'pa'), 'forbidden', 'nor delete it');
select test.ok((select count(*) = 0 from public.audit_logs where patient_id = :'pa') and (select count(*) = 0 from public.patient_invites where patient_id = :'pa'), 'nor read the audit log or the invites');
select test.ok((select count(*) = 1 from public.patient_members where patient_id = :'pa'), 'a member sees only its own membership row');
select test.ok((select count(*) = 0 from public.patients where id = :'pb'), 'and no other file');

-- the viewer
select test.as_user(:'alice'::uuid);
select public.member_invite_create(:'pa', 'frank@example.test', 'viewer') as ti_frank3 \gset
select test.as_user(:'frank'::uuid);
select public.member_invite_accept(:'ti_frank3');
select test.ok((select role = 'caregiver' and not can_write and not can_share from public.patient_members where patient_id = :'pa' and user_id = :'frank'), 'a viewer reads only');
select test.ok((select count(*) >= 1 from public.conditions where patient_id = :'pa'), 'it reads the records');
select test.throws(format($$insert into public.conditions (patient_id, name, category) values (%L, 'Viewer write', 'chronic')$$, :'pa'), 'row-level security|permission', 'but cannot write');
select test.throws(format($$insert into public.care_reminders (patient_id, title, due_on) values (%L, 'Viewer reminder', current_date)$$, :'pa'), 'row-level security|permission', 'nor add a reminder');
select test.throws(format($$update public.patient_members set can_write = true where patient_id = %L and user_id = %L$$, :'pa', :'frank'), 'permission denied', 'nor upgrade itself');
select test.throws(format($$select public.member_invite_create(%L, 'friend@example.test', 'viewer')$$, :'pa'), 'forbidden', 'nor invite');
select test.throws(format($$select public.member_invite_accept(%L)$$, :'ti_frank3'), 'invite_unavailable', 'its own used token does not upgrade it');
select test.ok((select count(*) > 0 from public.care_reminder_feed(:'pa')), 'the viewer sees the reminders of the file');

-- the owner lists and revokes
select test.as_user(:'alice'::uuid);
select public.member_list(:'pa') as ml \gset
select test.ok(jsonb_array_length(:'ml'::jsonb) = 4, 'the owner lists all members');
select test.ok((select bool_or(e ->> 'email' = 'erin@example.test' and e ->> 'full_name' = 'Erin Editor' and (e ->> 'can_write')::boolean and e ->> 'role' = 'caregiver')
                  and bool_or(e ->> 'email' = 'alice@example.test' and e ->> 'role' = 'owner') from jsonb_array_elements(:'ml'::jsonb) e), 'with names, e-mail addresses, roles and rights');
select test.throws(format($$select public.member_revoke(%L, %L)$$, :'pa', :'alice'), 'cannot_revoke_manager', 'the owner cannot be revoked (nor revoke itself)');
select test.throws(format($$select public.member_revoke(%L, %L)$$, :'pa', :'bob'), 'not_found', 'only members can be revoked');
select test.as_user(:'bob'::uuid);
select test.throws(format($$select public.member_revoke(%L, %L)$$, :'pa', :'erin'), 'forbidden', 'another account cannot revoke');
select test.throws(format($$select public.member_list(%L)$$, :'pa'), 'forbidden', 'nor list');
select test.as_user(:'alice'::uuid);
select public.member_revoke(:'pa', :'erin'::uuid);
select test.as_user(:'erin'::uuid);
select test.ok((select count(*) = 0 from public.patients where id = :'pa'), 'a revoked member loses the file at once');
select test.ok((select count(*) = 0 from public.conditions where patient_id = :'pa') and (select count(*) = 0 from public.care_reminder_feed(:'pa')), 'and every record');
select test.throws(format($$insert into public.conditions (patient_id, name, category) values (%L, 'After revoke', 'chronic')$$, :'pa'), 'row-level security|permission', 'cannot write any more');
select test.ok(not app.has_patient_access(:'pa'::uuid, 'read'), 'the access check says no');
select test.throws(format($$select public.member_leave(%L)$$, :'pa'), 'not_found', 'and there is nothing left to leave');
select test.as_user(:'alice'::uuid);
select test.ok((select (e ->> 'revoked_at') is not null from jsonb_array_elements(public.member_list(:'pa')) e where e ->> 'email' = 'erin@example.test'), 'the list shows the revoked member');
-- invited again: access returns with the new level
select public.member_invite_create(:'pa', 'erin@example.test', 'viewer') as ti_erin2 \gset
select test.as_user(:'erin'::uuid);
select public.member_invite_accept(:'ti_erin2');
select test.ok((select count(*) = 1 from public.patients where id = :'pa') and (select not can_write and revoked_at is null from public.patient_members where patient_id = :'pa' and user_id = :'erin'), 'a revoked member invited again comes back with the new level (viewer)');

-- an invite expires after 7 days, and can be revoked before it is used
select test.as_user(:'alice'::uuid);
select public.member_invite_create(:'pa', 'late@example.test', 'viewer') as ti_late \gset
select public.member_invite_create(:'pa', 'gone@example.test', 'viewer') as ti_gone \gset
select test.as_super();
insert into auth.users (id, email) values ('11111111-aaaa-aaaa-aaaa-111111111111', 'late@example.test'), ('22222222-aaaa-aaaa-aaaa-222222222222', 'gone@example.test');
update public.patient_invites set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where invited_email = 'late@example.test' and patient_id = :'pa';
select test.as_user('11111111-aaaa-aaaa-aaaa-111111111111'::uuid);
select test.ok((public.member_invite_preview(:'ti_late') ->> 'status') = 'unavailable', 'an expired invite is unavailable');
select test.throws(format($$select public.member_invite_accept(%L)$$, :'ti_late'), 'invite_unavailable', 'and cannot be accepted');
select test.as_user(:'alice'::uuid);
select public.member_invite_revoke((select id from public.patient_invites where invited_email = 'gone@example.test' and patient_id = :'pa'));
select test.as_user('22222222-aaaa-aaaa-aaaa-222222222222'::uuid);
select test.throws(format($$select public.member_invite_accept(%L)$$, :'ti_gone'), 'invite_unavailable', 'a revoked invite cannot be accepted');
select test.as_user(:'alice'::uuid);
select test.throws(format($$select public.member_invite_revoke((select id from public.patient_invites where invited_email = 'gone@example.test' and patient_id = %L))$$, :'pa'), 'invite_unavailable', 'a revoked invite cannot be revoked twice');
select test.as_user(:'bob'::uuid);
select test.throws(format($$select public.member_invite_revoke((select id from public.patient_invites where invited_email = 'late@example.test' and patient_id = %L))$$, :'pa'), 'forbidden', 'another account cannot revoke an invite');

-- a token for one file never opens another
select test.as_user(:'bob'::uuid);
select public.member_invite_create(:'pb', 'erin@example.test', 'editor') as ti_pb \gset
select test.as_user(:'erin'::uuid);
select test.ok((select count(*) = 0 from public.patients where id = :'pb'), 'the invite to the first file gave nothing of the second');
select public.member_invite_accept(:'ti_pb');
select test.ok((select count(*) = 1 from public.patients where id = :'pb'), 'the second invite opens the second file');
select test.throws(format($$select public.member_invite_accept(%L)$$, :'ti_pb'), 'invite_unavailable', 'and only once');

-- leaving
select test.as_user(:'frank'::uuid);
select public.member_leave(:'pa');
select test.ok((select count(*) = 0 from public.patients where id = :'pa'), 'a member who leaves loses the file');
select test.as_user(:'alice'::uuid);
select test.throws(format($$select public.member_leave(%L)$$, :'pa'), 'not_found', 'an owner cannot leave its own file');

-- an invite cannot be accepted for a file scheduled for deletion
select public.member_invite_create(:'pa2', 'frank@example.test', 'viewer') as ti_del \gset
select public.patient_request_deletion(:'pa2', 'Care Second File');
select test.as_user(:'frank'::uuid);
select test.ok((public.member_invite_preview(:'ti_del') ->> 'status') = 'unavailable', 'a file scheduled for deletion cannot be joined');
select test.throws(format($$select public.member_invite_accept(%L)$$, :'ti_del'), 'invite_unavailable', 'accepting is refused too');
select test.as_user(:'alice'::uuid);
select test.throws(format($$select public.member_invite_create(%L, 'new@example.test', 'viewer')$$, :'pa2'), 'forbidden', 'and no new invite is written meanwhile');
select public.patient_cancel_deletion(:'pa2');
select test.as_super();
