\pset tuples_only on
\set alice 'a1111111-1111-1111-1111-111111111111'
\set bob 'b2222222-2222-2222-2222-222222222222'
select id as s_dent from public.medical_specialties where code = 'dentistry' \gset
select id as t_height from public.observation_types where code = 'height' \gset
select id as t_weight from public.observation_types where code = 'weight' \gset

select test.as_user(:'alice'::uuid);
select public.create_patient('Core Patient', date '1980-06-06', 'female', null, null, null, null, null, null, 'self', true) as pf \gset
select public.create_patient('Core Male', date '1975-01-01', 'male', null, null, null, null, null, null, 'self', true) as pm \gset

-- long-term medications
insert into public.medications (patient_id, name_generic, long_term, status) values (:'pf', 'Warfarin', true, 'active') returning id as med \gset
select test.ok((select long_term from public.medications where id = :'med'), 'a medication can be flagged long-term');

-- devices and implants
insert into public.patient_devices (patient_id, kind, name, implanted_on, date_precision, mri_safety)
  values (:'pf', 'prosthetic_heart_valve', 'Mechanical aortic valve', date '2015-01-01', 'year', 'conditional') returning id as dev \gset
select test.ok((select verification = 'reported' and recorded_by = :'alice'::uuid from public.patient_devices where id = :'dev'), 'a device is recorded with provenance');
select test.throws(format($$insert into public.patient_devices (patient_id, kind) values (%L, 'magic')$$, :'pf'), 'check constraint|violates', 'an unknown device kind is refused');
select test.throws(format($$insert into public.patient_devices (patient_id, kind, status, removed_on) values (%L, 'pacemaker', 'in_place', current_date)$$, :'pf'),
  'check constraint|violates', 'a device still in place has no removal date');
update public.patient_devices set record_status = 'entered_in_error', invalidated_reason = 'test' where id = :'dev';
select test.throws(format($$update public.patient_devices set name = 'x' where id = %L$$, :'dev'), 'entered-in-error', 'an invalidated device cannot be edited');
insert into public.patient_devices (patient_id, kind, name) values (:'pf', 'prosthetic_heart_valve', 'Mechanical aortic valve') returning id as dev2 \gset

-- lifestyle + pregnancy
insert into public.patient_health_profile (patient_id, tobacco_status, tobacco_types, cigarettes_per_day, tobacco_start_year, alcohol_status, pregnancy_status, pregnancy_edd)
  values (:'pf', 'current', array['cigarettes', 'waterpipe'], 10, 2005, 'none', 'pregnant', current_date + 100);
select test.ok((select tobacco_status = 'current' and updated_by = :'alice'::uuid from public.patient_health_profile where patient_id = :'pf'), 'lifestyle and pregnancy are kept per patient');
select test.throws(format($$insert into public.patient_health_profile (patient_id, tobacco_status, cigarettes_per_day) values (%L, 'never', 5)$$, :'pm'),
  'check constraint|violates', 'a never-smoker has no amounts');
select test.throws(format($$insert into public.patient_health_profile (patient_id, tobacco_status, tobacco_quit_year) values (%L, 'current', 2020)$$, :'pm'),
  'check constraint|violates', 'only a former smoker has a quit year');
select test.throws(format($$insert into public.patient_health_profile (patient_id, pregnancy_status) values (%L, 'pregnant')$$, :'pm'),
  'pregnancy_not_applicable', 'pregnancy does not apply to a male patient');
select test.throws(format($$update public.patients set sex = 'male' where id = %L$$, :'pf'), 'pregnancy_recorded', 'a recorded pregnancy blocks changing the sex to male');
select test.throws(format($$insert into public.patient_health_profile (patient_id, pregnancy_status, pregnancy_edd) values (%L, 'not_pregnant', current_date)$$, :'pm'),
  'check constraint|violates', 'a due date only with a pregnancy');

-- highlights are reviewable data, readable by every account, writable by admins only
select test.ok((select count(*) from public.context_highlights where specialty_code = 'dentistry') >= 10, 'dentistry has its highlight rules');
select test.ok((select bool_and(not reviewed_by_clinician) from public.context_highlights), 'seeded highlight rules are marked as not yet clinically reviewed');
select test.throws($$insert into public.context_highlights (source, message_ar, message_en) values ('pregnancy', 'xxx', 'xxx')$$, 'row-level security|permission',
  'an ordinary account cannot change the highlight rules');

