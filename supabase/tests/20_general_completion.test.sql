\pset tuples_only on
\set alice 'a1111111-1111-1111-1111-111111111111'
\set bob 'b2222222-2222-2222-2222-222222222222'
\set dave 'd4444444-4444-4444-4444-444444444444'
select id as t_height from public.observation_types where code = 'height' \gset

select test.as_user(:'alice'::uuid);
select public.create_patient('General Patient', date '1980-03-03', 'female', null, null, null, null, null, null, 'self', true) as pg \gset
select public.create_patient('Other Of Alice', date '1990-01-01', 'male', null, null, null, null, null, null, 'self', true) as po \gset
select test.as_user(:'bob'::uuid);
select public.create_patient('Bob Patient', date '1970-01-01', 'male', null, null, null, null, null, null, 'self', true) as pb \gset
-- dave reads Alice's general file (a caregiver without write rights)
select test.as_super();
insert into public.patient_members (patient_id, user_id, role, can_write, can_share) values (:'pg', :'dave'::uuid, 'caregiver', false, false);

-- =============================================================== structured social history
select test.as_user(:'alice'::uuid);
insert into public.patient_health_profile (patient_id, tobacco_status, activity_minutes_per_week, activity_days_per_week, diet_pattern, sleep_hours, sleep_quality,
                                           substance_use_status, substance_types, substance_notes, living_situation)
  values (:'pg', 'never', 150, 4, 'balanced', 7.5, 'fair', 'former', array['cannabis'], 'stopped in 2015', 'with_family');
select test.ok((select activity_minutes_per_week = 150 and sleep_hours = 7.5 and living_situation = 'with_family' and diet_pattern = 'balanced'
                  from public.patient_health_profile where patient_id = :'pg'), 'the structured social history is kept on the health profile');
select test.throws(format($$insert into public.patient_health_profile (patient_id, activity_minutes_per_week) values (%L, 9000)$$, :'po'), 'check constraint|violates', 'activity minutes stay within a week');
select test.throws(format($$insert into public.patient_health_profile (patient_id, activity_days_per_week) values (%L, 9)$$, :'po'), 'check constraint|violates', 'activity days stay within a week');
select test.throws(format($$insert into public.patient_health_profile (patient_id, sleep_hours) values (%L, 30)$$, :'po'), 'check constraint|violates', 'sleep hours stay within a day');
select test.throws(format($$insert into public.patient_health_profile (patient_id, sleep_quality) values (%L, 'dreamy')$$, :'po'), 'check constraint|violates', 'an unknown sleep quality is refused');
select test.throws(format($$insert into public.patient_health_profile (patient_id, diet_pattern) values (%L, 'carnivore')$$, :'po'), 'check constraint|violates', 'an unknown diet pattern is refused');
select test.throws(format($$insert into public.patient_health_profile (patient_id, living_situation) values (%L, 'castle')$$, :'po'), 'check constraint|violates', 'an unknown living situation is refused');
select test.throws(format($$insert into public.patient_health_profile (patient_id, substance_use_status, substance_types) values (%L, 'none', array['opioids'])$$, :'po'),
  'check constraint|violates', 'substance types only with a current or former use');
select test.throws(format($$insert into public.patient_health_profile (patient_id, substance_use_status, substance_types) values (%L, 'current', array['magic'])$$, :'po'),
  'check constraint|violates', 'an unknown substance type is refused');
select test.ok(pg_get_functiondef('public.share_context(text)'::regprocedure) !~* 'substance_|patient_exposures|sleep_|living_situation',
  'the sensitive social-history fields are not part of the share context');

-- exposures: a list with years and protective equipment
insert into public.patient_exposures (patient_id, kind, agent, years, protective_equipment, ongoing)
  values (:'pg', 'silica', 'quarry dust', 12.5, 'sometimes', false) returning id as ex1 \gset
