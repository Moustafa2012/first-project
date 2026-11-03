\pset tuples_only on
\set alice 'a1111111-1111-1111-1111-111111111111'
\set bob 'b2222222-2222-2222-2222-222222222222'
select id as t_rdw from public.observation_types where code = 'rdw_cv' \gset
select id as t_ft4 from public.observation_types where code = 'ft4' \gset
select id as t_wbc from public.observation_types where code = 'wbc' \gset
select id as t_ucol from public.observation_types where code = 'urine_color' \gset

-- ================================================================ catalogue
select test.ok((select count(*) from public.observation_types where code in
  ('rdw_cv','rdw_sd','mpv','pdw','pct','p_lcr','p_lcc','neutrophils_abs','lymphocytes_abs','mid_pct','mid_abs','gran_pct','gran_abs',
   'urine_color','urine_appearance','urine_bilirubin','urine_urobilinogen','urine_epithelial','urine_casts','urine_crystals','urine_mucus',
   'hs_crp','nt_probnp','apob','lipoprotein_a','zinc','anti_hbs','syphilis','stool_c_difficile')) = 29, 'new lab types are in the catalogue');
select test.ok((select bool_and(default_specialty_id is not null) from public.observation_types where code in ('rdw_cv','nt_probnp','urine_casts','zinc')),
  'new lab types are linked to a default specialty');
select test.ok((select lab_group from public.observation_types where code = 'nt_probnp') = 'cardiac', 'cardiac markers have their own group');

select test.as_user(:'alice'::uuid);
select public.create_patient('Catalogue Patient', date '1998-03-12', 'male', null, null, null, null, null, null, 'self', true) as pc \gset
insert into public.observations (patient_id, type_id, value_num, unit, effective_at, setting) values (:'pc', :'t_ft4', 11.2, 'ng/L', now() - interval '1 day', 'lab');
select test.ok((select unit from public.observations where patient_id = :'pc' and type_id = :'t_ft4') = 'ng/L', 'FT4 printed in ng/L is accepted and stored as printed');
select test.throws(format($$insert into public.observations (patient_id, type_id, value_num, unit, effective_at) values (%L, %L, 11.2, 'mg/L', now())$$, :'pc', :'t_ft4'),
  'unsupported unit', 'an unrelated unit is still rejected');
select test.throws(format($$insert into public.observations (patient_id, type_id, value_num, unit, effective_at) values (%L, %L, 400, 'ng/L', now())$$, :'pc', :'t_ft4'),
  'plausible range', 'plausibility is checked after converting ng/L');
insert into public.observations (patient_id, type_id, value_num, unit, effective_at, setting) values (:'pc', :'t_wbc', 6.8, '10^9/L', now() - interval '1 day', 'lab');
select test.ok(exists (select 1 from public.observations where patient_id = :'pc' and type_id = :'t_wbc' and unit = '10^9/L'), 'counts in 10^9/L are accepted for WBC');
insert into public.observations (patient_id, type_id, value_num, effective_at, setting, ref_low, ref_high) values (:'pc', :'t_rdw', 16.4, now() - interval '1 day', 'lab', 11.5, 14.5);
select test.ok((select interpretation from public.observations where patient_id = :'pc' and type_id = :'t_rdw') = 'high', 'RDW-CV is classified against the lab range like any lab result');
insert into public.observations (patient_id, type_id, value_text, effective_at, setting) values (:'pc', :'t_ucol', 'Yellow', now() - interval '1 day', 'lab');
select test.ok(exists (select 1 from public.observations where patient_id = :'pc' and type_id = :'t_ucol' and value_text = 'Yellow'), 'qualitative urinalysis findings have their own types');

-- ================================================================ date precision and unknown dates
insert into public.conditions (patient_id, name, category, certainty, onset_date, date_precision)
  values (:'pc', 'PREC-YEAR-MARKER', 'congenital', 'confirmed', date '2003-01-01', 'approx');
select test.ok((select date_precision from public.conditions where name = 'PREC-YEAR-MARKER') = 'approx', 'an approximate onset year is stored with its precision');
insert into public.medications (patient_id, name_generic, status) values (:'pc', 'PREC-DEFAULT-MED', 'active');
select test.ok((select date_precision from public.medications where name_generic = 'PREC-DEFAULT-MED') = 'day', 'precision defaults to an exact day');
select test.throws(format($$insert into public.conditions (patient_id, name, date_precision) values (%L, 'bad precision', 'week')$$, :'pc'),
  'check constraint|violates', 'only day / month / year / approx are accepted');
