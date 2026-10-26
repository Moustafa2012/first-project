\pset tuples_only on
\set alice 'a1111111-1111-1111-1111-111111111111'
\set bob 'b2222222-2222-2222-2222-222222222222'
select v as pa from test.ctx where k = 'pa' \gset
select v as pb from test.ctx where k = 'pb' \gset
select id as s_dent from public.medical_specialties where code = 'dentistry' \gset
select id as s_card from public.medical_specialties where code = 'cardiology' \gset
select id as t_glu from public.observation_types where code = 'blood_glucose' \gset
select id as t_bp from public.observation_types where code = 'blood_pressure' \gset

-- ---------------------------------------------------------------- fixture data (as service role, with distinctive markers)
select test.as_service();
insert into public.encounters (patient_id, specialty_id, kind, started_at, reason, practitioner_name)
  values (:'pa', :'s_dent', 'dental', now() - interval '60 days', 'DENTAL-VISIT-MARKER', 'Dr. Molar') returning id as e_dent \gset
insert into public.encounters (patient_id, specialty_id, kind, started_at, reason)
  values (:'pa', :'s_card', 'clinic', now() - interval '40 days', 'CARDIO-VISIT-MARKER') returning id as e_card \gset
insert into public.encounters (patient_id, specialty_id, kind, started_at, reason)
  values (:'pa', :'s_dent', 'dental', now() - interval '400 days', 'OLD-DENTAL-MARKER') returning id as e_old \gset
insert into public.encounters (patient_id, specialty_id, kind, started_at, reason)
  values (:'pb', :'s_dent', 'dental', now() - interval '10 days', 'BOB-SECRET-MARKER') returning id as e_bob \gset
insert into public.conditions (patient_id, name, category, certainty, specialty_id) values (:'pa', 'CHRONIC-MARKER diabetes', 'chronic', 'confirmed', null);
insert into public.conditions (patient_id, name, category, certainty, sensitive) values (:'pa', 'SENSITIVE-MARKER condition', 'chronic', 'confirmed', true);
insert into public.conditions (patient_id, name, category, certainty, specialty_id) values (:'pa', 'OTHER-COND-CARDIO-MARKER', 'diagnosis', 'confirmed', :'s_card');
insert into public.conditions (patient_id, name, category, certainty, specialty_id) values (:'pa', 'OTHER-COND-DENTAL-MARKER', 'diagnosis', 'confirmed', :'s_dent');
insert into public.conditions (patient_id, name, category, certainty) values (:'pb', 'BOB-CONDITION-MARKER', 'chronic', 'confirmed');
insert into public.allergies (patient_id, substance, category, severity, certainty) values (:'pb', 'BOB-ALLERGY-MARKER', 'food', 'mild', 'confirmed');
insert into public.medications (patient_id, name_generic, status, origin) values (:'pb', 'BOB-MED-MARKER', 'active', 'prescribed');
insert into public.medications (patient_id, name_generic, status, origin, sensitive) values (:'pa', 'SENSITIVE-MED-MARKER', 'active', 'prescribed', true);
insert into public.medications (patient_id, name_generic, status, origin) values (:'pa', 'STOPPED-MED-MARKER', 'stopped', 'prescribed');
insert into public.observations (patient_id, type_id, value_num, effective_at, context, specialty_id, setting)
  values (:'pa', :'t_glu', 99, now() - interval '20 days', 'fasting', :'s_dent', 'home') returning id as o_dent \gset
insert into public.medical_documents (uploaded_by, patient_id, specialty_id, doc_type, title, storage_path, original_filename, mime_type, size_bytes, sha256, sensitivity)
  values (:'alice'::uuid, :'pa', :'s_dent', 'dental_image', 'DENTAL-XRAY-DOC', :'pa' || '/d1.pdf', 'xray.pdf', 'application/pdf', 100, repeat('a', 64), 'standard') returning id as d_dent \gset
insert into public.medical_documents (uploaded_by, patient_id, specialty_id, doc_type, title, storage_path, original_filename, mime_type, size_bytes, sha256, sensitivity)
  values (:'alice'::uuid, :'pa', :'s_dent', 'other', 'RESTRICTED-DOC', :'pa' || '/d2.pdf', 'r.pdf', 'application/pdf', 100, repeat('b', 64), 'restricted') returning id as d_restricted \gset