select test.ok((select verification = 'reported' and recorded_by = :'alice'::uuid and record_status = 'active' from public.patient_exposures where id = :'ex1'), 'an exposure is recorded with provenance');
select test.throws(format($$insert into public.patient_exposures (patient_id, kind) values (%L, 'magic')$$, :'pg'), 'check constraint|violates', 'an unknown exposure kind is refused');
select test.throws(format($$insert into public.patient_exposures (patient_id, kind, years) values (%L, 'dust', 120)$$, :'pg'), 'check constraint|violates', 'exposure years stay plausible');
select test.throws(format($$insert into public.patient_exposures (patient_id, kind, protective_equipment) values (%L, 'dust', 'always-ish')$$, :'pg'), 'check constraint|violates', 'protective equipment has fixed choices');
select test.throws(format($$update public.patient_exposures set record_status = 'entered_in_error' where id = %L$$, :'ex1'), 'reason', 'an exposure cannot be invalidated without a reason');
update public.patient_exposures set record_status = 'entered_in_error', invalidated_reason = 'wrong job' where id = :'ex1';
select test.throws(format($$update public.patient_exposures set years = 3 where id = %L$$, :'ex1'), 'entered-in-error', 'an invalidated exposure cannot be edited');
insert into public.patient_exposures (patient_id, kind, agent, years, protective_equipment) values (:'pg', 'solvents', 'paint thinner', 4, 'always');
select test.as_user(:'bob'::uuid);
select test.ok((select count(*) = 0 from public.patient_exposures where patient_id = :'pg'), 'another account sees no exposures');
select test.throws(format($$insert into public.patient_exposures (patient_id, kind) values (%L, 'dust')$$, :'pg'), 'row-level security|permission', 'nor adds one');
select test.as_user(:'dave'::uuid);
select test.ok((select count(*) = 2 from public.patient_exposures where patient_id = :'pg'), 'a read-only member sees the exposures');
select test.throws(format($$insert into public.patient_exposures (patient_id, kind) values (%L, 'dust')$$, :'pg'), 'row-level security|permission', 'but cannot add one');

-- =============================================================== symptom log
select test.as_user(:'alice'::uuid);
insert into public.conditions (patient_id, name, category, certainty) values (:'pg', 'Migraine', 'chronic', 'confirmed') returning id as cmig \gset
insert into public.symptom_entries (patient_id, symptom, body_site, severity, onset_at, pattern, triggers, relieved_by, condition_id, notes)
  values (:'pg', 'Headache', 'left temple', 6, now() - interval '3 days', 'episodic', 'bright light', 'dark room', :'cmig', 'pulsating')
  returning id as sy1 \gset
insert into public.symptom_entries (patient_id, symptom, severity, onset_at, ended_at) values (:'pg', 'Headache', 3, now() - interval '1 day', now() - interval '20 hours') returning id as sy2 \gset
select test.ok((select verification = 'reported' and recorded_by = :'alice'::uuid and record_status = 'active' and condition_id = :'cmig' from public.symptom_entries where id = :'sy1'),
  'a symptom is recorded with provenance and can be tied to a condition');
select test.ok((select count(*) = 2 from public.symptom_entries where patient_id = :'pg' and symptom = 'Headache'), 'the same symptom is logged more than once (a series)');
select test.throws(format($$insert into public.symptom_entries (patient_id, symptom, severity, onset_at) values (%L, 'Cough', 11, now())$$, :'pg'), 'check constraint|violates', 'severity is 0 to 10');
select test.throws(format($$insert into public.symptom_entries (patient_id, symptom, severity, onset_at) values (%L, 'Cough', -1, now())$$, :'pg'), 'check constraint|violates', 'severity is not negative');
insert into public.symptom_entries (patient_id, symptom, severity, onset_at) values (:'pg', 'Nausea', 0, now() - interval '2 days');
select test.ok((select count(*) = 1 from public.symptom_entries where severity = 0), 'severity 0 (none) is allowed');
select test.throws(format($$insert into public.symptom_entries (patient_id, symptom, onset_at, ended_at) values (%L, 'Cough', now(), now() - interval '1 day')$$, :'pg'),
  'check constraint|violates', 'a symptom cannot end before it began');
