\pset tuples_only on
\set alice 'a1111111-1111-1111-1111-111111111111'
select id as s_dent from public.medical_specialties where code = 'dentistry' \gset
select id as s_card from public.medical_specialties where code = 'cardiology' \gset

select test.as_user(:'alice'::uuid);
select public.create_patient('Links Patient', date '1988-08-08', 'male', null, null, null, null, null, null, 'self', true) as pl \gset
insert into public.procedures (patient_id, specialty_id, kind, name, teeth, performed_on) values (:'pl', :'s_dent', 'dental', 'Root canal 36', '{36}', current_date - 20) returning id as pr \gset
insert into public.imaging_studies (patient_id, specialty_id, modality, teeth, performed_on) values (:'pl', :'s_dent', 'dental_xray', '{36,37}', current_date - 21) returning id as im \gset
select test.ok((select teeth = '{36}' from public.procedures where id = :'pr') and (select teeth = '{36,37}' from public.imaging_studies where id = :'im'),
  'procedures and imaging studies name their teeth');
select test.throws(format($$insert into public.procedures (patient_id, name, teeth) values (%L, 'x', '{19}')$$, :'pl'), 'check constraint|violates', 'a procedure cannot name a non-existent tooth');
select test.throws(format($$insert into public.imaging_studies (patient_id, modality, teeth) values (%L, 'xray', '{11,11}')$$, :'pl'), 'check constraint|violates', 'a tooth is named once');
-- a dental problem without a tooth yet, and a cardiology condition that must stay out of the dental view
insert into public.conditions (patient_id, specialty_id, name, category) values (:'pl', :'s_dent', 'Abscess, tooth not yet known', 'acute');
insert into public.conditions (patient_id, specialty_id, name, category) values (:'pl', :'s_card', 'Cardio thing', 'diagnosis');
insert into public.procedures (patient_id, specialty_id, kind, name) values (:'pl', :'s_dent', 'dental', 'Cleaning, no tooth');

select public.share_create(p_patient => :'pl', p_title => 'Dentist', p_scope_kind => 'specialty', p_specialty_ids => array[:'s_dent'::uuid],
  p_expires_at => now() + interval '1 day', p_allow_contribute => true, p_contribute_modules => array['procedures', 'imaging_studies', 'dental_exams']) as sh \gset
select (:'sh'::jsonb ->> 'token') as tok, (:'sh'::jsonb ->> 'pin') as pin \gset
select test.as_service();
select (public.share_open(:'tok', :'pin', 'ip-links', 'UA') ->> 'session_token') as sess \gset
select public.share_dental(:'sess') as d \gset
select test.ok(exists (select 1 from jsonb_array_elements(:'d'::jsonb -> 'diagnoses') x where x ->> 'name' = 'Abscess, tooth not yet known')
               and not exists (select 1 from jsonb_array_elements(:'d'::jsonb -> 'diagnoses') x where x ->> 'name' = 'Cardio thing'),
  'the dentist sees every dental diagnosis, including one without a tooth yet, and nothing from other specialties');
select test.ok(jsonb_array_length(:'d'::jsonb -> 'procedures') = 1 and jsonb_array_length(:'d'::jsonb -> 'imaging') = 1,
  'and the procedures and images linked to teeth');

select (public.share_identify(:'sess', 'Dr Root', null, null, null, null, :'pl' || '/signatures/r.png') ->> 'contributor_id') as ctr \gset
select (public.share_contribute(:'sess', 'procedures', jsonb_build_object('name', 'Extraction 18', 'kind', 'dental', 'teeth', '[18]'::jsonb)) ->> 'id') as cp \gset
select test.ok((select teeth = '{18}' and contributed_by = :'ctr'::uuid from public.procedures where id = :'cp'), 'a procedure added through the share names its tooth');

select test.as_user(:'alice'::uuid);
select test.throws(format($$update public.procedures set teeth = '{17}' where id = %L$$, :'cp'), 'contributed_record_readonly', 'the patient cannot move the clinician''s procedure to another tooth');
update public.conditions set teeth = '{13}' where name = 'Abscess, tooth not yet known' and patient_id = :'pl';
select test.ok((select teeth = '{13}' from public.conditions where name = 'Abscess, tooth not yet known' and patient_id = :'pl'), 'a dental problem gets its tooth later');

select public.patient_request_deletion(:'pl', 'Links Patient');
select test.as_service();
select public.patient_purge(:'pl', true);
select test.as_super();
