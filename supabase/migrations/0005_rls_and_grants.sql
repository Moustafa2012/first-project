-- 0005_rls_and_grants: row level security + least-privilege grants.
--   * anon (unauthenticated) has NO access to any table or function.
--   * authenticated users reach patient data only through patient_members (app.has_patient_access).
--   * system admins (profiles.role = 'admin') can manage catalogs, but no policy gives them clinical data.
--   * nobody can DELETE clinical rows from the API.

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'medical_specialties', 'patients', 'patient_members', 'patient_identifiers', 'emergency_contacts',
    'patient_insurance', 'encounters', 'conditions', 'allergies', 'medications', 'procedures', 'medical_documents',
    'observation_types', 'observation_bands', 'lab_reports', 'observations', 'test_orders', 'imaging_studies',
    'immunizations', 'family_history', 'appointments', 'care_plans', 'clinical_notes', 'specialty_record_types',
    'specialty_records', 'medical_shares', 'medical_share_items', 'medical_share_sessions', 'medical_share_access_logs',
    'share_notes', 'share_attempts', 'audit_logs']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- baseline: take everything away
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;

-- ---------------------------------------------------------------- profiles
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid() or app.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
grant select on public.profiles to authenticated;
grant update (full_name, preferred_lang) on public.profiles to authenticated;   -- role is not writable by users

-- ---------------------------------------------------------------- catalogs (readable by any signed-in user, admin-managed)
do $$
declare t text;
begin
  foreach t in array array['medical_specialties', 'observation_types', 'observation_bands', 'specialty_record_types']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.is_admin())', t || '_admin_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.is_admin()) with check (app.is_admin())', t || '_admin_upd', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- patients and membership
create policy patients_select on public.patients for select to authenticated using (app.has_patient_access(id));
create policy patients_update on public.patients for update to authenticated
  using (app.has_patient_access(id, 'write')) with check (app.has_patient_access(id, 'write'));
grant select on public.patients to authenticated;
grant update (full_name, full_name_en, date_of_birth, sex, nationality, blood_abo, blood_rh, blood_group_verified, phone, email,
              address_line, city, country, allergy_assertion, photo_path, deactivated_at) on public.patients to authenticated;

create policy members_select on public.patient_members for select to authenticated
  using (user_id = auth.uid() or app.has_patient_access(patient_id, 'manage'));
grant select on public.patient_members to authenticated;

create policy identifiers_all on public.patient_identifiers for all to authenticated
  using (app.has_patient_access(patient_id, 'manage')) with check (app.has_patient_access(patient_id, 'manage'));
grant select, insert, update on public.patient_identifiers to authenticated;

do $$
declare t text;
begin
  foreach t in array array['emergency_contacts', 'patient_insurance']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (app.has_patient_access(patient_id))', t || '_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.has_patient_access(patient_id, ''write''))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.has_patient_access(patient_id, ''write'')) with check (app.has_patient_access(patient_id, ''write''))', t || '_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (app.has_patient_access(patient_id, ''write''))', t || '_del', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- clinical tables: members read; writers insert/update; no delete
do $$
declare t text;
begin
  foreach t in array array['encounters', 'conditions', 'allergies', 'medications', 'procedures', 'medical_documents',
                           'lab_reports', 'observations', 'test_orders', 'imaging_studies', 'immunizations',
                           'family_history', 'appointments', 'care_plans', 'clinical_notes', 'specialty_records']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (app.has_patient_access(patient_id))', t || '_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.has_patient_access(patient_id, ''write''))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.has_patient_access(patient_id, ''write'')) with check (app.has_patient_access(patient_id, ''write''))', t || '_upd', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;
-- documents are registered by the web server (it validates the bytes first); users cannot insert rows directly
revoke insert on public.medical_documents from authenticated;
drop policy medical_documents_ins on public.medical_documents;

-- ---------------------------------------------------------------- sharing
create policy shares_select on public.medical_shares for select to authenticated using (app.has_patient_access(patient_id, 'share'));
grant select (id, patient_id, created_by, title, recipient_label, scope_kind, specialty_ids, include, include_sensitive,
              observation_type_ids, date_from, date_to, allow_download, allow_print, allow_notes, max_attempts,
              failed_attempts, lock_count, locked_until, expires_at, revoked_at, revoked_by, revoke_reason,
              last_accessed_at, access_count, created_at)
  on public.medical_shares to authenticated;

create policy share_items_select on public.medical_share_items for select to authenticated
  using (exists (select 1 from public.medical_shares s where s.id = share_id and app.has_patient_access(s.patient_id, 'share')));
grant select on public.medical_share_items to authenticated;

create policy share_logs_select on public.medical_share_access_logs for select to authenticated
  using (exists (select 1 from public.medical_shares s where s.id = share_id and app.has_patient_access(s.patient_id, 'share')));
grant select on public.medical_share_access_logs to authenticated;

create policy share_notes_select on public.share_notes for select to authenticated using (app.has_patient_access(patient_id, 'share'));
grant select on public.share_notes to authenticated;
-- medical_share_sessions and share_attempts: RLS on, no policy, no grant => only the definer functions touch them.

create policy audit_select on public.audit_logs for select to authenticated using (app.has_patient_access(patient_id, 'manage'));
grant select on public.audit_logs to authenticated;

-- ---------------------------------------------------------------- service role (web server) keeps full table access
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ---------------------------------------------------------------- functions
grant execute on function app.has_patient_access(uuid, text) to authenticated, service_role;
grant execute on function app.is_admin() to authenticated, service_role;

grant execute on function public.create_patient(text, date, text, text, text, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.observation_correct(uuid, numeric, numeric, text, text, text, numeric, numeric, text) to authenticated;
grant execute on function public.share_create(uuid, text, text, uuid[], text[], uuid[], date, date, timestamptz, int, boolean, boolean, boolean, boolean, text, jsonb) to authenticated;
grant execute on function public.share_revoke(uuid, text) to authenticated;
grant execute on function public.share_mark_note_reviewed(uuid) to authenticated;

-- viewer side: web server only (never reachable with the public anon key)
grant execute on function public.share_open(text, text, text, text) to service_role;
grant execute on function public.share_bundle(text, text, text) to service_role;
grant execute on function public.share_document(text, uuid, text, text) to service_role;
grant execute on function public.share_add_note(text, text, text, text, text) to service_role;
grant execute on function public.share_end_session(text, text, text) to service_role;