select test.throws(format($$insert into public.symptom_entries (patient_id, symptom, onset_at) values (%L, 'x', now())$$, :'pg'), 'check constraint|violates', 'the symptom needs a name');
select test.throws(format($$insert into public.symptom_entries (patient_id, symptom, onset_at, pattern) values (%L, 'Cough', now(), 'weird')$$, :'pg'), 'check constraint|violates', 'the pattern has fixed choices');
select test.throws(format($$insert into public.symptom_entries (patient_id, symptom, onset_at) values (%L, 'Cough', null)$$, :'pg'), 'null value|not-null', 'the onset is required');
insert into public.conditions (patient_id, name, category) values (:'po', 'Foreign condition', 'chronic') returning id as cforeign \gset
select test.throws(format($$insert into public.symptom_entries (patient_id, symptom, onset_at, condition_id) values (%L, 'Cough', now(), %L)$$, :'pg', :'cforeign'),
  'foreign key|violates', 'a symptom cannot point at another patient''s condition');
select test.throws(format($$insert into public.symptom_entries (patient_id, symptom, onset_at, record_status) values (%L, 'Cough', now(), 'entered_in_error')$$, :'pg'),
  'new records must be active', 'a new symptom entry is active');
select test.throws(format($$update public.symptom_entries set patient_id = %L where id = %L$$, :'po', :'sy1'), 'immutable', 'a symptom cannot be moved to another patient');
select test.throws(format($$update public.symptom_entries set recorded_by = %L where id = %L$$, :'bob', :'sy1'), 'immutable', 'who recorded it cannot be rewritten');
update public.symptom_entries set severity = 7, ended_at = now() where id = :'sy1';
select test.ok((select severity = 7 and updated_by = :'alice'::uuid from public.symptom_entries where id = :'sy1'), 'an entry can be edited and the editor is stamped');
select test.ok((select count(*) >= 2 from public.audit_logs where table_name = 'symptom_entries' and record_id = :'sy1' and patient_id = :'pg'), 'symptom entries are audited');
select test.throws(format($$update public.symptom_entries set record_status = 'entered_in_error' where id = %L$$, :'sy2'), 'reason', 'an entry is not invalidated without a reason');
update public.symptom_entries set record_status = 'entered_in_error', invalidated_reason = 'logged twice' where id = :'sy2';
select test.ok((select invalidated_by = :'alice'::uuid and invalidated_at is not null from public.symptom_entries where id = :'sy2'), 'invalidation stamps who and when');
select test.ok((select action = 'invalidate' from public.audit_logs where table_name = 'symptom_entries' and record_id = :'sy2' order by id desc limit 1), 'and is audited as an invalidation');
select test.throws(format($$update public.symptom_entries set severity = 1 where id = %L$$, :'sy2'), 'entered-in-error', 'an invalidated entry cannot be edited');

-- isolation
select test.as_user(:'bob'::uuid);
select test.ok((select count(*) = 0 from public.symptom_entries where patient_id = :'pg'), 'another account sees no symptoms');
select test.throws(format($$insert into public.symptom_entries (patient_id, symptom, onset_at) values (%L, 'Cough', now())$$, :'pg'), 'row-level security|permission', 'nor adds one');
with u as (update public.symptom_entries set severity = 1 where patient_id = :'pg' returning 1) select count(*) as bob_upd from u \gset
select test.ok(:bob_upd = 0, 'nor edits one');
select test.as_user(:'dave'::uuid);
select test.ok((select count(*) = 3 from public.symptom_entries where patient_id = :'pg'), 'a read-only member sees the log');
select test.throws(format($$insert into public.symptom_entries (patient_id, symptom, onset_at) values (%L, 'Cough', now())$$, :'pg'), 'row-level security|permission', 'but cannot write to it');
select test.as_anon();
select test.throws(format($$select count(*) from public.symptom_entries where patient_id = %L$$, :'pg'), 'permission denied', 'a signed-out request reads nothing');