insert into public.medical_documents (uploaded_by, patient_id, specialty_id, doc_type, title, storage_path, original_filename, mime_type, size_bytes, sha256)
  values (:'alice'::uuid, :'pa', :'s_card', 'doctor_report', 'CARDIO-DOC', :'pa' || '/d3.pdf', 'c.pdf', 'application/pdf', 100, repeat('c', 64)) returning id as d_card \gset
insert into public.medical_documents (uploaded_by, patient_id, specialty_id, doc_type, title, storage_path, original_filename, mime_type, size_bytes, sha256)
  values (:'bob'::uuid, :'pb', :'s_dent', 'other', 'BOB-DOC', :'pb' || '/b1.pdf', 'b.pdf', 'application/pdf', 100, repeat('d', 64)) returning id as d_bob \gset
update public.patients set phone = '+966-PHONE-MARKER' where id = :'pa';

-- ---------------------------------------------------------------- creation rules
select test.as_user(:'alice'::uuid);
select test.throws(format($$select public.share_create(%L, 'x', 'full', '{}', '{}', '{}', null, null, now() + interval '31 days')$$, :'pa'), 'between 5 minutes and 30 days', 'expiry beyond 30 days rejected');
select test.throws(format($$select public.share_create(%L, 'x', 'full', '{}', '{}', '{}', null, null, now() + interval '1 minute')$$, :'pa'), 'between 5 minutes and 30 days', 'expiry under 5 minutes rejected');
select test.throws(format($$select public.share_create(%L, 'dentist', 'specialty')$$, :'pa'), 'at least one specialty', 'specialty share needs a specialty');
select test.throws(format($$select public.share_create(%L, 'dentist', 'custom')$$, :'pa'), 'at least one selected', 'custom share needs records');
select test.throws(format($$select public.share_create(%L, 'dentist', 'specialty', array[gen_random_uuid()])$$, :'pa'), 'unknown specialty', 'unknown specialty rejected');
select test.throws(format($$select public.share_create(%L, 'dentist', 'full', '{}', array['everything'])$$, :'pa'), 'check constraint|include', 'unknown module rejected');
select test.throws(format($$select public.share_create(%L, 'xx', 'custom', '{}', '{}', '{}', null, null, null, 5, false, false, false, false, null, jsonb_build_array(jsonb_build_object('table','encounters','id',%L)))$$, :'pa', :'e_bob'),
  'does not belong to this patient', 'cannot share a record of another patient');
select test.throws(format($$select public.share_create(%L, 'xx', 'custom', '{}', '{}', '{}', null, null, null, 5, false, false, false, false, null, jsonb_build_array(jsonb_build_object('table','patients','id',%L)))$$, :'pa', :'pa'),
  'invalid item table', 'item tables are whitelisted');

-- dentist share: specialty scope, last 6 months, encounters + documents + observations + other conditions
select public.share_create(:'pa', 'Dentist visit', 'specialty', array[:'s_dent'::uuid], array['encounters','documents','observations','other_conditions'],
  '{}', (current_date - 180), null, now() + interval '2 days', 5, false, false, true, false, 'Dr. Molar') as sh \gset
select (:'sh'::jsonb ->> 'share_id') as sid, (:'sh'::jsonb ->> 'token') as tok, (:'sh'::jsonb ->> 'pin') as pin \gset
select test.ok(length(:'tok') >= 30 and :'tok' ~ '^[A-Za-z0-9_-]+$', 'token is long and URL-safe');
select test.ok(:'pin' ~ '^\d{6}$', 'PIN is six digits');
select test.ok((select count(*) from public.medical_shares where id = :'sid') = 1, 'owner can list her share');
select test.as_super();
select test.ok(not exists (select 1 from public.medical_shares where pin_hash = :'pin' or pin_hash like '%' || :'pin' || '%'), 'PIN is not stored in clear');
select test.ok((select pin_hash from public.medical_shares where id = :'sid') like '$2%', 'PIN is stored as a bcrypt hash');
select test.ok(not exists (select 1 from public.medical_shares where encode(token_hash, 'escape') like '%' || :'tok' || '%'), 'token is not stored in clear');
select test.ok((select length(token_hash) from public.medical_shares where id = :'sid') = 32, 'token is stored as a SHA-256 digest');
select test.ok(exists (select 1 from public.medical_share_access_logs where share_id = :'sid'::uuid and event = 'created'), 'creation is logged');
select test.as_user(:'bob'::uuid);
select test.ok((select count(*) from public.medical_shares) = 0, 'bob cannot see alice shares');
select test.ok((select count(*) from public.medical_share_access_logs) = 0, 'bob cannot see alice share logs');
select test.throws(format($$select public.share_revoke(%L)$$, :'sid'), 'forbidden', 'bob cannot revoke alice share');

