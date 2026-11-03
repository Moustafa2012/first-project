\pset tuples_only on
\set alice 'a1111111-1111-1111-1111-111111111111'
\set bob 'b2222222-2222-2222-2222-222222222222'
\set carol 'c3333333-3333-3333-3333-333333333333'

-- ---------------------------------------------------------------- creation + isolation
select test.as_user(:'alice'::uuid);
select public.create_patient('Alice Alpha', '1990-05-01', 'female', null, 'SA', 'A', '+') as pa \gset
select test.ok(:'pa' is not null, 'alice can create her own patient file');
select test.ok((select count(*) from public.patients) = 1, 'alice sees exactly one patient');
select test.ok((select mrn from public.patients) ~ '^SH-\d{8}$', 'MRN is generated');
select test.ok((select count(*) from public.patient_members where user_id = :'alice'::uuid and role = 'owner') = 1, 'creator becomes owner');

select test.throws($$select public.create_patient('alice alpha', '1990-05-01')$$, 'possible_duplicate', 'duplicate detected within own account');
select public.create_patient('Alice Alpha', '1990-05-01', 'female', null, null, null, null, null, null, 'self', true) as pa_twin \gset
select test.ok(:'pa_twin' is not null and :'pa_twin' <> :'pa', 'explicit confirmation allows a distinct twin file');

select public.create_patient('Child Alpha', '2015-02-01', 'male', null, null, null, null, null, null, 'dependent') as pchild \gset
select test.ok((select role from public.patient_members where patient_id = :'pchild') = 'guardian', 'dependent file gets guardian role');

select test.as_user(:'bob'::uuid);
select public.create_patient('Bob Beta', '1985-11-20', 'male') as pb \gset
select test.ok((select count(*) from public.patients) = 1, 'bob sees only his own patient');
select test.ok((select count(*) from public.patients where id = :'pa') = 0, 'bob cannot read alice patient by id');
select test.ok((select count(*) from public.patient_members where patient_id = :'pa') = 0, 'bob cannot read alice membership');
update public.patients set full_name = 'Hacked' where id = :'pa';
select test.as_super();
select test.ok((select full_name from public.patients where id = :'pa') = 'Alice Alpha', 'bob update on alice patient changed nothing');

select test.as_user(:'bob'::uuid);
select test.throws(format($$insert into public.encounters (patient_id, started_at, reason) values (%L, now(), 'x')$$, :'pa'),
  '42501|row-level security', 'bob cannot insert an encounter into alice file');
select test.throws(format($$insert into public.conditions (patient_id, name) values (%L, 'diabetes')$$, :'pa'),
  '42501|row-level security', 'bob cannot insert a condition into alice file');
select test.throws(format($$select public.share_create(%L, 'x share', 'full')$$, :'pa'), 'forbidden', 'bob cannot create a share for alice');

-- bob's encounter exists, alice tries to link her condition to it (composite FK)
insert into public.encounters (patient_id, started_at, reason) values (:'pb', now(), 'bob visit') returning id as eb \gset
select test.as_user(:'alice'::uuid);
select test.throws(format($$insert into public.conditions (patient_id, name, encounter_id) values (%L, 'asthma', %L)$$, :'pa', :'eb'),
  '23503|foreign key', 'cross-patient link rejected by composite foreign key');

-- ---------------------------------------------------------------- protected columns / delete
select test.throws(format($$update public.patients set mrn = 'SH-00000001' where id = %L$$, :'pa'), 'permission denied', 'mrn is not writable');
select test.throws(format($$update public.patients set created_by = %L where id = %L$$, :'bob', :'pa'), 'permission denied', 'created_by is not writable');
select test.throws($$delete from public.patients$$, 'permission denied', 'patients cannot be deleted by users');
select test.throws($$delete from public.encounters$$, 'permission denied', 'encounters cannot be deleted by users');
select test.throws($$delete from public.observations$$, 'permission denied', 'observations cannot be deleted by users');
select test.throws($$insert into public.patient_members (patient_id, user_id, role) values (gen_random_uuid(), gen_random_uuid(), 'owner')$$,
  'permission denied', 'users cannot grant themselves membership');
select test.throws($$insert into public.patients (full_name, date_of_birth) values ('Direct', '1990-01-01')$$,
  'permission denied', 'patients can only be created through create_patient');
select test.throws(format($$update public.profiles set role = 'admin' where id = %L$$, :'alice'), 'permission denied', 'users cannot make themselves admin');
select test.throws(format($$update public.patients set date_of_birth = current_date + 5 where id = %L$$, :'pa'), 'future', 'future birth date rejected');