-- =============================================================== search inside the file
select test.as_user(:'alice'::uuid);
insert into public.medications (patient_id, name_generic, indication, status) values (:'pg', 'Amoxicillin', 'tooth abscess', 'active') returning id as md1 \gset
insert into public.medications (patient_id, name_generic, status) values (:'pg', 'أموكسيسيلين', 'active') returning id as md2 \gset
insert into public.medications (patient_id, name_generic, status) values (:'po', 'Amoxicillin OTHERFILE', 'active');
insert into public.clinical_notes (patient_id, kind, title, body, noted_at) values (:'pg', 'patient_note', 'Chest review', 'Short breath and chest tightness on the stairs', now() - interval '2 days') returning id as nt1 \gset
insert into public.allergies (patient_id, substance, reaction) values (:'pg', 'Penicillin', 'hives') returning id as al1 \gset
insert into public.encounters (patient_id, kind, started_at, reason, assessment, plan) values (:'pg', 'clinic', now() - interval '5 days', 'Routine review', 'Hypertension suspected', 'Start home BP log') returning id as en1 \gset
insert into public.procedures (patient_id, kind, name, performed_on) values (:'pg', 'procedure', 'Colonoscopy', current_date - 100) returning id as pr1 \gset
insert into public.imaging_studies (patient_id, modality, body_site, performed_on, impression) values (:'pg', 'xray', 'chest', current_date - 30, 'Clear lung fields, no effusion') returning id as im1 \gset
select format('%L', :'pg' || '/search.pdf') as sp \gset
select test.as_service();
insert into public.medical_documents (uploaded_by, patient_id, doc_type, title, storage_path, original_filename, mime_type, size_bytes, sha256)
  values (:'alice', :'pg', 'doctor_report', 'Cardiology letter 2025', :sp, 'search.pdf', 'application/pdf', 100, repeat('a', 64)) returning id as dc1 \gset
select test.as_user(:'alice'::uuid);
insert into public.observations (patient_id, type_id, value_num, unit, effective_at) values (:'pg', :'t_height', 165, 'cm', now() - interval '2 days') returning id as ob1 \gset
insert into public.lab_reports (patient_id, title, lab_name, collected_at) values (:'pg', 'Lipid panel', 'Al Noor Lab', now() - interval '10 days') returning id as lr1 \gset

select test.ok((select count(*) = 1 from public.patient_search(:'pg', 'amoxicillin') where record_id = :'md1' and table_name = 'medications' and link_kind = 'medications'), 'search finds a medication');
select test.ok((select snippet like '%abscess%' or title = 'Amoxicillin' from public.patient_search(:'pg', 'amoxi') where record_id = :'md1'), 'a partial word matches and the hit carries a snippet');
select test.ok((select count(*) = 1 from public.patient_search(:'pg', 'اموكسيسيلين') where record_id = :'md2'), 'Arabic letter forms are folded (alef with hamza)');
select test.ok((select count(*) = 1 from public.patient_search(:'pg', 'CHEST TIGHTNESS') where record_id = :'nt1'), 'case is ignored');
select test.ok((select count(*) = 1 from public.patient_search(:'pg', 'tightness') where record_id = :'nt1' and link_kind = 'notes' and snippet ilike '%tightness%'), 'search finds a note by its body, with an excerpt');
select test.ok((select count(*) = 1 from public.patient_search(:'pg', 'hives') where record_id = :'al1' and link_kind = 'allergies'), 'search finds an allergy by its reaction');
select test.ok((select count(*) = 1 from public.patient_search(:'pg', 'home BP') where record_id = :'en1' and link_kind = 'visits'), 'search finds a visit by its plan');
select test.ok((select count(*) = 1 from public.patient_search(:'pg', 'hypertension') where record_id = :'en1'), 'or by its assessment');
select test.ok((select count(*) = 1 from public.patient_search(:'pg', 'colonoscopy') where record_id = :'pr1' and link_kind = 'procedures'), 'search finds a procedure');
select test.ok((select count(*) = 1 from public.patient_search(:'pg', 'effusion') where record_id = :'im1' and link_kind = 'imaging'), 'search finds an imaging study by its impression');
select test.ok((select count(*) = 1 from public.patient_search(:'pg', 'cardiology') where record_id = :'dc1' and link_kind = 'documents'), 'search finds a document by its title');
select test.ok((select count(*) = 1 from public.patient_search(:'pg', 'height') where record_id = :'ob1' and link_kind = 'vitals'), 'search finds a measurement by its name (a vital sign)');
select test.ok((select count(*) = 1 from public.patient_search(:'pg', 'lipid') where record_id = :'lr1' and link_kind = 'labs'), 'and a lab report by its title');
select test.ok((select count(*) = 1 from public.patient_search(:'pg', 'migraine') where table_name = 'conditions' and link_kind = 'conditions'), 'search finds a condition');
select test.ok((select count(*) = 1 from public.patient_search(:'pg', 'pulsating') where record_id = :'sy1' and link_kind = 'symptoms'), 'search finds a symptom by its notes');
select test.ok((select count(*) = 1 from public.patient_search(:'pg', 'bright light') where record_id = :'sy1'), 'or by its triggers');

