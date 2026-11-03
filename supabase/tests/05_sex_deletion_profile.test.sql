\pset tuples_only on
\set alice 'a1111111-1111-1111-1111-111111111111'
\set bob 'b2222222-2222-2222-2222-222222222222'
select id as s_obgyn from public.medical_specialties where code = 'obgyn' \gset
select id as s_men from public.medical_specialties where code = 'mens_health' \gset
select id as s_card from public.medical_specialties where code = 'cardiology' \gset
select id as t_hcg from public.observation_types where code = 'beta_hcg' \gset
select id as t_hr from public.observation_types where code = 'heart_rate' \gset

-- ================================================================ sex applicability
select test.as_user(:'alice'::uuid);
select public.create_patient('Male Patient', date '1985-05-05', 'male', null, null, null, null, null, null, 'dependent', true) as pm \gset
select public.create_patient('Female Patient', date '1990-01-01', 'female', null, null, null, null, null, null, 'dependent', true) as pf \gset
select public.create_patient('Unspecified Patient', date '1992-02-02', 'unspecified', null, null, null, null, null, null, 'dependent', true) as pu \gset

select test.ok((select applicable_sex from public.medical_specialties where code = 'obgyn') = 'female', 'obstetrics & gynecology is female-only');
select test.ok((select applicable_sex from public.medical_specialties where code = 'mens_health') = 'male', 'men''s health is male-only');
select test.ok((select applicable_sex from public.medical_specialties where code = 'cardiology') is null, 'cardiology applies to everyone');

select test.throws(format($$insert into public.encounters (patient_id, specialty_id, kind, started_at) values (%L, %L, 'clinic', now())$$, :'pm', :'s_obgyn'),
  'specialty_not_applicable', 'a male file cannot get an obstetrics & gynecology visit');
select test.throws(format($$insert into public.encounters (patient_id, specialty_id, kind, started_at) values (%L, %L, 'clinic', now())$$, :'pf', :'s_men'),
  'specialty_not_applicable', 'a female file cannot get a men''s health visit');
select test.throws(format($$insert into public.observations (patient_id, type_id, value_text, effective_at) values (%L, %L, 'x', now())$$, :'pm', :'t_hcg'),
  'measurement_not_applicable|specialty_not_applicable|numeric', 'a pregnancy hormone result cannot be filed for a male');
insert into public.encounters (patient_id, specialty_id, kind, started_at, reason) values (:'pf', :'s_obgyn', 'clinic', now() - interval '1 day', 'OBGYN-OK') returning id as e_f \gset
select test.ok(:'e_f' is not null, 'a female file accepts an obstetrics & gynecology visit');
insert into public.encounters (patient_id, specialty_id, kind, started_at) values (:'pu', :'s_obgyn', 'clinic', now());
insert into public.encounters (patient_id, specialty_id, kind, started_at) values (:'pu', :'s_men', 'clinic', now());
select test.ok((select count(*) from public.encounters where patient_id = :'pu') = 2, 'an unspecified sex is never restricted');
insert into public.encounters (patient_id, specialty_id, kind, started_at) values (:'pm', :'s_card', 'clinic', now());
select test.ok((select count(*) from public.encounters where patient_id = :'pm') = 1, 'a neutral specialty works for a male file');

select test.throws(format($$update public.patients set sex = 'male' where id = %L$$, :'pf'),
  'sex_change_conflict', 'sex cannot change to one that conflicts with active specialty records');
update public.encounters set record_status = 'entered_in_error', invalidated_reason = 'wrong file' where id = :'e_f';
update public.patients set sex = 'male' where id = :'pf';
select test.ok((select sex from public.patients where id = :'pf') = 'male', 'sex can change once the conflicting record is marked entered-in-error');
update public.encounters set summary = 'noop' where id = :'e_f' and false;

-- ================================================================ patient deletion
select public.create_patient('Delete Me Please', date '1980-03-03', 'female', null, null, null, null, null, null, 'self', true) as pd \gset
select public.create_patient('Keep Me', date '1981-04-04', 'male', null, null, null, null, null, null, 'self', true) as pk \gset
insert into public.allergies (patient_id, substance, category, severity, certainty) values (:'pd', 'DEL-ALLERGY-MARKER', 'food', 'mild', 'confirmed');
insert into public.conditions (patient_id, name, category, certainty) values (:'pd', 'DEL-COND-MARKER', 'chronic', 'confirmed');
insert into public.observations (patient_id, type_id, value_num, effective_at) values (:'pd', :'t_hr', 70, now() - interval '1 day');
insert into public.allergies (patient_id, substance, category, severity, certainty) values (:'pk', 'KEEP-ALLERGY-MARKER', 'food', 'mild', 'confirmed');
select (public.share_create(:'pd', 'Share to delete', 'full', '{}', '{}', '{}', null, null, now() + interval '2 days', 5, false, false, false, false, null, '[]'))::jsonb ->> 'share_id' as sh \gset
select test.ok(char_length((select token_hint from public.medical_shares where id = :'sh')) = 4, 'a share stores a 4-character token fingerprint (not the token)');

select test.throws(format($$select public.patient_request_deletion(%L, 'wrong name')$$, :'pd'), 'confirmation_mismatch', 'deletion needs the exact name');
select test.as_user(:'bob'::uuid);
select test.throws(format($$select public.patient_request_deletion(%L, 'Delete Me Please')$$, :'pd'), 'forbidden|42501', 'a stranger cannot request deletion');
select test.as_anon();
select test.throws(format($$select public.patient_request_deletion(%L, 'Delete Me Please')$$, :'pd'), 'permission denied|42501', 'anonymous cannot request deletion');

