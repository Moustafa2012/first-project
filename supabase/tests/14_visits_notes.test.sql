\pset tuples_only on
\set alice 'a1111111-1111-1111-1111-111111111111'
\set bob 'b2222222-2222-2222-2222-222222222222'
select id as s_dent from public.medical_specialties where code = 'dentistry' \gset

select test.as_user(:'alice'::uuid);
select public.create_patient('Visit Patient', date '1985-01-01', 'male', null, null, null, null, null, null, 'self', true) as pv \gset

-- the dental visit
insert into public.encounters (patient_id, specialty_id, kind, started_at, reason, teeth, anesthesia_kind, anesthetic, materials, complications, instructions)
values (:'pv', :'s_dent', 'dental', now() - interval '1 day', 'Filling 16', '{16}', 'local_infiltration', 'Articaine 4% 1:100k — 1.8 ml', 'Composite A2', 'none',
        'No eating for 2 hours') returning id as enc \gset
select test.ok((select teeth = '{16}' and anesthesia_kind = 'local_infiltration' and materials = 'Composite A2' from public.encounters where id = :'enc'),
  'a dental visit records the teeth, the anaesthesia, the materials and the instructions');
select test.throws(format($$update public.encounters set anesthesia_kind = 'magic' where id = %L$$, :'enc'), 'check constraint|violates', 'the anaesthesia kind is one of the known ones');

-- notes: a draft is edited, a signed note is not
insert into public.clinical_notes (patient_id, specialty_id, kind, title, body) values (:'pv', :'s_dent', 'progress', 'Visit note', 'first text') returning id as n1 \gset
select test.ok((select status = 'draft' and signed_at is null from public.clinical_notes where id = :'n1'), 'a new note is a draft');
update public.clinical_notes set body = 'corrected draft' where id = :'n1';
select test.ok((select body = 'corrected draft' from public.clinical_notes where id = :'n1'), 'a draft is edited directly');
select test.throws(format($$insert into public.note_amendments (patient_id, note_id, body, reason) values (%L, %L, 'x', 'too early')$$, :'pv', :'n1'),
  'note_not_signed', 'a draft is not amended');
update public.clinical_notes set status = 'signed', signed_name = 'someone else' where id = :'n1';
select test.ok((select status = 'signed' and signed_at is not null and signed_by = :'alice'::uuid from public.clinical_notes where id = :'n1'),
  'signing records who and when (not what the client says)');
select test.throws(format($$update public.clinical_notes set body = 'rewritten' where id = %L$$, :'n1'), 'note_signed', 'a signed note is not rewritten');
select test.throws(format($$update public.clinical_notes set status = 'draft' where id = %L$$, :'n1'), 'note_signed', 'nor turned back into a draft');
insert into public.note_amendments (patient_id, note_id, body, reason) values (:'pv', :'n1', 'the filling was on 16 MO, not 16 O', 'wrong surfaces');
select test.ok((select count(*) = 1 from public.note_amendments where note_id = :'n1' and amended_by = :'alice'::uuid)
               and (select body = 'corrected draft' from public.clinical_notes where id = :'n1'),
  'an amendment is added next to the original, which is kept');
select test.throws(format($$update public.note_amendments set body = 'x' where note_id = %L$$, :'n1'), 'permission denied|row-level', 'an amendment is not edited');
select test.throws(format($$insert into public.note_amendments (patient_id, note_id, body, reason) values (%L, %L, 'x', 'no')$$, :'pv', :'n1'),
  'check constraint|violates', 'an amendment gives a reason');
update public.clinical_notes set record_status = 'entered_in_error', invalidated_reason = 'wrong file' where id = :'n1';
select test.ok((select record_status = 'entered_in_error' from public.clinical_notes where id = :'n1'), 'a signed note can still be marked entered in error');

-- templates: the shared catalogue and one's own
select test.ok((select count(*) >= 12 from public.note_templates where owner_id is null), 'a shared catalogue of note templates');
insert into public.note_templates (lang, title, body) values ('en', 'My crown prep', 'Shade:\nMargin:') returning id as tpl \gset
select test.throws($$insert into public.note_templates (owner_id, lang, title, body) values (null, 'en', 'Shared?', 'x')$$, 'row-level|permission', 'only an administrator adds to the shared catalogue');
select test.as_user(:'bob'::uuid);
select test.ok((select count(*) = 0 from public.note_templates where id = :'tpl'), 'one''s own templates are private');