-- limits
select test.ok((select count(*) = 0 from public.patient_search(:'pg', 'a')), 'a one-character query returns nothing');
select test.ok((select count(*) = 0 from public.patient_search(:'pg', '   ')), 'a blank query returns nothing');
select test.ok((select count(*) = 0 from public.patient_search(:'pg', null)), 'a null query returns nothing');
select test.ok((select count(*) = 0 from public.patient_search(:'pg', '%%')), 'wildcards are text, not patterns');
select test.ok((select count(*) = 0 from public.patient_search(:'pg', '__')), 'underscores are text, not patterns');
select test.ok((select count(*) = 0 from public.patient_search(:'pg', repeat('x', 101))), 'an over-long query returns nothing');
select test.ok((select count(*) = 0 from public.patient_search(:'pg', 'zzqqxx')), 'no match, no rows');

-- recency, caps
insert into public.clinical_notes (patient_id, kind, title, body, noted_at) select :'pg', 'patient_note', 'Bulk ' || g, 'bulkterm number ' || g, now() - (g || ' hours')::interval from generate_series(1, 30) g;
select test.ok((select count(*) = 15 from public.patient_search(:'pg', 'bulkterm')), 'one source returns at most 15 hits');
select test.ok((select title = 'Bulk 1' from public.patient_search(:'pg', 'bulkterm') limit 1), 'the newest comes first');
insert into public.medications (patient_id, name_generic, status) select :'pg', 'bulkterm drug ' || g, 'active' from generate_series(1, 20) g;
insert into public.symptom_entries (patient_id, symptom, onset_at) select :'pg', 'bulkterm symptom ' || g, now() - (g || ' days')::interval from generate_series(1, 20) g;
select test.ok((select count(*) = 45 from public.patient_search(:'pg', 'bulkterm')), 'three sources of 15 give 45 hits: each source is capped, none crowds out the others');
select test.ok((select count(distinct link_kind) = 3 from public.patient_search(:'pg', 'bulkterm')), 'across notes, medications and symptoms');

-- invalidated records are not searched
update public.medications set record_status = 'entered_in_error', invalidated_reason = 'entered twice' where id = :'md1';
select test.ok((select count(*) = 0 from public.patient_search(:'pg', 'amoxicillin')), 'entered-in-error records are not searched');

-- isolation
select test.ok((select count(*) = 0 from public.patient_search(:'pg', 'OTHERFILE')), 'a search never returns another patient''s rows (same account)');
select test.ok((select count(*) = 1 from public.patient_search(:'po', 'OTHERFILE')), 'but finds them in their own file');
select test.as_user(:'bob'::uuid);
select test.ok((select count(*) = 0 from public.patient_search(:'pg', 'chest')), 'another account searching this file finds nothing (RLS)');
select test.ok((select count(*) = 0 from public.patient_search(:'po', 'OTHERFILE')), 'nor in the other file');
insert into public.medications (patient_id, name_generic, status) values (:'pb', 'BobDrug chest', 'active');
select test.ok((select count(*) = 1 from public.patient_search(:'pb', 'chest')) and (select count(*) = 0 from public.patient_search(:'pb', 'tightness')), 'a search in one''s own file sees only that file');
select test.as_user(:'dave'::uuid);
select test.ok((select count(*) = 1 from public.patient_search(:'pg', 'tightness')), 'a member with read access can search');
select test.as_anon();
select test.throws(format($$select * from public.patient_search(%L, 'chest')$$, :'pg'), 'permission denied', 'a signed-out request cannot search');
select test.as_super();
select test.ok((select p.prosecdef = false from pg_proc p where p.oid = 'public.patient_search(uuid, text)'::regprocedure), 'the search runs with the caller''s rights (invoker)');

