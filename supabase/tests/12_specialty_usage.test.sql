\pset tuples_only on
\set alice 'a1111111-1111-1111-1111-111111111111'
\set bob 'b2222222-2222-2222-2222-222222222222'
select id as s_dent from public.medical_specialties where code = 'dentistry' \gset
select id as s_card from public.medical_specialties where code = 'cardiology' \gset

select test.as_user(:'alice'::uuid);
select public.create_patient('Usage Patient', date '1990-01-01', 'female', null, null, null, null, null, null, 'self', true) as pu \gset
select test.ok((select count(*) = 0 from public.patient_specialty_usage(:'pu')), 'a new file uses no specialty');

insert into public.conditions (patient_id, specialty_id, name, category) values (:'pu', :'s_card', 'Murmur', 'diagnosis');
insert into public.encounters (patient_id, specialty_id, kind, started_at) values (:'pu', :'s_card', 'clinic', now() - interval '3 days');
-- a diagnosis that names a tooth belongs to dentistry even without a specialty
insert into public.conditions (patient_id, name, category, teeth) values (:'pu', 'Caries', 'diagnosis', '{16}');
insert into public.conditions (patient_id, specialty_id, name, category) values (:'pu', :'s_card', 'Typo', 'diagnosis') returning id as typo \gset
update public.conditions set record_status = 'entered_in_error', invalidated_reason = 'typo' where id = :'typo';

select test.ok((select array_agg(code order by n desc, code) = array['cardiology', 'dentistry'] from public.patient_specialty_usage(:'pu')),
  'the specialties in use, the most used first');
select test.ok((select n = 2 from public.patient_specialty_usage(:'pu') where code = 'cardiology'), 'records entered in error are not counted');

select test.as_user(:'bob'::uuid);
select test.ok((select count(*) = 0 from public.patient_specialty_usage(:'pu')), 'someone without access to the file sees nothing');
select test.as_anon();
select test.throws(format($$select * from public.patient_specialty_usage(%L)$$, :'pu'), 'permission denied', 'anonymous callers cannot run it');

select test.as_user(:'alice'::uuid);
select public.patient_request_deletion(:'pu', 'Usage Patient');
select test.as_service();
select public.patient_purge(:'pu', true);
select test.as_super();
