\pset tuples_only on
-- Accounts of this file only (the shared fixtures of the other test files own many files with other members).
\set ana 'e5555555-5555-5555-5555-555555555555'
\set ben 'f6666666-6666-6666-6666-666666666666'
\set cyd 'a7777777-7777-7777-7777-777777777777'
\set dee 'b8888888-8888-8888-8888-888888888888'
\set carol 'c3333333-3333-3333-3333-333333333333'
\set s_ana1 '11110000-0000-0000-0000-000000000001'
\set s_ana2 '11110000-0000-0000-0000-000000000002'
\set s_ben1 '11110000-0000-0000-0000-000000000003'

select test.as_super();
insert into auth.users (id, email, raw_user_meta_data) values
  (:'ana', 'ana@example.test', '{"full_name":"Ana Account"}'),
  (:'ben', 'Ben@Example.test', '{"full_name":"Ben Account"}'),
  (:'cyd', 'cyd@example.test', '{"full_name":"Cyd Account"}'),
  (:'dee', 'dee@example.test', '{"full_name":"Dee Account"}');
insert into auth.sessions (id, user_id, user_agent, created_at, updated_at) values
  (:'s_ana1', :'ana', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', now() - interval '2 days', now() - interval '1 minute'),
  (:'s_ana2', :'ana', 'Mozilla/5.0 (iPhone) Safari/605', now() - interval '3 days', now() - interval '1 day'),
  (:'s_ben1', :'ben', 'Mozilla/5.0 (X11; Linux) Firefox/121', now() - interval '1 day', now());

-- =============================================================== sessions
select test.as_user(:'ana'::uuid);
select set_config('request.jwt.claims', json_build_object('sub', :'ana', 'role', 'authenticated', 'session_id', :'s_ana1')::text, false);
select test.ok((select count(*) = 2 from public.account_sessions()), 'an account sees its own two sessions');
select test.ok((select count(*) = 1 from public.account_sessions() where is_current and id = :'s_ana1'::uuid), 'and the one of the access token is marked current');
select test.ok((select bool_and(user_agent is not null) from public.account_sessions()), 'with the device each was opened from');
select test.ok((select id = :'s_ana1'::uuid from public.account_sessions() limit 1), 'the most recently active comes first');
select test.throws($$select * from auth.sessions$$, 'permission denied', 'the auth schema itself is not readable by an account');
select test.ok(public.account_session_alive(), 'a live session is alive');
select test.throws(format($$select public.account_revoke_session(%L)$$, :'s_ana1'), 'cannot_revoke_current', 'the current session is ended by signing out, not from the list');
select test.ok(not public.account_revoke_session(:'s_ben1'::uuid), 'another account''s session cannot be ended');
select test.ok(public.account_revoke_session(:'s_ana2'::uuid), 'an own other session can be ended');
select test.ok((select count(*) = 1 from public.account_sessions()), 'and it is gone from the list');
select test.ok(not public.account_revoke_session(:'s_ana2'::uuid), 'ending it again changes nothing');
select test.as_user(:'ben'::uuid);
select set_config('request.jwt.claims', json_build_object('sub', :'ben', 'role', 'authenticated', 'session_id', :'s_ben1')::text, false);
select test.ok((select count(*) = 1 and bool_and(is_current) from public.account_sessions()), 'another account sees only its own session');
select test.as_super();
select test.ok((select count(*) = 1 from auth.sessions where id = :'s_ben1'::uuid), 'which survived the other account''s attempt');
select test.as_user(:'ana'::uuid);
select set_config('request.jwt.claims', json_build_object('sub', :'ana', 'role', 'authenticated', 'session_id', :'s_ana2')::text, false);
select test.ok(not public.account_session_alive(), 'a token of an ended session is no longer alive');
select set_config('request.jwt.claims', json_build_object('sub', :'ana', 'role', 'authenticated')::text, false);
select test.ok(public.account_session_alive(), 'a token without a session id (issued before sessions) is not refused');
select set_config('request.jwt.claims', '', false);
select test.as_anon();
select test.throws($$select * from public.account_sessions()$$, 'permission denied', 'a signed-out request cannot list sessions');
select test.throws($$select public.account_session_alive()$$, 'permission denied', 'nor ask whether a session is alive');

-- =============================================================== activity log
select test.as_user(:'ana'::uuid);
select public.account_record_event('sign_in', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120');
select public.account_record_event('sign_in', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120');
select test.ok((select count(*) = 1 from public.account_events where kind = 'sign_in'), 'a sign-in reported twice within seconds is recorded once');
select public.account_record_event('sign_in', 'Mozilla/5.0 (iPhone) Safari/605');
select test.ok((select count(*) = 2 from public.account_events where kind = 'sign_in'), 'a sign-in from another device is a new entry');
select test.throws($$select public.account_record_event('deletion_requested')$$, 'invalid event', 'a client cannot write a deletion event');
select test.throws($$insert into public.account_events (user_id, kind) values (auth.uid(), 'sign_in')$$, 'permission denied', 'nor insert the log directly');
select test.throws($$delete from public.account_events$$, 'permission denied', 'nor erase entries');
select test.throws($$update public.account_events set kind = 'sign_in'$$, 'permission denied', 'nor edit them');
select test.as_user(:'ben'::uuid);
select test.ok((select count(*) = 0 from public.account_events), 'the log is private to its account');
select test.as_anon();
select test.throws($$select public.account_record_event('sign_in')$$, 'permission denied', 'a signed-out request cannot write the log');

-- =============================================================== files: alone, shared, transfer, remove
select test.as_user(:'ana'::uuid);
select public.create_patient('Ana Alone', date '1991-01-01', 'female', null, null, null, null, null, null, 'self', true) as f_alone \gset
select public.create_patient('Ana Shared With Cyd', date '1992-02-02', 'male', null, null, null, null, null, null, 'self', true) as f_shared \gset
select public.create_patient('Ana Shared With Dee', date '1993-03-03', 'male', null, null, null, null, null, null, 'self', true) as f_dee \gset
select public.create_patient('Ana Already Leaving', date '1994-04-04', 'male', null, null, null, null, null, null, 'self', true) as f_leaving \gset
select test.as_super();
insert into public.patient_members (patient_id, user_id, role, can_write, can_share) values
  (:'f_shared', :'cyd', 'guardian', true, true),
  (:'f_dee', :'dee', 'caregiver', false, false);
insert into public.note_templates (owner_id, title, body, kind) values (:'ana', 'Ana template', 'text', 'progress');
-- a link Ana created on a file she only helps with, and one on her own file
insert into public.medical_shares (patient_id, created_by, title, scope_kind, token_hash, pin_hash, expires_at)
  values (:'f_alone', :'ana', 'Link on the lone file', 'full', decode('aa01', 'hex'), 'x', now() + interval '1 day') returning id as sh_alone \gset
select test.as_user(:'ana'::uuid);
select public.patient_request_deletion(:'f_leaving', 'Ana Already Leaving');

select test.throws($$select public.account_request_deletion('nobody@example.test')$$, 'email_mismatch', 'deleting the account needs the account''s e-mail typed');
select test.throws($$select public.account_request_deletion('')$$, 'email_mismatch', 'an empty confirmation is refused');
select test.throws($$select public.account_request_deletion('ana@example.test')$$, 'shared_files_remain', 'files owned together with other members block the deletion');
select public.account_deletion_overview() as ov \gset
select test.ok(jsonb_array_length(:'ov'::jsonb -> 'shared') = 2 and jsonb_array_length(:'ov'::jsonb -> 'alone') = 2, 'the overview separates shared files from lone ones');
select test.ok((select bool_or(m ->> 'name' = 'Cyd Account' and m ->> 'role' = 'guardian') from jsonb_array_elements(:'ov'::jsonb -> 'shared') s, jsonb_array_elements(s -> 'members') m where s ->> 'id' = :'f_shared'),
  'and names who shares each one');
select test.ok(:'ov'::jsonb -> 'pending' = 'null'::jsonb, 'nothing is pending yet');

-- transfer
select test.throws(format($$select public.patient_transfer_ownership(%L, %L)$$, :'f_shared', :'ben'), 'invalid_target', 'ownership goes only to an existing member');
select test.throws(format($$select public.patient_transfer_ownership(%L, %L)$$, :'f_shared', :'ana'), 'invalid_target', 'not to oneself');
select test.throws(format($$select public.patient_transfer_ownership(%L, %L)$$, :'f_leaving', :'cyd'), 'forbidden|file_pending_deletion|invalid_target', 'a file already pending deletion cannot be handed over');
select test.as_user(:'cyd'::uuid);
select test.throws(format($$select public.patient_transfer_ownership(%L, %L)$$, :'f_shared', :'cyd'), 'invalid_target', 'a member cannot hand a file to herself');
select test.throws(format($$select public.patient_transfer_ownership(%L, %L)$$, :'f_dee', :'dee'), 'forbidden', 'only the owner can transfer ownership');
select test.throws(format($$select public.patient_remove_member(%L, %L)$$, :'f_dee', :'dee'), 'forbidden', 'only a manager can remove a member');
select test.as_user(:'ben'::uuid);
select test.throws(format($$select public.patient_transfer_ownership(%L, %L)$$, :'f_shared', :'cyd'), 'forbidden', 'a stranger cannot hand over a file that is not hers');
select test.throws(format($$select public.patient_remove_member(%L, %L)$$, :'f_dee', :'dee'), 'forbidden', 'nor remove its members');
select test.as_user(:'ana'::uuid);
select public.patient_transfer_ownership(:'f_shared', :'cyd'::uuid);
select test.ok((select role = 'owner' and can_write and can_share from public.patient_members where patient_id = :'f_shared' and user_id = :'cyd'), 'the member became the owner');
select test.ok((select role = 'guardian' from public.patient_members where patient_id = :'f_shared' and user_id = :'ana'), 'and the former owner stays as a guardian until her account goes');
select test.as_user(:'cyd'::uuid);
select test.ok(app.has_patient_access(:'f_shared'::uuid, 'manage'), 'the new owner manages the file');
-- remove
select test.as_user(:'ana'::uuid);
select test.throws(format($$select public.patient_remove_member(%L, %L)$$, :'f_dee', :'ana'), 'invalid_target', 'an owner cannot be removed (nor remove herself)');
select public.patient_remove_member(:'f_dee', :'dee'::uuid);
select test.ok((select revoked_at is not null from public.patient_members where patient_id = :'f_dee' and user_id = :'dee'), 'removing a member revokes the access');
select test.as_user(:'dee'::uuid);
select test.ok(not app.has_patient_access(:'f_dee'::uuid), 'who can no longer read the file');
select test.as_user(:'ana'::uuid);
select test.throws(format($$select public.patient_remove_member(%L, %L)$$, :'f_dee', :'dee'), 'invalid_target', 'removing twice is refused');

-- =============================================================== request, grace, cancel
select test.ok(public.account_deletion_overview() -> 'shared' = '[]'::jsonb, 'nothing blocks the deletion any more');
select public.account_request_deletion('  ANA@example.test ') as due \gset
select test.ok(:'due'::timestamptz > now() + interval '29 days' and :'due'::timestamptz < now() + interval '31 days', 'the deletion is scheduled 30 days ahead (the e-mail match ignores case and spaces)');
select test.throws($$select public.account_request_deletion('ana@example.test')$$, 'already_pending', 'a second request is refused');
select test.ok((select count(*) = 2 and bool_and(deletion_scheduled_for = :'due'::timestamptz) from public.patients where deletion_requested_by = :'ana'::uuid
                and id in (:'f_alone', :'f_dee')), 'the files she owned alone enter the file deletion with the same date');
select test.ok((select deletion_requested_at is not null from public.patients where id = :'f_leaving'), 'a file she had already put into deletion keeps its own request');
select test.ok(not app.has_patient_access(:'f_alone'::uuid, 'write') and app.has_patient_access(:'f_alone'::uuid, 'read'), 'those files are read-only but still readable');
select test.ok((select revoked_at is not null and revoke_reason = 'account_deleted' from public.medical_shares where id = :'sh_alone'), 'her share links are revoked');
select test.ok((select count(*) = 1 from public.account_deletions where user_id = :'ana' and completed_at is null), 'the request is visible to her');
select test.ok((select count(*) = 1 from public.account_events where kind = 'deletion_requested'), 'and recorded in her activity log');
select test.ok((select deletion_requested_at is null from public.patients where id = :'f_shared'), 'the file she handed over is untouched');
select test.as_user(:'ben'::uuid);
select test.ok((select count(*) = 0 from public.account_deletions), 'another account cannot see the request');
select test.ok(public.account_cancel_deletion() = false, 'nor cancel it (nothing is pending for them)');
select test.ok(not exists (select 1 from public.patients where id = :'f_alone'), 'and cannot read her file');
select test.as_user(:'cyd'::uuid);
select test.ok((select deletion_requested_at is null from public.patients where id = :'f_shared'), 'the new owner''s file is not affected');

select test.as_user(:'ana'::uuid);
select test.ok(public.account_cancel_deletion(), 'signing in again cancels the request');
select test.ok((select count(*) = 0 from public.patients where id in (:'f_alone', :'f_dee') and deletion_requested_at is not null), 'the files it scheduled are restored');
select test.ok((select deletion_requested_at is not null from public.patients where id = :'f_leaving'), 'a file she had scheduled herself stays scheduled');
select test.ok(app.has_patient_access(:'f_alone'::uuid, 'write'), 'the restored file is writable again');
select test.ok((select revoked_at is not null from public.medical_shares where id = :'sh_alone'), 'the revoked link stays revoked');
select test.ok(not public.account_cancel_deletion(), 'cancelling again does nothing');
select test.ok((select count(*) = 1 from public.account_events where kind = 'deletion_cancelled'), 'the cancellation is recorded');

-- =============================================================== last administrator
select test.as_user(:'carol'::uuid);
select test.throws($$select public.account_request_deletion('carol@example.test')$$, 'last_admin', 'the only administrator cannot delete the account');
select test.as_anon();
select test.throws($$select public.account_request_deletion('ana@example.test')$$, 'permission denied', 'a signed-out request cannot delete an account');
select test.as_user(:'ana'::uuid);
select test.throws($$select public.account_finalize(auth.uid())$$, 'permission denied', 'an account cannot run the purge itself');
select test.throws($$select public.account_purge_due()$$, 'permission denied', 'nor list the accounts that are due');

-- =============================================================== grace elapsed, purge
select public.account_request_deletion('ana@example.test') as due2 \gset
select test.as_user(:'ben'::uuid);
select public.create_patient('Ben Alone', date '1980-01-01', 'male', null, null, null, null, null, null, 'self', true) as f_ben \gset
select public.account_request_deletion('ben@example.test');           -- the other account is also pending (mixed-case e-mail)
select test.as_service();
select test.ok(public.account_purge_due() = '{}', 'nothing is due inside the grace period');
select test.throws(format($$select public.account_finalize(%L)$$, :'ana'), 'grace_period_not_elapsed', 'the account cannot be finalised early');
select test.as_super();
update public.account_deletions set requested_at = now() - interval '31 days', scheduled_for = now() - interval '1 day' where user_id = :'ana';
update public.patients set deletion_scheduled_for = now() - interval '1 day' where deletion_requested_by = :'ana';
select test.as_service();
select test.ok(public.account_purge_due() = array[:'ana'::uuid], 'only the account whose grace period ended is due');
select test.throws(format($$select public.account_finalize(%L)$$, :'ana'), 'files_remaining', 'the account is not finalised while one of its files still exists');
select test.ok((select count(*) = 3 from (select unnest(public.patient_purge_due()) id) x where id in (:'f_alone', :'f_dee', :'f_leaving')), 'the files are due with it');
select public.patient_purge(:'f_alone', false);
select public.patient_purge(:'f_dee', false);
select public.patient_purge(:'f_leaving', false);
select test.as_super();
select count(*) as ana_audit_before from public.audit_logs where patient_id = :'f_shared' and actor_id = :'ana' \gset
select test.as_service();
select public.account_finalize(:'ana'::uuid);
select public.account_finalize(:'ana'::uuid);   -- idempotent: the next run repeats it when the identity could not be removed
select test.as_super();
select test.ok(not exists (select 1 from public.patients where id in (:'f_alone', :'f_dee', :'f_leaving')), 'her own files are gone');
select test.ok(not exists (select 1 from public.audit_logs where patient_id in (:'f_alone', :'f_dee', :'f_leaving')), 'and their audit entries with them (the file deletion policy)');
select test.ok(not exists (select 1 from public.patient_members where user_id = :'ana'), 'her access to other people''s files is gone');
select test.ok(not exists (select 1 from public.note_templates where owner_id = :'ana') and not exists (select 1 from public.account_events where user_id = :'ana'), 'as are her templates and her activity log');
select test.ok((select full_name = '' and phone is null and date_of_birth is null and avatar_path is null from public.profiles where id = :'ana'), 'and the personal details of the profile are blanked');
select test.ok(exists (select 1 from public.patients where id = :'f_shared' and mrn is not null) and (select count(*) from public.patient_members where patient_id = :'f_shared' and user_id = :'cyd' and role = 'owner') = 1,
  'the file she handed over is intact and still owned by the new owner');
select test.ok((select count(*) = :'ana_audit_before'::int and count(*) > 0 from public.audit_logs where patient_id = :'f_shared' and actor_id = :'ana'), 'its audit entries are kept (only the opaque id of the actor remains)');
select test.throws(format($$delete from auth.users where id = %L$$, :'ana'), 'foreign key', 'the identity cannot be removed while a remaining record names her as author');
select test.ok((select count(*) = 1 from public.profiles where id = :'ben' and full_name = 'Ben Account') and exists (select 1 from public.patients where id = :'f_ben' and deletion_requested_by = :'ben'),
  'the other account''s profile and file are untouched');
select test.ok((select count(*) = 1 from public.account_deletions where user_id = :'ben' and completed_at is null), 'and its own pending request stays pending');
select test.as_service();
select public.account_complete(:'ana'::uuid, 'anonymised');
select test.ok(public.account_purge_due() = '{}', 'once completed the account is no longer due');
select test.throws(format($$select public.account_complete(%L, 'deleted')$$, :'ana'), 'not_pending', 'and cannot be completed twice');
select test.throws(format($$select public.account_complete(%L, 'erased')$$, :'ben'), 'check constraint|violates', 'the method is one of the two known ones');
select test.as_super();
select test.ok((select method = 'anonymised' and completed_at is not null from public.account_deletions where user_id = :'ana'), 'the tombstone records how it ended');
select test.as_user(:'ben'::uuid);
select test.ok((select count(*) = 1 from public.account_deletions), 'only the pending request of the account is visible to it');

-- a request cannot be undone once a file of it was erased
select test.as_user(:'cyd'::uuid);
select public.account_request_deletion('cyd@example.test');
select test.as_super();
update public.account_deletions set requested_at = now() - interval '31 days', scheduled_for = now() - interval '1 day' where user_id = :'cyd';
update public.patients set deletion_scheduled_for = now() - interval '1 day' where deletion_requested_by = :'cyd';
select test.as_service();
select public.patient_purge(:'f_shared', false);
select test.as_user(:'cyd'::uuid);
select test.throws($$select public.account_cancel_deletion()$$, 'purge_started', 'once a file was erased the request can no longer be cancelled');

-- a hard delete of an account with nothing left that names it
select test.as_super();
insert into auth.users (id, email) values ('0a0a0a0a-0a0a-0a0a-0a0a-0a0a0a0a0a0a', 'gone@example.test');
select test.as_user('0a0a0a0a-0a0a-0a0a-0a0a-0a0a0a0a0a0a'::uuid);
select public.create_patient('Gone Alone', date '1985-05-05', 'male', null, null, null, null, null, null, 'self', true) as f_gone \gset
select public.account_request_deletion('gone@example.test');
select test.as_super();
update public.account_deletions set requested_at = now() - interval '31 days', scheduled_for = now() - interval '1 day' where user_id = '0a0a0a0a-0a0a-0a0a-0a0a-0a0a0a0a0a0a';
update public.patients set deletion_scheduled_for = now() - interval '1 day' where id = :'f_gone';
select test.as_service();
select public.patient_purge(:'f_gone', false);
select public.account_finalize('0a0a0a0a-0a0a-0a0a-0a0a-0a0a0a0a0a0a'::uuid);
select test.as_super();
select test.ok(exists (select 1 from auth.users where id = '0a0a0a0a-0a0a-0a0a-0a0a-0a0a0a0a0a0a'), 'the identity is still there before the web server deletes it');
delete from auth.users where id = '0a0a0a0a-0a0a-0a0a-0a0a-0a0a0a0a0a0a';
select test.ok(not exists (select 1 from public.profiles where id = '0a0a0a0a-0a0a-0a0a-0a0a-0a0a0a0a0a0a'), 'with nothing naming the user, the identity can be deleted and the profile goes with it');
select public.account_complete('0a0a0a0a-0a0a-0a0a-0a0a-0a0a0a0a0a0a'::uuid, 'deleted');
select test.ok((select method = 'deleted' from public.account_deletions where user_id = '0a0a0a0a-0a0a-0a0a-0a0a-0a0a0a0a0a0a'), 'and the tombstone remains');