-- =============================================================== export
select test.as_user(:'alice'::uuid);
select public.patient_export_data(:'pg') as expj \gset
select test.ok((:'expj'::jsonb -> 'patients' -> 0 ->> 'id') = :'pg', 'the export carries the patient');
select test.ok(jsonb_array_length(:'expj'::jsonb -> 'conditions') >= 1 and jsonb_array_length(:'expj'::jsonb -> 'symptom_entries') = 23, 'and the symptom log, active and invalidated alike');
select test.ok(exists (select 1 from jsonb_array_elements(:'expj'::jsonb -> 'symptom_entries') e where e ->> 'record_status' = 'entered_in_error'), 'invalidated records are included');
select test.ok(exists (select 1 from jsonb_array_elements(:'expj'::jsonb -> 'patient_exposures') e where e ->> 'record_status' = 'entered_in_error')
           and exists (select 1 from jsonb_array_elements(:'expj'::jsonb -> 'medications') e where e ->> 'record_status' = 'entered_in_error'), 'also for exposures and medications');
select test.ok(jsonb_array_length(:'expj'::jsonb -> 'medical_documents') = 1 and jsonb_array_length(:'expj'::jsonb -> 'observations') = 1, 'documents and measurements are included');
select test.ok(position(:'po' in :'expj') = 0 and position('OTHERFILE' in :'expj') = 0, 'nothing of another patient is in the export');
select test.ok(not (:'expj'::jsonb ? 'audit_logs') and not (:'expj'::jsonb ? 'medical_shares') and not (:'expj'::jsonb ? 'medical_share_sessions') and not (:'expj'::jsonb ? 'patient_members'),
  'share links, sessions, members and the audit log are not exported');
select test.ok(jsonb_array_length(:'expj'::jsonb -> 'catalogs' -> 'observation_types') > 20 and jsonb_array_length(:'expj'::jsonb -> 'catalogs' -> 'medical_specialties') > 20,
  'the catalogs the records point to travel with the export');
select test.ok(:'expj'::jsonb ? 'perio_exams' and :'expj'::jsonb ? 'patient_health_profile', 'every table that holds the patient''s records is covered');
select test.as_user(:'dave'::uuid);
select test.throws(format($$select public.patient_export_data(%L)$$, :'pg'), 'forbidden', 'a member without manage rights cannot export');
select test.throws(format($$select public.patient_export_log(%L, 0)$$, :'pg'), 'forbidden', 'nor write the export to the audit log');
select test.as_user(:'bob'::uuid);
select test.throws(format($$select public.patient_export_data(%L)$$, :'pg'), 'forbidden', 'an unrelated account cannot export');
select test.as_anon();
select test.throws(format($$select public.patient_export_data(%L)$$, :'pg'), 'permission denied', 'a signed-out request cannot export');
select test.as_user(:'alice'::uuid);
select public.patient_export_log(:'pg', 4);
select test.ok((select actor_id = :'alice'::uuid and (new_data ->> 'documents')::int = 4 from public.audit_logs where patient_id = :'pg' and action = 'export' order by id desc limit 1), 'the export is written to the audit log');
select test.ok((select count(*) = 0 from public.audit_logs where patient_id = :'pb' and action = 'export'), 'only for the exported file');

-- =============================================================== purge
select public.patient_request_deletion(:'pg', 'General Patient');
select test.as_service();
select public.patient_purge(:'pg', true);
select test.ok((select count(*) = 0 from public.symptom_entries where patient_id = :'pg') and (select count(*) = 0 from public.patient_exposures where patient_id = :'pg'),
  'symptoms and exposures are purged with the file');
select test.as_super();