-- ---------------------------------------------------------------- anon
select test.as_anon();
select test.throws($$select * from public.patients$$, 'permission denied', 'anon cannot read patients');
select test.throws($$select * from public.medical_specialties$$, 'permission denied', 'anon cannot read catalog');
select test.throws($$select public.share_open('abcdefghijklmnopqrstuvwxyz', '123456', 'ip')$$, 'permission denied', 'anon cannot call share_open');
select test.throws($$select public.share_bundle('abcdefghijklmnopqrstuvwxyz')$$, 'permission denied', 'anon cannot call share_bundle');
select test.throws($$select public.create_patient('Anon', '1990-01-01')$$, 'permission denied', 'anon cannot create patients');

-- ---------------------------------------------------------------- authenticated cannot use viewer functions or internals
select test.as_user(:'alice'::uuid);
select test.throws($$select public.share_open('abcdefghijklmnopqrstuvwxyz', '123456', 'ip')$$, 'permission denied', 'signed-in users cannot call share_open');
select test.throws($$select public.share_bundle('abcdefghijklmnopqrstuvwxyz')$$, 'permission denied', 'signed-in users cannot call share_bundle');
select test.throws($$select * from public.medical_share_sessions$$, 'permission denied', 'sessions table is not readable');
select test.throws($$select * from public.share_attempts$$, 'permission denied', 'attempts table is not readable');
select test.throws($$select token_hash from public.medical_shares$$, 'permission denied', 'token hash column is not readable');
select test.throws($$select pin_hash from public.medical_shares$$, 'permission denied', 'pin hash column is not readable');
select test.throws($$select * from app.patient_mrn_seq$$, 'permission denied', 'app schema is not accessible');

-- ---------------------------------------------------------------- admin has no clinical access
select test.as_user(:'carol'::uuid);
select test.ok((select count(*) from public.patients) = 0, 'admin sees no patients');
select test.ok((select count(*) from public.encounters) = 0, 'admin sees no encounters');
select test.ok((select count(*) from public.profiles) >= 4, 'admin can list accounts');
update public.medical_specialties set name_en = 'Dentistry (edited)' where code = 'dentistry';
select test.ok((select name_en from public.medical_specialties where code = 'dentistry') = 'Dentistry (edited)', 'admin can edit catalog');
select test.as_user(:'alice'::uuid);
update public.medical_specialties set name_en = 'Hacked' where code = 'dentistry';
select test.ok((select name_en from public.medical_specialties where code = 'dentistry') = 'Dentistry (edited)', 'normal user cannot edit catalog');
select test.throws($$insert into public.medical_specialties (code, name_ar, name_en) values ('rogue', 'x', 'x')$$, '42501|row-level security', 'normal user cannot add a specialty');
select test.as_user(:'carol'::uuid);
insert into public.medical_specialties (code, name_ar, name_en, icon) values ('sports_medicine', 'الطب الرياضي', 'Sports medicine', 'dumbbell');
select test.ok(exists (select 1 from public.medical_specialties where code = 'sports_medicine'), 'admin can add a specialty without schema change');

-- ---------------------------------------------------------------- audit trail
select test.as_user(:'alice'::uuid);
select test.ok((select count(*) from public.audit_logs where patient_id = :'pa') >= 1, 'owner can read audit entries of her patient');
select test.as_user(:'bob'::uuid);
select test.ok((select count(*) from public.audit_logs where patient_id = :'pa') = 0, 'bob cannot read alice audit entries');
select test.as_user(:'alice'::uuid);
select test.throws($$update public.audit_logs set action = 'insert'$$, 'permission denied', 'audit_logs cannot be updated by users');
select test.throws($$delete from public.audit_logs$$, 'permission denied', 'audit_logs cannot be deleted by users');
select test.as_super();
select test.throws($$update public.audit_logs set action = 'insert'$$, 'append-only', 'audit_logs is append-only even for the owner role');
select test.throws($$delete from public.audit_logs$$, 'append-only', 'audit_logs delete blocked even for the owner role');

-- identifiers: stored for owner, never in clear text in the audit trail
select test.as_user(:'alice'::uuid);
insert into public.patient_identifiers (patient_id, id_type, id_value) values (:'pa', 'national_id', '1098765432');
select test.as_user(:'bob'::uuid);
select test.ok((select count(*) from public.patient_identifiers) = 0, 'bob cannot read alice identifiers');
select test.as_super();
select test.ok(not exists (select 1 from public.audit_logs where new_data::text like '%1098765432%'), 'identifier value is redacted in audit log');
select test.ok(exists (select 1 from public.audit_logs where table_name = 'patient_identifiers' and new_data ->> 'id_value' = '[redacted]'), 'identifier audit row exists');

-- persist ids for later files
create table test.ctx (k text primary key, v text);
insert into test.ctx values ('pa', :'pa'), ('pb', :'pb'), ('pchild', :'pchild');
grant all on test.ctx to public;