-- isolation
select test.as_user(:'bob'::uuid);
select test.ok((select count(*) from public.patient_devices where patient_id = :'pf') = 0 and (select count(*) from public.patient_health_profile where patient_id = :'pf') = 0,
  'another account sees no devices or lifestyle of this patient');
select test.throws(format($$insert into public.patient_devices (patient_id, kind) values (%L, 'pacemaker')$$, :'pf'), 'row-level security|permission',
  'another account cannot add a device');

-- the clinician sees the same core context through a share
select test.as_user(:'alice'::uuid);
insert into public.observations (patient_id, type_id, value_num, unit, effective_at) values (:'pf', :'t_height', 165, 'cm', now() - interval '2 days');
insert into public.observations (patient_id, type_id, value_num, unit, effective_at) values (:'pf', :'t_weight', 70, 'kg', now() - interval '2 days');
insert into public.observations (patient_id, type_id, value_num, unit, effective_at) values (:'pf', :'t_weight', 72, 'kg', now() - interval '1 day');
insert into public.conditions (patient_id, name, category, certainty) values (:'pf', 'Congenital aortic stenosis', 'congenital', 'confirmed');
insert into public.conditions (patient_id, name, category, sensitive) values (:'pf', 'Hidden chronic', 'chronic', true);
select public.share_create(p_patient => :'pf', p_title => 'Dentist', p_scope_kind => 'specialty', p_specialty_ids => array[:'s_dent'::uuid],
  p_expires_at => now() + interval '1 day') as sh \gset
select (:'sh'::jsonb ->> 'token') as tok, (:'sh'::jsonb ->> 'pin') as pin \gset
select test.throws($$select public.share_context('x')$$, 'permission denied|42501', 'an account cannot call share_context');
select test.as_service();
select (public.share_open(:'tok', :'pin', 'ip-core', 'UA') ->> 'session_token') as sess \gset
select public.share_context(:'sess') as ctx \gset
select test.ok((:'ctx'::jsonb -> 'body' -> 'weight' ->> 'value')::numeric = 72 and (:'ctx'::jsonb -> 'body' -> 'height' ->> 'value')::numeric = 165,
  'the clinician sees the latest height and weight');
select test.ok(jsonb_array_length(:'ctx'::jsonb -> 'devices') = 1 and (:'ctx'::jsonb -> 'medications' -> 0 ->> 'long_term')::boolean,
  'devices in place and long-term medications are shared (not the invalidated device)');
select test.ok(not exists (select 1 from jsonb_array_elements(:'ctx'::jsonb -> 'conditions') c where c ->> 'name' = 'Hidden chronic')
               and exists (select 1 from jsonb_array_elements(:'ctx'::jsonb -> 'conditions') c where c ->> 'name' = 'Congenital aortic stenosis'),
  'sensitive conditions stay hidden unless the share allows them');
select test.ok((:'ctx'::jsonb -> 'lifestyle' ->> 'tobacco_status') = 'current' and (:'ctx'::jsonb -> 'lifestyle' ->> 'pregnancy_status') = 'pregnant'
               and (:'ctx'::jsonb -> 'lifestyle' ->> 'alcohol_status') is null,
  'tobacco and pregnancy are shared; alcohol only when sensitive items are allowed');
select test.ok(jsonb_array_length(:'ctx'::jsonb -> 'highlights') >= 10
               and not exists (select 1 from jsonb_array_elements(:'ctx'::jsonb -> 'highlights') h where h ->> 'specialty_code' = 'radiology'),
  'a dentistry share carries the dentistry highlight rules only');
select test.ok(not (:'ctx'::jsonb -> 'patient') ? 'full_name' and not (:'ctx'::jsonb -> 'patient') ? 'phone', 'the core context carries no identity details');

-- erasing the file removes the new rows too
select test.as_user(:'alice'::uuid);
select public.patient_request_deletion(:'pm', 'Core Male');
select test.as_service();
select public.patient_purge(:'pm', true);
select test.as_user(:'alice'::uuid);
update public.patient_health_profile set pregnancy_status = 'unknown', pregnancy_edd = null where patient_id = :'pf';
select public.patient_request_deletion(:'pf', 'Core Patient');
select test.as_service();
select public.patient_purge(:'pf', true);
select test.ok(not exists (select 1 from public.patient_devices where patient_id = :'pf') and not exists (select 1 from public.patient_health_profile where patient_id = :'pf'),
  'purging a file removes devices and lifestyle');
select test.as_super();
