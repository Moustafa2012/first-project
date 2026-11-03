\pset tuples_only on
\set alice 'a1111111-1111-1111-1111-111111111111'
\set bob 'b2222222-2222-2222-2222-222222222222'
\set dave 'd4444444-4444-4444-4444-444444444444'
select v as pa from test.ctx where k = 'pa' \gset
select v as pb from test.ctx where k = 'pb' \gset
select v as pchild from test.ctx where k = 'pchild' \gset
select id as t_bp from public.observation_types where code = 'blood_pressure' \gset
select id as t_glu from public.observation_types where code = 'blood_glucose' \gset
select id as t_hr from public.observation_types where code = 'heart_rate' \gset
select id as t_hb from public.observation_types where code = 'hemoglobin' \gset
select id as t_urine from public.observation_types where code = 'urine_protein' \gset
select id as t_temp from public.observation_types where code = 'body_temperature' \gset

select test.as_user(:'alice'::uuid);

-- ---------------------------------------------------------------- vitals: validation + screening
insert into public.observations (patient_id, type_id, value_num, value_num2, effective_at, context)
  values (:'pa', :'t_bp', 132, 86, now() - interval '3 days', 'left_arm') returning id as o_bp1 \gset
select test.ok((select interpretation from public.observations where id = :'o_bp1') = 'high', 'BP 132/86 screens as high');
select test.ok((select interpretation_basis from public.observations where id = :'o_bp1') = 'screening_rule', 'BP interpretation basis recorded');
insert into public.observations (patient_id, type_id, value_num, value_num2, effective_at) values (:'pa', :'t_bp', 116, 74, now() - interval '2 days') returning id as o_bp2 \gset
select test.ok((select interpretation from public.observations where id = :'o_bp2') = 'normal', 'BP 116/74 screens as normal');
insert into public.observations (patient_id, type_id, value_num, value_num2, effective_at) values (:'pa', :'t_bp', 185, 95, now() - interval '1 day') returning id as o_bp3 \gset
select test.ok((select interpretation from public.observations where id = :'o_bp3') = 'critical_high', 'BP 185/95 screens as critical_high (needs assessment)');
select test.ok((select unit from public.observations where id = :'o_bp3') = 'mmHg', 'unit defaults from the catalog');
select test.throws(format($$insert into public.observations (patient_id, type_id, value_num, value_num2, effective_at) values (%L, %L, 80, 120, now())$$, :'pa', :'t_bp'),
  'systolic must be greater', 'systolic must exceed diastolic');
select test.throws(format($$insert into public.observations (patient_id, type_id, value_num, effective_at) values (%L, %L, 120, now())$$, :'pa', :'t_bp'),
  'systolic and diastolic together', 'BP needs both components together');
select test.throws(format($$insert into public.observations (patient_id, type_id, value_num, value_num2, effective_at) values (%L, %L, 520, 90, now())$$, :'pa', :'t_bp'),
  'plausible', 'implausible systolic rejected');
select test.throws(format($$insert into public.observations (patient_id, type_id, value_num, effective_at) values (%L, %L, 90, now() + interval '2 days')$$, :'pa', :'t_hr'),
  'future', 'future measurement time rejected');
select test.throws(format($$insert into public.observations (patient_id, type_id, value_num, unit, effective_at) values (%L, %L, 90, 'furlongs', now())$$, :'pa', :'t_hr'),
  'unsupported unit', 'unknown unit rejected');
select test.throws(format($$insert into public.observations (patient_id, type_id, effective_at) values (%L, %L, now())$$, :'pa', :'t_glu'),
  'check constraint|value is required|numeric value', 'a result needs a value');