select test.as_user(:'alice'::uuid);
select test.ok(public.patient_request_deletion(:'pd', '  delete me please ') > now() + interval '29 days', 'owner schedules deletion 30 days ahead (name match ignores case/spaces)');
select test.throws(format($$select public.patient_request_deletion(%L, 'Delete Me Please')$$, :'pd'), 'already_pending', 'a second request is refused');
select test.ok((select revoked_at is not null and revoke_reason = 'patient_file_deleted' from public.medical_shares where id = :'sh'), 'every active share is revoked at once');
select test.ok((select count(*) from public.patients where id = :'pd') = 1, 'the file is still readable during the grace period');
select test.throws(format($$insert into public.allergies (patient_id, substance, category, severity, certainty) values (%L, 'x', 'food', 'mild', 'confirmed')$$, :'pd'),
  'row-level security|42501', 'a file pending deletion is read-only (no new records)');
select test.throws(format($$select public.share_create(%L, 'new share', 'full', '{}', '{}', '{}', null, null, now() + interval '1 day', 5, false, false, false, false, null, '[]')$$, :'pd'),
  'forbidden|42501', 'no new share can be created while pending deletion');
select test.throws(format($$select public.patient_purge(%L, true)$$, :'pd'), 'permission denied|42501', 'users cannot purge');

select public.patient_cancel_deletion(:'pd');
select test.ok((select deletion_requested_at is null from public.patients where id = :'pd'), 'the owner can restore the file');
insert into public.allergies (patient_id, substance, category, severity, certainty) values (:'pd', 'AFTER-RESTORE', 'food', 'mild', 'confirmed');
select test.ok((select count(*) from public.allergies where patient_id = :'pd' and substance = 'AFTER-RESTORE') = 1, 'writes work again after restoring');

select public.patient_request_deletion(:'pd', 'Delete Me Please');
select test.as_service();
select test.throws(format($$select public.patient_purge(%L, false)$$, :'pd'), 'grace_period_not_elapsed', 'purge waits for the grace period unless forced');
select test.throws(format($$select public.patient_purge(%L, false)$$, :'pk'), 'not_pending', 'a file that was never scheduled cannot be purged');
select test.ok(:'pd' = any (public.patient_purge_due()) = false, 'not due yet');
select test.as_super();
update public.patients set deletion_scheduled_for = now() - interval '1 minute' where id = :'pd';
select test.as_service();
select test.ok(:'pd'::uuid = any (public.patient_purge_due()), 'due after the grace period');
select public.patient_purge(:'pd', false);
select test.as_super();
select test.ok((select count(*) from public.patients where id = :'pd') = 0, 'purge removes the patient');
select test.ok((select count(*) from public.allergies where patient_id = :'pd') + (select count(*) from public.conditions where patient_id = :'pd')
             + (select count(*) from public.observations where patient_id = :'pd') + (select count(*) from public.medical_shares where patient_id = :'pd')
             + (select count(*) from public.patient_members where patient_id = :'pd') = 0, 'purge removes every clinical row, share and membership');
select test.ok((select count(*) from public.audit_logs where patient_id = :'pd') = 0, 'purge removes the audit rows that copied clinical data');
select test.ok((select count(*) from public.patients where id = :'pk') = 1 and (select count(*) from public.allergies where patient_id = :'pk') = 1, 'other files are untouched');
select test.ok((select count(*) from public.patient_deletion_log where patient_id = :'pd') = 1 and (select reason from public.patient_deletion_log where patient_id = :'pd') = 'grace_period_elapsed', 'a minimal tombstone is kept');
select test.as_user(:'alice'::uuid);
select test.throws($$delete from public.audit_logs$$, 'permission denied|append-only|42501', 'audit log stays append-only for users');
select test.throws($$select count(*) from public.patient_deletion_log$$, 'permission denied|42501', 'the tombstone table is not readable by users');

-- forced "delete now"
select test.as_user(:'alice'::uuid);
select public.create_patient('Delete Now', date '1975-07-07', 'male', null, null, null, null, null, null, 'self', true) as pn \gset
select public.patient_request_deletion(:'pn', 'Delete Now');
select test.as_service();
select public.patient_purge(:'pn', true);
select test.as_super();
select test.ok((select reason from public.patient_deletion_log where patient_id = :'pn') = 'deleted_now_by_owner', 'owner-confirmed immediate deletion is recorded as such');

-- ================================================================ account profile
select test.as_user(:'alice'::uuid);
update public.profiles set date_of_birth = date '1988-08-08', sex = 'female', blood_abo = 'O', blood_rh = '+', phone = '+966500000000', nationality = 'SA', city = 'Riyadh', country = 'KSA' where id = :'alice';
select test.ok((select blood_abo || blood_rh from public.profiles where id = :'alice') = 'O+', 'a user can save their own basic profile data');
select test.throws(format($$update public.profiles set date_of_birth = current_date + 1 where id = %L$$, :'alice'), 'invalid_date_of_birth', 'a future date of birth is rejected');
select test.throws(format($$update public.profiles set avatar_path = 'u/other/x.png' where id = %L$$, :'alice'), 'permission denied|42501', 'users cannot set avatar_path directly');
select test.throws(format($$update public.profiles set role = 'admin' where id = %L$$, :'alice'), 'permission denied|42501', 'users still cannot change their role');
select test.as_user(:'bob'::uuid);
select test.ok((select count(*) from public.profiles where id = :'alice') = 0, 'another user cannot read this profile');
select test.as_super();