insert into public.imaging_studies (patient_id, modality, body_site, findings) values (:'pc', 'xray', 'Chest', 'IMG-NODATE-MARKER');
select test.ok(exists (select 1 from public.imaging_studies where findings = 'IMG-NODATE-MARKER' and performed_on is null), 'an imaging study can be recorded without a known date');
insert into public.procedures (patient_id, name, kind) values (:'pc', 'PROC-NODATE-MARKER', 'dental');
select test.ok(exists (select 1 from public.procedures where name = 'PROC-NODATE-MARKER' and performed_on is null), 'a procedure can be recorded without a known date');
insert into public.immunizations (patient_id, vaccine_name, administered_on, date_precision) values (:'pc', 'PREC-VACCINE', date '2021-06-01', 'month');

-- ================================================================ suggested vs. requested tests
insert into public.test_orders (patient_id, kind, name, status) values (:'pc', 'lab', 'ORDER-SUGGESTED-MARKER', 'suggested');
insert into public.test_orders (patient_id, kind, name, status, ordered_by) values (:'pc', 'lab', 'ORDER-REQUESTED-MARKER', 'requested', 'Dr. Example');
select test.ok((select status from public.test_orders where name = 'ORDER-SUGGESTED-MARKER') = 'suggested', 'a test can be recorded as suggested (not ordered)');
select test.ok((select ordered_by from public.test_orders where name = 'ORDER-REQUESTED-MARKER') = 'Dr. Example', 'the ordering clinician is stored');
select test.throws(format($$insert into public.test_orders (patient_id, name, status) values (%L, 'bad status', 'pending')$$, :'pc'),
  'check constraint|violates', 'unknown order statuses are rejected');
update public.test_orders set status = 'done', done_on = current_date where name = 'ORDER-SUGGESTED-MARKER';
select test.ok((select status from public.test_orders where name = 'ORDER-SUGGESTED-MARKER') = 'done', 'a suggested test can be completed');
select test.as_user(:'bob'::uuid);
select test.ok((select count(*) from public.test_orders where name like 'ORDER-%-MARKER') = 0, 'another account cannot see the test requests');

-- ================================================================ shared view keeps precision and undated studies
select test.as_user(:'alice'::uuid);
select public.share_create(:'pc', 'Precision share', 'full', '{}', array['imaging','procedures','other_conditions','immunizations'],
  '{}', (current_date - 30), null, now() + interval '2 days', 5, false, false, false, false, 'Dr. Dates') as shp \gset
select (:'shp'::jsonb ->> 'token') as ptok, (:'shp'::jsonb ->> 'pin') as ppin \gset
select test.as_service();
select (public.share_open(:'ptok', :'ppin', 'ip-prec', 'UA') ->> 'session_token') as psess \gset
select public.share_bundle(:'psess', 'ip-prec', 'UA') as pb \gset
select test.ok(:'pb'::jsonb ->> 'status' = 'ok', 'precision share opens');
select test.ok((select x ->> 'date_precision' from jsonb_array_elements(:'pb'::jsonb -> 'chronic_conditions') x where x ->> 'name' = 'PREC-YEAR-MARKER') = 'approx',
  'shared conditions carry their date precision');
select test.ok(exists (select 1 from jsonb_array_elements(:'pb'::jsonb -> 'imaging') x where x ->> 'findings' = 'IMG-NODATE-MARKER'),
  'an undated imaging study is still shared when the share has a date range');
select test.ok(exists (select 1 from jsonb_array_elements(:'pb'::jsonb -> 'procedures') x where x ->> 'name' = 'PROC-NODATE-MARKER'),
  'an undated procedure is still shared when the share has a date range');
select test.ok((select x ->> 'date_precision' from jsonb_array_elements(:'pb'::jsonb -> 'immunizations') x where x ->> 'vaccine_name' = 'PREC-VACCINE') = 'month',
  'shared immunizations carry their date precision');
select test.as_super();