insert into public.observations (patient_id, type_id, value_num, effective_at, context) values (:'pa', :'t_glu', 110, now() - interval '5 days', 'fasting') returning id as o_g1 \gset
select test.ok((select interpretation from public.observations where id = :'o_g1') = 'borderline', 'fasting glucose 110 mg/dL is borderline');
insert into public.observations (patient_id, type_id, value_num, unit, effective_at, context) values (:'pa', :'t_glu', 5.5, 'mmol/L', now() - interval '4 days', 'fasting') returning id as o_g2 \gset
select test.ok((select interpretation from public.observations where id = :'o_g2') = 'normal', 'fasting glucose 5.5 mmol/L is converted for the rule (normal)');
select test.ok((select unit from public.observations where id = :'o_g2') = 'mmol/L' and (select value_num from public.observations where id = :'o_g2') = 5.5, 'stored value and unit are never rewritten');
insert into public.observations (patient_id, type_id, value_num, effective_at, context) values (:'pa', :'t_glu', 210, now() - interval '3 days', 'post_meal_2h') returning id as o_g3 \gset
select test.ok((select interpretation from public.observations where id = :'o_g3') = 'high', 'post-meal glucose 210 is high');
insert into public.observations (patient_id, type_id, value_num, effective_at) values (:'pa', :'t_glu', 118, now() - interval '2 days') returning id as o_g4 \gset
select test.ok((select interpretation from public.observations where id = :'o_g4') = 'not_assessed', 'glucose without context is not over-interpreted');
insert into public.observations (patient_id, type_id, value_num, effective_at) values (:'pa', :'t_glu', 48, now() - interval '1 day') returning id as o_g5 \gset
select test.ok((select interpretation from public.observations where id = :'o_g5') = 'critical_low', 'glucose 48 is flagged even without context');

insert into public.observations (patient_id, type_id, value_num, effective_at, context) values (:'pa', :'t_hr', 150, now() - interval '1 day', 'after_exercise') returning id as o_hr \gset
select test.ok((select interpretation from public.observations where id = :'o_hr') = 'not_assessed', 'post-exercise pulse is not judged by resting thresholds');
insert into public.observations (patient_id, type_id, value_num, effective_at, context) values (:'pa', :'t_hr', 72, now() - interval '1 day', 'resting') returning id as o_hr2 \gset
select test.ok((select interpretation from public.observations where id = :'o_hr2') = 'normal', 'resting pulse 72 is normal');

-- ---------------------------------------------------------------- labs: own reference range, text results
insert into public.lab_reports (patient_id, title, lab_name, collected_at, approved_at, status)
  values (:'pa', 'CBC', 'Central Lab', now() - interval '10 days', now() - interval '9 days', 'final') returning id as rep \gset
insert into public.observations (patient_id, type_id, report_id, value_num, unit, effective_at, setting, ref_low, ref_high, source)
  values (:'pa', :'t_hb', :'rep', 10.2, 'g/dL', now() - interval '10 days', 'lab', 12, 16, 'laboratory') returning id as o_hb \gset
select test.ok((select interpretation from public.observations where id = :'o_hb') = 'low', 'lab value below the lab reference range is low');
select test.ok((select interpretation_basis from public.observations where id = :'o_hb') = 'lab_reference_range', 'basis is the lab reference range');
insert into public.observations (patient_id, type_id, report_id, value_num, unit, effective_at, setting, ref_low, ref_high)
  values (:'pa', :'t_hb', :'rep', 13.1, 'g/dL', now() - interval '3 days', 'lab', 11, 15) returning id as o_hb2 \gset
select test.ok((select interpretation from public.observations where id = :'o_hb2') = 'normal', 'a different lab range is honoured per result');
insert into public.observations (patient_id, type_id, value_text, effective_at, setting) values (:'pa', :'t_urine', 'Trace', now() - interval '2 days', 'lab');
select test.ok(exists (select 1 from public.observations where value_text = 'Trace'), 'qualitative result accepted');
select test.throws(format($$insert into public.observations (patient_id, type_id, value_num, value_num2, effective_at) values (%L, %L, 12, 5, now())$$, :'pa', :'t_hb'),
  'only valid for blood pressure', 'second value only valid for blood pressure');