-- ---------------------------------------------------------------- opening: token + PIN
select test.as_service();
select test.ok(public.share_open('not-a-real-token-not-a-real-token', :'pin', 'ip-1') ->> 'status' = 'unavailable', 'unknown token is unavailable');
select test.ok(public.share_open('short', :'pin', 'ip-1') ->> 'status' = 'unavailable', 'malformed token is unavailable');
select public.share_open(:'tok', '000000', 'ip-2', 'UA') as w1 \gset
select test.ok(:'w1'::jsonb ->> 'status' = 'invalid_pin' and (:'w1'::jsonb ->> 'attempts_left')::int = 4, 'wrong PIN reports remaining attempts');
select test.ok(public.share_open(:'tok', 'abcdef', 'ip-2') ->> 'status' = 'invalid_pin', 'non-numeric PIN is rejected like a wrong PIN');
select public.share_open(:'tok', :'pin', 'ip-3', 'UA') as ok1 \gset
select test.ok(:'ok1'::jsonb ->> 'status' = 'ok', 'correct token + PIN opens a session');
select (:'ok1'::jsonb ->> 'session_token') as sess \gset
select test.ok(length(:'sess') >= 40, 'session token is long');
select test.ok((select failed_attempts from public.medical_shares where id = :'sid'::uuid) = 0, 'failed attempts reset after success');
select test.ok(not exists (select 1 from public.medical_share_sessions where encode(session_hash, 'escape') like '%' || :'sess' || '%'), 'session token is stored only as a hash');