-- recalls advance on their own
select test.as_user(:'alice'::uuid);
insert into public.recalls (patient_id, specialty_id, kind, interval_months, due_on) values (:'pv', :'s_dent', 'dental_checkup', 6, current_date - 10) returning id as rc \gset
insert into public.recalls (patient_id, specialty_id, kind, interval_months, due_on) values (:'pv', :'s_dent', 'dental_cleaning', 6, current_date + 30) returning id as rcl \gset
select public.dental_exam_create(:'pv', jsonb_build_object('exam_date', current_date - 2, 'kind', 'periodic'), '[{"tooth":11,"status":"present"}]', '[]');
select test.ok((select last_done_on = current_date - 2 and due_on = (current_date - 2 + interval '6 months')::date from public.recalls where id = :'rc'),
  'a periodic exam moves the check-up recall forward');
select public.treatment_plan_create(:'pv', '{"title":"Hygiene"}', '[{"catalog_code":"scaling"}]') as tp \gset
select public.treatment_plan_set_status(:'tp', 'accepted');
select public.treatment_item_set_status((select id from public.treatment_items where plan_id = :'tp'), 'completed', current_date) as r \gset
select test.ok((select last_done_on = current_date from public.recalls where id = :'rcl'), 'completing a cleaning moves the cleaning recall forward');
select public.recall_done(:'rc', current_date);
select test.ok((select due_on = (current_date + interval '6 months')::date from public.recalls where id = :'rc'), 'or marked done by hand');
select test.throws($$insert into public.recalls (patient_id, kind, interval_months, due_on) values ('00000000-0000-0000-0000-000000000000', 'dental_checkup', 0, current_date)$$,
  'check constraint|violates|row-level', 'the interval is at least a month');
select test.as_user(:'bob'::uuid);
select test.ok((select count(*) = 0 from public.recalls where patient_id = :'pv'), 'another account sees no recall');
select test.throws(format($$select public.recall_done(%L)$$, :'rc'), 'not_found', 'nor marks one done');

-- the dentist through a share: their note is signed with their name; only they amend it
select test.as_user(:'alice'::uuid);
select public.share_create(p_patient => :'pv', p_title => 'Dentist', p_scope_kind => 'specialty', p_specialty_ids => array[:'s_dent'::uuid],
  p_expires_at => now() + interval '1 day', p_allow_contribute => true, p_contribute_modules => array['clinical_notes', 'encounters']) as sh \gset
select (:'sh'::jsonb ->> 'token') as tok, (:'sh'::jsonb ->> 'pin') as pin \gset
select test.as_service();
select (public.share_open(:'tok', :'pin', 'ip-vn', 'UA') ->> 'session_token') as sess \gset
select (public.share_identify(:'sess', 'Dr Note', null, null, null, null, :'pv' || '/signatures/n.png') ->> 'contributor_id') as ctr \gset
select (public.share_contribute(:'sess', 'encounters', jsonb_build_object('kind', 'dental', 'started_at', now(), 'teeth', '[36]'::jsonb,
        'anesthesia_kind', 'nerve_block', 'materials', 'GIC')) ->> 'id') as denc \gset
select test.ok((select teeth = '{36}' and anesthesia_kind = 'nerve_block' from public.encounters where id = :'denc'), 'the dentist records the visit details through the share');
select (public.share_contribute(:'sess', 'clinical_notes', jsonb_build_object('body', 'IANB, 36 GIC', 'kind', 'progress')) ->> 'id') as dn \gset
select test.ok((select status = 'signed' and signed_name = 'Dr Note' from public.clinical_notes where id = :'dn'), 'the dentist''s note is signed with their name');
select public.share_amend_note(:'sess', :'dn', 'IANB, 36 GIC (temporary)', 'material was temporary') ->> 'status' as am \gset
select test.ok(:'am' = 'ok' and (select amended_name = 'Dr Note' and contributed_by = :'ctr'::uuid from public.note_amendments where note_id = :'dn'),
  'and amended by them, with the reason, through the share');
select test.ok(jsonb_array_length(public.share_my_notes(:'sess') -> 0 -> 'amendments') = 1, 'they see their note with its amendment');
select test.ok(jsonb_array_length(public.share_recalls(:'sess')) = 2, 'the dentist sees the recalls');
select test.ok((public.share_visit_note_extras(:'sess') -> 'encounters' -> :'enc' ->> 'anesthesia_kind') is null,
  'visit details follow the share''s scope (this share does not include visits)');
select test.as_user(:'alice'::uuid);
select test.throws(format($$insert into public.note_amendments (patient_id, note_id, body, reason) values (%L, %L, 'x', 'patient edit')$$, :'pv', :'dn'),
  'contributed_record_readonly', 'the patient does not amend the dentist''s note');

select public.patient_request_deletion(:'pv', 'Visit Patient');
select test.as_service();
select public.patient_purge(:'pv', true);
select test.ok((select count(*) = 0 from public.recalls where patient_id = :'pv') and (select count(*) = 0 from public.note_amendments where patient_id = :'pv'),
  'recalls and amendments are purged with the file');
select test.as_super();