select test.throws(format($$insert into public.observations (patient_id, type_id, report_id, value_num, effective_at) values (%L, %L, %L, 5, now())$$, :'pa', :'t_hb', gen_random_uuid()),
  '23503', 'report must exist');

-- ---------------------------------------------------------------- immutability + corrections
select test.throws(format($$update public.observations set value_num = 100 where id = %L$$, :'o_hb'), 'cannot be edited', 'approved result value cannot be edited');
select test.throws(format($$update public.observations set unit = 'g/L' where id = %L$$, :'o_hb'), 'cannot be edited', 'approved result unit cannot be edited');
select test.throws(format($$update public.observations set effective_at = now() where id = %L$$, :'o_hb'), 'cannot be edited', 'approved result date cannot be edited');
select test.throws(format($$update public.observations set context = 'random' where id = %L$$, :'o_g1'), 'cannot be edited', 'measurement context of an approved reading cannot be edited');
select test.throws(format($$update public.observations set patient_id = %L where id = %L$$, :'pb', :'o_hb'), 'cannot be edited|permission|row-level|immutable', 'a result cannot be moved to another patient');
select test.throws(format($$update public.observations set status = 'amended' where id = %L$$, :'o_hb'), 'recording a correction', 'cannot self-amend without a correction row');
select test.throws(format($$select public.observation_correct(%L, 11.4, null, null, null, '')$$, :'o_hb'), 'reason is required', 'correction needs a reason');

select public.observation_correct(:'o_hb', 11.4, null, null, 'g/dL', 'Transcription error from the printed report') as o_hb_fix \gset
select test.ok((select status from public.observations where id = :'o_hb') = 'amended', 'original result is kept and marked amended');
select test.ok((select value_num from public.observations where id = :'o_hb') = 10.2, 'original value is preserved');
select test.ok((select supersedes_id from public.observations where id = :'o_hb_fix') = :'o_hb'::uuid, 'correction points at the original');
select test.ok((select status from public.observations where id = :'o_hb_fix') = 'final', 'correction is the new final value');
select test.ok((select interpretation from public.observations where id = :'o_hb_fix') = 'low', 'correction is interpreted with the inherited reference range');
select test.ok((select count(*) from public.observations where patient_id = :'pa' and type_id = :'t_hb') = 3, 'history keeps all versions');
select test.throws(format($$update public.observations set value_num = 1 where id = %L$$, :'o_hb'), 'cannot be edited', 'amended result cannot be edited');
select test.throws(format($$select public.observation_correct(%L, 9, null, null, null, 'again')$$, :'o_hb'), 'only an approved', 'an amended result cannot be corrected again');

select test.throws(format($$update public.observations set status = 'entered_in_error' where id = %L$$, :'o_g4'), 'reason is required', 'entered-in-error needs a reason');
update public.observations set status = 'entered_in_error', amendment_reason = 'wrong patient''s meter' where id = :'o_g4';
select test.ok((select status from public.observations where id = :'o_g4') = 'entered_in_error', 'mistaken result is invalidated, not deleted');
select test.throws(format($$update public.observations set status = 'final' where id = %L$$, :'o_g4'), 'cannot be modified', 'invalidated result cannot be revived');
update public.observations set notes = 'ok' where id = :'o_g1';
select test.ok((select notes from public.observations where id = :'o_g1') = 'ok', 'notes on an approved reading can still be added (audited)');

-- bob cannot correct alice's result
select test.as_user(:'bob'::uuid);
select test.throws(format($$select public.observation_correct(%L, 1, null, null, null, 'x')$$, :'o_hb_fix'), 'not found|P0002', 'bob cannot correct alice result');
select test.as_user(:'alice'::uuid);