-- ---------------------------------------------------------------- bundle scoping
select public.share_bundle(:'sess', 'ip-3', 'UA') as b \gset
select test.ok(:'b'::jsonb ->> 'status' = 'ok', 'bundle is returned for a valid session');
select test.ok(:'b' like '%DENTAL-VISIT-MARKER%', 'in-scope specialty encounter is shared');
select test.ok(:'b' not like '%CARDIO-VISIT-MARKER%', 'other-specialty encounter is NOT shared');
select test.ok(:'b' not like '%OLD-DENTAL-MARKER%', 'encounter outside the date range is NOT shared');
select test.ok(:'b' not like '%BOB-%', 'no data of another patient appears anywhere in the bundle');
select test.ok(:'b' like '%CHRONIC-MARKER%', 'chronic conditions are always part of a share (safety core)');
select test.ok(:'b' like '%Penicillin%', 'allergies are always part of a share (safety core)');
select test.ok(:'b' like '%Metformin%', 'current medications are part of a share (safety core)');
select test.ok(:'b' not like '%STOPPED-MED-MARKER%', 'stopped medications are not listed as current');
select test.ok(:'b' not like '%SENSITIVE-MARKER%' and :'b' not like '%SENSITIVE-MED-MARKER%', 'sensitive conditions/medications are excluded by default');
select test.ok(:'b' like '%OTHER-COND-DENTAL-MARKER%' and :'b' not like '%OTHER-COND-CARDIO-MARKER%', 'non-chronic conditions follow the specialty scope');
select test.ok(:'b' like '%DENTAL-XRAY-DOC%', 'in-scope document is listed');
select test.ok(:'b' not like '%RESTRICTED-DOC%', 'restricted document is never listed in a scoped share');
select test.ok(:'b' not like '%CARDIO-DOC%', 'document of another specialty is not listed');
select test.ok(:'b' not like '%PHONE-MARKER%', 'phone number is not shared unless "contact" is included');
select test.ok(:'b' not like '%1098765432%', 'national id is never shared');
select test.ok(:'b' not like '%storage_path%' and :'b' not like '%' || :'pa' || '/d1.pdf%', 'storage paths never leave the database');
select test.ok(:'b' not like '%pin_hash%' and :'b' not like '%token_hash%', 'no secrets in the bundle');
select test.ok((:'b'::jsonb #> '{patient,age_years}')::int between 30 and 40, 'age is computed from date of birth');
select test.ok(jsonb_array_length(:'b'::jsonb -> 'observations') = 1, 'observations limited by specialty scope (glucose tagged dentistry only)');
select test.ok(not (:'b'::jsonb ? 'procedures') and not (:'b'::jsonb ? 'family_history') and not (:'b'::jsonb ? 'notes'), 'modules that were not selected are absent');

-- ---------------------------------------------------------------- documents
select public.share_document(:'sess', :'d_dent') as dd \gset
select test.ok(:'dd'::jsonb ->> 'status' = 'ok' and :'dd'::jsonb ->> 'storage_path' = :'pa' || '/d1.pdf', 'in-scope document is authorised');
select test.ok((:'dd'::jsonb ->> 'allow_download')::boolean = false, 'download permission is reported');
select test.ok(public.share_document(:'sess', :'d_restricted') ->> 'status' = 'forbidden', 'restricted document refused');
select test.ok(public.share_document(:'sess', :'d_card') ->> 'status' = 'forbidden', 'out-of-scope document refused');
select test.ok(public.share_document(:'sess', :'d_bob') ->> 'status' = 'forbidden', 'another patient document refused');
select test.ok(public.share_document(:'sess', gen_random_uuid()) ->> 'status' = 'forbidden', 'unknown document refused');

-- ---------------------------------------------------------------- doctor notes
select test.ok(public.share_add_note(:'sess', 'Dr. Molar', 'Please bring the latest panoramic film.') ->> 'status' = 'ok', 'doctor note accepted when allowed');
select test.ok(exists (select 1 from public.share_notes where reviewed_at is null and body like 'Please bring%'), 'note is stored unreviewed, not merged into the record');
select test.ok(not exists (select 1 from public.clinical_notes where body like 'Please bring%'), 'note does not touch the clinical record');

-- ---------------------------------------------------------------- PIN brute force, lock, auto-revoke
select test.as_user(:'alice'::uuid);
select public.share_create(:'pa', 'Brute target', 'full', '{}', '{}', '{}', null, null, now() + interval '1 day', 3) as sh2 \gset
select (:'sh2'::jsonb ->> 'share_id') as sid2, (:'sh2'::jsonb ->> 'token') as tok2, (:'sh2'::jsonb ->> 'pin') as pin2 \gset
select test.as_service();
select public.share_open(:'tok2', '111111', 'ipb') ->> 'status' as r1 \gset
select public.share_open(:'tok2', '111112', 'ipb') ->> 'status' as r2 \gset
select public.share_open(:'tok2', '111113', 'ipb') as r3 \gset
select test.ok(:'r1' = 'invalid_pin' and :'r2' = 'invalid_pin', 'wrong PINs are refused');
select test.ok(:'r3'::jsonb ->> 'status' = 'locked' and (:'r3'::jsonb ->> 'retry_after_seconds')::int = 900, 'max attempts locks the link for 15 minutes');
select test.ok(public.share_open(:'tok2', :'pin2', 'ipb') ->> 'status' = 'locked', 'the CORRECT PIN is refused while locked');
update public.medical_shares set locked_until = now() - interval '1 second' where id = :'sid2'::uuid;
select test.ok(public.share_open(:'tok2', :'pin2', 'ipb2') ->> 'status' = 'ok', 'correct PIN works after the lock expires');
-- repeated lock cycles end in automatic revocation
update public.medical_shares set lock_count = 0, locked_until = null, failed_attempts = 0 where id = :'sid2'::uuid;
select public.share_open(:'tok2', '222221', 'ipc') \g /dev/null
select public.share_open(:'tok2', '222222', 'ipc') \g /dev/null
select public.share_open(:'tok2', '222223', 'ipc') \g /dev/null
update public.medical_shares set locked_until = null where id = :'sid2'::uuid;
select public.share_open(:'tok2', '222224', 'ipd') \g /dev/null
select public.share_open(:'tok2', '222225', 'ipd') \g /dev/null
select public.share_open(:'tok2', '222226', 'ipd') \g /dev/null
select test.ok((select lock_count from public.medical_shares where id = :'sid2'::uuid) = 2, 'second lock doubles the delay');
update public.medical_shares set locked_until = null where id = :'sid2'::uuid;
select public.share_open(:'tok2', '222227', 'ipe') \g /dev/null
select public.share_open(:'tok2', '222228', 'ipe') \g /dev/null
select public.share_open(:'tok2', '222229', 'ipe') \g /dev/null
select test.ok((select revoked_at from public.medical_shares where id = :'sid2'::uuid) is not null, 'three lock cycles auto-revoke the share');
select test.ok(public.share_open(:'tok2', :'pin2', 'ipf') ->> 'status' = 'unavailable', 'auto-revoked share rejects even the correct PIN');
select test.ok(exists (select 1 from public.medical_share_access_logs where share_id = :'sid2'::uuid and event = 'auto_revoked'), 'auto-revocation is logged');

-- per-IP throttle across tokens
select public.share_open('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' || g, '123456', 'ip-spray') from generate_series(1, 20) g \g /dev/null
select test.ok(public.share_open(:'tok', :'pin', 'ip-spray') ->> 'status' = 'throttled', 'an IP spraying wrong tokens is throttled (even with valid credentials)');
select test.ok(public.share_open(:'tok', :'pin', 'ip-other') ->> 'status' = 'ok', 'other IPs are unaffected');

-- ---------------------------------------------------------------- revocation, expiry, session lifetime
select test.as_user(:'alice'::uuid);
select public.share_create(:'pa', 'To revoke', 'full', '{}', array['encounters'], '{}', null, null, now() + interval '1 day') as sh3 \gset
select (:'sh3'::jsonb ->> 'share_id') as sid3, (:'sh3'::jsonb ->> 'token') as tok3, (:'sh3'::jsonb ->> 'pin') as pin3 \gset
select test.as_service();
select (public.share_open(:'tok3', :'pin3', 'ip-r') ->> 'session_token') as sess3 \gset
select test.ok(public.share_bundle(:'sess3') ->> 'status' = 'ok', 'session works before revocation');
select test.as_user(:'alice'::uuid);
select public.share_revoke(:'sid3'::uuid, 'visit cancelled');
select test.as_service();
select test.ok(public.share_bundle(:'sess3') ->> 'status' = 'expired', 'revocation kills live sessions immediately');
select test.ok(public.share_document(:'sess3', :'d_dent') ->> 'status' = 'expired', 'revoked session cannot fetch documents');
select test.ok(public.share_open(:'tok3', :'pin3', 'ip-r') ->> 'status' = 'unavailable', 'revoked link cannot be reopened');
select test.ok(exists (select 1 from public.medical_share_access_logs where share_id = :'sid3'::uuid and event = 'revoked'), 'revocation is logged');

-- defence in depth: the revoked flag alone (sessions left in place) must also stop access
select test.as_user(:'alice'::uuid);
select public.share_create(:'pa', 'Flag only', 'full', '{}', array['encounters'], '{}', null, null, now() + interval '1 day') as sh6 \gset
select (:'sh6'::jsonb ->> 'share_id') as sid6, (:'sh6'::jsonb ->> 'token') as tok6, (:'sh6'::jsonb ->> 'pin') as pin6 \gset
select test.as_service();
select (public.share_open(:'tok6', :'pin6', 'ip-g') ->> 'session_token') as sess6 \gset
select test.as_super();
update public.medical_shares set revoked_at = now() where id = :'sid6'::uuid;
select test.ok(exists (select 1 from public.medical_share_sessions where share_id = :'sid6'::uuid), '(precondition) the session row still exists');
select test.as_service();
select test.ok(public.share_bundle(:'sess6') ->> 'status' = 'expired', 'revoked flag alone blocks the bundle even if a session row survives');
select test.ok(public.share_document(:'sess6', :'d_dent') ->> 'status' = 'expired', 'revoked flag alone blocks document access');
select test.ok(public.share_add_note(:'sess6', 'Dr X', 'late note') ->> 'status' = 'expired', 'revoked flag alone blocks notes');

-- expiry of the share itself
select test.as_super();
update public.medical_shares set created_at = now() - interval '3 days', expires_at = now() - interval '1 hour' where id = :'sid'::uuid;
select test.as_service();
select test.ok(public.share_bundle(:'sess') ->> 'status' = 'expired', 'an expired share stops serving data, even on an existing session');
select test.ok(public.share_open(:'tok', :'pin', 'ip-e') ->> 'status' = 'unavailable', 'an expired link cannot be opened');
select test.as_super();
update public.medical_shares set created_at = now() - interval '1 hour', expires_at = now() + interval '1 day' where id = :'sid'::uuid;
select test.as_service();
select test.ok(public.share_bundle(:'sess') ->> 'status' = 'ok', '(control) session works again when the share is valid');
select test.as_super();
update public.medical_share_sessions set expires_at = now() - interval '1 minute' where share_id = :'sid'::uuid;
select test.as_service();
select test.ok(public.share_bundle(:'sess') ->> 'status' = 'expired', 'a session lasts at most 30 minutes and then needs the PIN again');
select (public.share_open(:'tok', :'pin', 'ip-3') ->> 'session_token') as sess_b \gset
select public.share_end_session(:'sess_b');
select test.ok(public.share_bundle(:'sess_b') ->> 'status' = 'expired', 'ending the session logs the viewer out');
select test.ok(public.share_bundle('x') ->> 'status' = 'expired' and public.share_bundle(null) ->> 'status' = 'expired', 'garbage session tokens are refused');

-- ---------------------------------------------------------------- custom share and full share
select test.as_user(:'alice'::uuid);
select public.share_create(:'pa', 'One visit', 'custom', '{}', array['encounters','observations'], '{}', null, null, now() + interval '1 day', 5, false, false, false, false, null,
  jsonb_build_array(jsonb_build_object('table','encounters','id',:'e_card'), jsonb_build_object('table','observations','id',:'o_dent'))) as sh4 \gset
select (:'sh4'::jsonb ->> 'token') as tok4, (:'sh4'::jsonb ->> 'pin') as pin4 \gset
select test.as_service();
select (public.share_open(:'tok4', :'pin4', 'ip-c') ->> 'session_token') as sess4 \gset
select public.share_bundle(:'sess4') as b4 \gset
select test.ok(:'b4' like '%CARDIO-VISIT-MARKER%' and :'b4' not like '%DENTAL-VISIT-MARKER%', 'custom share exposes only the picked encounter');
select test.ok(jsonb_array_length(:'b4'::jsonb -> 'observations') = 1, 'custom share exposes only the picked observation');
select test.ok(public.share_add_note(:'sess4', 'Dr X', 'hello') ->> 'status' = 'forbidden', 'notes refused when the patient did not allow them');
select test.ok(public.share_document(:'sess4', :'d_dent') ->> 'status' = 'forbidden', 'documents refused when not part of the share');

select test.as_user(:'alice'::uuid);
select public.share_create(:'pa', 'Everything', 'full', '{}', array['contact','other_conditions','procedures','family_history','immunizations','encounters','observations','imaging','documents','specialty_records','notes','care_plans'],
  '{}', null, null, now() + interval '1 day', 5, true, true, false, true) as sh5 \gset
select (:'sh5'::jsonb ->> 'token') as tok5, (:'sh5'::jsonb ->> 'pin') as pin5 \gset
select test.as_service();
select (public.share_open(:'tok5', :'pin5', 'ip-f') ->> 'session_token') as sess5 \gset
select public.share_bundle(:'sess5') as b5 \gset
select test.ok(:'b5' like '%DENTAL-VISIT-MARKER%' and :'b5' like '%CARDIO-VISIT-MARKER%' and :'b5' like '%OLD-DENTAL-MARKER%', 'full share includes all encounters');
select test.ok(:'b5' like '%PHONE-MARKER%', '"contact" module adds the phone number');
select test.ok(:'b5' like '%SENSITIVE-MARKER%' and :'b5' like '%SENSITIVE-MED-MARKER%', 'sensitive items appear only when the patient opted in');
select test.ok(:'b5' like '%CARDIO-DOC%' and :'b5' not like '%RESTRICTED-DOC%', 'restricted documents stay out of non-custom shares even in a full share');
select test.ok(:'b5' not like '%BOB-%', 'full share still contains nothing of another patient');
select test.ok((public.share_document(:'sess5', :'d_dent') ->> 'allow_download')::boolean, 'download permission can be granted');

-- ---------------------------------------------------------------- the patient's view of what happened
select test.as_user(:'alice'::uuid);
select test.ok((select count(*) from public.medical_share_access_logs where share_id = :'sid'::uuid and event = 'opened') >= 1, 'patient can see when the share was opened');
select test.ok((select count(*) from public.medical_share_access_logs where share_id = :'sid'::uuid and event = 'pin_failed') = 2, 'patient can see failed PIN attempts');
select test.ok((select count(*) from public.medical_share_access_logs where share_id = :'sid'::uuid and event = 'document_opened') >= 1, 'patient can see document access');
select test.ok((select count(*) from public.share_notes) = 1, 'patient sees the doctor note');
select public.share_mark_note_reviewed((select id from public.share_notes limit 1));
select test.ok((select reviewed_at from public.share_notes limit 1) is not null, 'patient can mark a note as reviewed');
select test.as_super();
select test.ok(not exists (select 1 from public.medical_share_access_logs where detail::text like '%' || :'pin' || '%' or detail::text like '%' || :'tok' || '%'
                            or user_agent like '%' || :'tok' || '%' or ip_hash like '%' || :'tok' || '%'), 'access logs never contain the PIN or token');
select test.as_user(:'bob'::uuid);
select test.ok((select count(*) from public.share_notes) = 0, 'bob cannot see alice share notes');