-- ---------------------------------------------------------------- provenance
select test.ok((select recorded_by from public.observations where id = :'o_bp1') = :'alice'::uuid, 'recorded_by is stamped from the session');
insert into public.conditions (patient_id, name, category, certainty, recorded_by, verification) values (:'pa', 'Asthma', 'chronic', 'confirmed', :'bob'::uuid, 'verified') returning id as c1 \gset
select test.ok((select recorded_by from public.conditions where id = :'c1') = :'alice'::uuid, 'client cannot spoof recorded_by');
select test.ok((select verification from public.conditions where id = :'c1') = 'reported', 'a patient cannot self-assert clinician verification');
update public.conditions set verification = 'verified' where id = :'c1';
select test.ok((select verification from public.conditions where id = :'c1') = 'reported', 'verification cannot be raised by update either');
select test.throws(format($$update public.conditions set patient_id = %L where id = %L$$, :'pb', :'c1'), 'immutable|row-level|permission', 'condition cannot be moved to another patient');
select test.throws(format($$update public.conditions set recorded_by = %L where id = %L$$, :'bob', :'c1'), 'immutable', 'recorded_by is immutable');

select test.as_service();
insert into public.conditions (patient_id, name, category, certainty, verification, source, source_detail)
  values (:'pa', 'Hypertension', 'chronic', 'confirmed', 'verified', 'hospital', 'City Hospital import') returning id as c2 \gset
select test.ok((select verification from public.conditions where id = :'c2') = 'verified', 'service role (imports) can record verified data');
select test.as_user(:'alice'::uuid);

-- ---------------------------------------------------------------- entered in error for non-observation tables
select test.throws(format($$update public.conditions set record_status = 'entered_in_error' where id = %L$$, :'c1'), 'reason|check', 'invalidation needs a reason');
update public.conditions set record_status = 'entered_in_error', invalidated_reason = 'duplicate entry' where id = :'c1';
select test.ok((select invalidated_by from public.conditions where id = :'c1') = :'alice'::uuid and (select invalidated_at from public.conditions where id = :'c1') is not null, 'invalidation records who and when');
select test.throws(format($$update public.conditions set name = 'x' where id = %L$$, :'c1'), 'cannot be modified', 'invalidated row is frozen');
select test.throws(format($$insert into public.conditions (patient_id, name, record_status, invalidated_reason) values (%L, 'sneaky', 'entered_in_error', 'x')$$, :'pa'), 'must be active', 'cannot create a record that is already invalidated');

-- ---------------------------------------------------------------- allergies assertion
select test.ok((select allergy_assertion from public.patients where id = :'pa') = 'unknown', 'allergy status starts as unknown (not "none")');
update public.patients set allergy_assertion = 'has_allergies' where id = :'pa';
select test.ok((select allergy_assertion_by from public.patients where id = :'pa') = :'alice'::uuid, 'allergy assertion is attributed');
insert into public.allergies (patient_id, substance, category, reaction, severity, certainty) values (:'pa', 'Penicillin', 'medication', 'Anaphylaxis', 'life_threatening', 'confirmed');

-- ---------------------------------------------------------------- medications
select test.throws(format($$insert into public.medications (patient_id, dose) values (%L, '5 mg')$$, :'pa'), 'check constraint', 'medication needs a name');
select test.throws(format($$insert into public.medications (patient_id, name_generic, start_date, end_date) values (%L, 'x', '2024-02-01', '2024-01-01')$$, :'pa'), 'check constraint', 'medication end date must follow start');
insert into public.medications (patient_id, name_generic, name_brand, strength, dose, frequency, origin, status, start_date, prescriber_name)
  values (:'pa', 'Metformin', 'Glucophage', '500 mg', '1 tablet', 'twice daily', 'prescribed', 'active', '2024-01-10', 'Dr. Test');
insert into public.medications (patient_id, name_generic, origin, status, stopped_by, stop_reason, start_date, end_date)
  values (:'pa', 'Amoxicillin', 'prescribed', 'stopped', 'adverse_reaction', 'Rash', '2023-03-01', '2023-03-04');
select test.ok((select count(*) from public.medications where patient_id = :'pa' and status = 'active') = 1, 'active vs stopped medications are distinguished');

-- ---------------------------------------------------------------- specialty forms
select s.id as s_dent from public.medical_specialties s where s.code = 'dentistry' \gset
select s.id as s_card from public.medical_specialties s where s.code = 'cardiology' \gset
-- the generic form engine, exercised with the (since retired) free-text dental form
select test.as_super();
update public.specialty_record_types set is_active = true where code = 'dental_finding';
select test.as_user(:'alice'::uuid);
select t.id as rt_dent from public.specialty_record_types t where t.code = 'dental_finding' \gset
insert into public.specialty_records (patient_id, specialty_id, record_type_id, occurred_on, data)
  values (:'pa', :'s_dent', :'rt_dent', current_date - 30, '{"tooth":"16","finding":"caries","treatment":"Composite filling"}');
select test.ok(exists (select 1 from public.specialty_records where data ->> 'tooth' = '16'), 'dental record stored with specialty-specific fields');
select test.throws(format($$insert into public.specialty_records (patient_id, specialty_id, record_type_id, occurred_on, data) values (%L, %L, %L, current_date, '{"finding":"caries"}')$$, :'pa', :'s_dent', :'rt_dent'), 'is required', 'required specialty field enforced');
select test.throws(format($$insert into public.specialty_records (patient_id, specialty_id, record_type_id, occurred_on, data) values (%L, %L, %L, current_date, '{"tooth":"16","finding":"caries","bogus":1}')$$, :'pa', :'s_dent', :'rt_dent'), 'unknown field', 'unknown specialty field rejected');
select test.throws(format($$insert into public.specialty_records (patient_id, specialty_id, record_type_id, occurred_on, data) values (%L, %L, %L, current_date, '{"tooth":"16","finding":"magic"}')$$, :'pa', :'s_dent', :'rt_dent'), 'invalid option', 'invalid select option rejected');
select test.throws(format($$insert into public.specialty_records (patient_id, specialty_id, record_type_id, occurred_on, data) values (%L, %L, %L, current_date, '{"tooth":"16","finding":"caries"}')$$, :'pa', :'s_card', :'rt_dent'), 'does not belong', 'record type must belong to the specialty');
select test.as_super();
update public.specialty_record_types set is_active = false where code = 'dental_finding';
select test.as_user(:'alice'::uuid);

-- ---------------------------------------------------------------- child file: no adult thresholds
insert into public.observations (patient_id, type_id, value_num, value_num2, effective_at) values (:'pchild', :'t_bp', 150, 95, now() - interval '1 day') returning id as o_child \gset
select test.ok((select interpretation from public.observations where id = :'o_child') = 'not_assessed', 'child readings are not judged by adult thresholds');

-- ---------------------------------------------------------------- audit coverage
select test.as_super();
select test.ok(exists (select 1 from public.audit_logs where table_name = 'observations' and action = 'invalidate' and record_id = :'o_g4'::uuid), 'invalidation of a result is audited');
select test.ok(exists (select 1 from public.audit_logs where table_name = 'observations' and action = 'update' and record_id = :'o_hb'::uuid and changed_fields @> array['status']), 'amendment is audited with changed fields');
select test.ok(exists (select 1 from public.audit_logs where table_name = 'conditions' and record_id = :'c1'::uuid and action = 'invalidate'), 'invalidation of a condition is audited');
select test.ok((select old_data ->> 'status' from public.audit_logs where table_name = 'observations' and record_id = :'o_hb'::uuid and action = 'update' order by id desc limit 1) = 'final', 'audit keeps the previous value');
select test.ok(exists (select 1 from public.audit_logs where table_name = 'observations' and record_id = :'o_bp1'::uuid and actor_id = :'alice'::uuid and action = 'insert'), 'insert is audited with the actor');
