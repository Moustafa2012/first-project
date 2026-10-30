-- 0014: a clinician adds to the record through the share link (no account).
--
-- The patient decides, per share, whether the clinician may add and what: visits, diagnoses, procedures, notes,
-- medications / prescriptions, follow-up appointments, test requests, imaging studies and documents. Before adding,
-- the clinician states who they are and signs on screen (share_contributors). Every added row carries
-- contributed_by, is stamped source = 'clinic' / verification = 'confirmed', stays inside the share's specialty, and
-- can never change or remove what the patient recorded. The patient sees who added what, reviews it, and can
-- invalidate any of it (one record or everything from one clinician). Additions are written only by the definer
-- functions below, which re-check the session, revocation, expiry and the share's permissions on every call.

-- ---------------------------------------------------------------- share options
alter table public.medical_shares
  add column allow_contribute boolean not null default false,
  add column contribute_modules text[] not null default '{}'
    check (contribute_modules <@ array['encounters', 'conditions', 'procedures', 'clinical_notes', 'medications',
                                       'appointments', 'test_orders', 'imaging_studies', 'medical_documents']::text[]),
  add column max_contributions int not null default 100 check (max_contributions between 1 and 500),
  add constraint medical_shares_contribute_chk check (allow_contribute or cardinality(contribute_modules) = 0);
grant select (allow_contribute, contribute_modules, max_contributions) on public.medical_shares to authenticated;

alter table public.medical_share_access_logs drop constraint if exists medical_share_access_logs_event_check;
alter table public.medical_share_access_logs add constraint medical_share_access_logs_event_check check (event in
  ('created', 'revoked', 'auto_revoked', 'opened', 'pin_failed', 'locked', 'locked_attempt', 'blocked',
   'viewed', 'document_opened', 'note_added', 'session_ended',
   'contributor_identified', 'contribution_added', 'contribution_retracted'));

-- ---------------------------------------------------------------- who added it
create table public.share_contributors (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.medical_shares (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete restrict,
  session_id uuid references public.medical_share_sessions (id) on delete set null,
  full_name text not null check (length(btrim(full_name)) between 3 and 120),
  specialty text check (specialty is null or length(specialty) <= 120),
  license_no text check (license_no is null or length(license_no) <= 60),
  facility text check (facility is null or length(facility) <= 200),
  phone text check (phone is null or length(phone) <= 40),
  -- the on-screen signature (PNG in the private bucket); the clinician also confirms the attestation text
  signature_path text not null,
  attested_at timestamptz not null default now(),
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now(),
  contribution_count int not null default 0,
  last_contribution_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id),
  unique (id, patient_id),
  check (signature_path like patient_id::text || '/signatures/%.png')
);
create index share_contributors_share_idx on public.share_contributors (share_id);
create index share_contributors_patient_idx on public.share_contributors (patient_id, created_at desc);
create unique index share_contributors_session_idx on public.share_contributors (session_id) where session_id is not null;
alter table public.share_contributors enable row level security;
create policy share_contributors_select on public.share_contributors for select to authenticated
  using (app.has_patient_access(patient_id, 'read'));
grant select on public.share_contributors to authenticated;

-- ---------------------------------------------------------------- provenance on clinical rows
alter table public.medical_documents alter column uploaded_by drop not null;
do $$
declare t text;
begin
  foreach t in array array['encounters', 'conditions', 'procedures', 'clinical_notes', 'medications', 'appointments',
                           'test_orders', 'imaging_studies', 'medical_documents'] loop
    execute format('alter table public.%I add column contributed_by uuid', t);
    execute format('alter table public.%I add constraint %I foreign key (contributed_by, patient_id) references public.share_contributors (id, patient_id)',
                   t, t || '_contributed_by_fkey');
    execute format('create index %I on public.%I (contributed_by) where contributed_by is not null', t || '_contributed_idx', t);
  end loop;
end $$;
alter table public.medical_documents add constraint medical_documents_uploader_chk check (uploaded_by is not null or contributed_by is not null);

-- A clinician's addition is theirs: users can invalidate it (and update the few fields that describe what happened
-- next, e.g. an appointment attended), but not rewrite it. contributed_by is set only by the share functions.
create function app.contribution_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  j_new jsonb; j_old jsonb; k text;
  v_allowed text[] := coalesce(tg_argv, '{}'::text[])
    || array['record_status', 'invalidated_reason', 'invalidated_at', 'invalidated_by', 'updated_at', 'updated_by'];
begin
  if tg_op = 'INSERT' then
    if new.contributed_by is not null and auth.uid() is not null then
      raise exception 'contributed_by is set by the share functions only' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.contributed_by is distinct from old.contributed_by then
    raise exception 'immutable fields cannot be changed' using errcode = '42501';
  end if;
  if old.contributed_by is not null and auth.uid() is not null then
    j_new := to_jsonb(new); j_old := to_jsonb(old);
    for k in select key from jsonb_each(j_new) loop
      if not (k = any (v_allowed)) and (j_new -> k) is distinct from (j_old -> k) then
        raise exception 'contributed_record_readonly' using errcode = '42501',
          hint = 'A record added by a clinician through a share can be invalidated but not edited.';
      end if;
    end loop;
  end if;
  return new;
end $$;

create trigger encounters_contrib_guard before insert or update on public.encounters for each row execute function app.contribution_guard('status');
create trigger conditions_contrib_guard before insert or update on public.conditions for each row execute function app.contribution_guard('clinical_status', 'resolved_date');
create trigger procedures_contrib_guard before insert or update on public.procedures for each row execute function app.contribution_guard();
create trigger clinical_notes_contrib_guard before insert or update on public.clinical_notes for each row execute function app.contribution_guard();
create trigger medications_contrib_guard before insert or update on public.medications for each row execute function app.contribution_guard('status', 'end_date', 'stopped_by', 'stop_reason');
create trigger appointments_contrib_guard before insert or update on public.appointments for each row execute function app.contribution_guard('status');
create trigger test_orders_contrib_guard before insert or update on public.test_orders for each row execute function app.contribution_guard('status', 'done_on', 'report_id');
create trigger imaging_studies_contrib_guard before insert or update on public.imaging_studies for each row execute function app.contribution_guard('document_id');
create trigger medical_documents_contrib_guard before insert or update on public.medical_documents for each row execute function app.contribution_guard('sensitivity', 'lab_report_id', 'imaging_id', 'encounter_id');

-- ---------------------------------------------------------------- the audit trail names the clinician
alter table public.audit_logs drop constraint if exists audit_logs_actor_kind_check;
alter table public.audit_logs add constraint audit_logs_actor_kind_check check (actor_kind in ('user', 'system', 'share_contributor'));

create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  j_new jsonb := to_jsonb(new);
  j_old jsonb;
  v_changed text[];
  v_old jsonb;
  v_new jsonb;
  v_action text;
  v_col text;
  v_contrib uuid := nullif(current_setting('app.share_contributor', true), '')::uuid;
begin
  if tg_op = 'UPDATE' then
    j_old := to_jsonb(old);
    select coalesce(array_agg(n.key order by n.key), '{}') into v_changed
      from jsonb_each(j_new) n where j_old -> n.key is distinct from n.value;
    v_changed := array_remove(v_changed, 'updated_at');
    v_changed := array_remove(v_changed, 'updated_by');
    if cardinality(v_changed) = 0 then return null; end if;
    select jsonb_object_agg(k, j_old -> k), jsonb_object_agg(k, j_new -> k) into v_old, v_new from unnest(v_changed) k;
    v_action := case
      when j_new ->> 'record_status' = 'entered_in_error' and j_old ->> 'record_status' is distinct from 'entered_in_error' then 'invalidate'
      when j_new ->> 'status' = 'entered_in_error' and j_old ->> 'status' is distinct from 'entered_in_error' then 'invalidate'
      else 'update' end;
  else
    v_new := j_new; v_action := 'insert';
  end if;
  if tg_argv is not null then   -- NULL (not empty) when the trigger was declared without arguments
    foreach v_col in array tg_argv loop
      if v_new ? v_col then v_new := jsonb_set(v_new, array[v_col], '"[redacted]"'); end if;
      if v_old ? v_col then v_old := jsonb_set(v_old, array[v_col], '"[redacted]"'); end if;
    end loop;
  end if;
  insert into public.audit_logs (actor_id, actor_kind, patient_id, table_name, record_id, action, changed_fields, old_data, new_data)
  values (coalesce(auth.uid(), v_contrib),
          case when auth.uid() is not null then 'user' when v_contrib is not null then 'share_contributor' else 'system' end,
          coalesce((j_new ->> 'patient_id')::uuid, case when tg_table_name = 'patients' then (j_new ->> 'id')::uuid end),
          tg_table_name, (j_new ->> 'id')::uuid, v_action, v_changed, v_old, v_new);
  return null;
end $$;

create trigger share_contributors_audit after insert or update on public.share_contributors for each row execute function app.audit_row('ip_hash', 'user_agent');

-- ---------------------------------------------------------------- share_create: contribution options
drop function public.share_create(uuid, text, text, uuid[], text[], uuid[], date, date, timestamptz, int, boolean, boolean, boolean, boolean, text, jsonb);
create function public.share_create(
  p_patient uuid,
  p_title text,
  p_scope_kind text,
  p_specialty_ids uuid[] default '{}',
  p_include text[] default '{}',
  p_observation_type_ids uuid[] default '{}',
  p_date_from date default null,
  p_date_to date default null,
  p_expires_at timestamptz default null,
  p_max_attempts int default 5,
  p_allow_download boolean default false,
  p_allow_print boolean default false,
  p_allow_notes boolean default false,
  p_include_sensitive boolean default false,
  p_recipient_label text default null,
  p_items jsonb default '[]'::jsonb,
  p_allow_contribute boolean default false,
  p_contribute_modules text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_token text;
  v_pin text;
  v_expires timestamptz := coalesce(p_expires_at, now() + interval '24 hours');
  v_id uuid;
  v_item jsonb;
  v_ok boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not app.has_patient_access(p_patient, 'share') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_expires < now() + interval '5 minutes' or v_expires > now() + interval '30 days' then
    raise exception 'expiry must be between 5 minutes and 30 days from now' using errcode = '22023';
  end if;
  if p_scope_kind = 'specialty' and (p_specialty_ids is null or cardinality(p_specialty_ids) = 0) then
    raise exception 'a specialty share needs at least one specialty' using errcode = '22023';
  end if;
  if p_specialty_ids is not null and cardinality(p_specialty_ids) > 0 and exists (
       select 1 from unnest(p_specialty_ids) sid where not exists (select 1 from public.medical_specialties m where m.id = sid)) then
    raise exception 'unknown specialty' using errcode = '22023';
  end if;
  if coalesce(p_allow_contribute, false) and cardinality(coalesce(p_contribute_modules, '{}')) = 0 then
    raise exception 'choose what the clinician may add' using errcode = '22023';
  end if;
  if p_scope_kind = 'custom' and jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'a custom share needs at least one selected record' using errcode = '22023';
  end if;

  v_token := app.b64url(extensions.gen_random_bytes(24));
  v_pin := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');

  insert into public.medical_shares (
    patient_id, created_by, title, recipient_label, scope_kind, specialty_ids, include, include_sensitive,
    observation_type_ids, date_from, date_to, allow_download, allow_print, allow_notes,
    token_hash, token_hint, pin_hash, max_attempts, expires_at, allow_contribute, contribute_modules)
  values (
    p_patient, v_uid, btrim(p_title), nullif(btrim(p_recipient_label), ''), p_scope_kind, coalesce(p_specialty_ids, '{}'),
    coalesce(p_include, '{}'), coalesce(p_include_sensitive, false), coalesce(p_observation_type_ids, '{}'),
    p_date_from, p_date_to, coalesce(p_allow_download, false), coalesce(p_allow_print, false), coalesce(p_allow_notes, false),
    app.sha256(v_token), right(v_token, 4), extensions.crypt(v_pin, extensions.gen_salt('bf', 10)), coalesce(p_max_attempts, 5), v_expires,
    coalesce(p_allow_contribute, false), case when coalesce(p_allow_contribute, false) then coalesce(p_contribute_modules, '{}') else '{}' end)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if (v_item ->> 'table') not in ('encounters', 'observations', 'medical_documents', 'procedures', 'imaging_studies',
                                    'clinical_notes', 'specialty_records', 'conditions', 'care_plans') then
      raise exception 'invalid item table' using errcode = '22023';
    end if;
    execute format('select exists (select 1 from public.%I where id = $1 and patient_id = $2)', v_item ->> 'table')
      into v_ok using (v_item ->> 'id')::uuid, p_patient;
    if not v_ok then raise exception 'record does not belong to this patient' using errcode = '22023'; end if;
    insert into public.medical_share_items (share_id, table_name, record_id)
    values (v_id, v_item ->> 'table', (v_item ->> 'id')::uuid)
    on conflict do nothing;
  end loop;

  perform app.share_log(v_id, 'created', null, null, jsonb_build_object('by', v_uid, 'scope', p_scope_kind, 'contribute', coalesce(p_allow_contribute, false)));
  return jsonb_build_object('share_id', v_id, 'token', v_token, 'pin', v_pin, 'expires_at', v_expires);
end $$;

grant execute on function public.share_create(uuid, text, text, uuid[], text[], uuid[], date, date, timestamptz, int, boolean, boolean, boolean, boolean, text, jsonb, boolean, text[]) to authenticated;

-- ---------------------------------------------------------------- clinician side (service_role only, like share_bundle)
-- the open session, its share and the clinician who identified in it (if any)
create function app.share_contributor_context(p_session_token text, out o_status text, out o_share public.medical_shares, out o_contributor uuid)
language plpgsql security definer set search_path = '' as $$
declare v_share uuid; v_sid uuid; v_st text;
begin
  select a.o_share_id, a.o_session_id, a.o_status into v_share, v_sid, v_st from app.resolve_share_session(p_session_token) a;
  if v_st <> 'ok' then o_status := 'expired'; return; end if;
  select * into o_share from public.medical_shares where id = v_share;
  if not o_share.allow_contribute then o_status := 'forbidden'; return; end if;
  select c.id into o_contributor from public.share_contributors c where c.session_id = v_sid;
  o_status := 'ok';
end $$;

create function public.share_identify(p_session_token text, p_full_name text, p_specialty text, p_license_no text, p_facility text,
                                      p_phone text, p_signature_path text, p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_share uuid; v_sid uuid; v_st text;
  s public.medical_shares;
  v_id uuid;
begin
  select a.o_share_id, a.o_session_id, a.o_status into v_share, v_sid, v_st from app.resolve_share_session(p_session_token) a;
  if v_st <> 'ok' then return jsonb_build_object('status', 'expired'); end if;
  select * into s from public.medical_shares where id = v_share;
  if not s.allow_contribute then return jsonb_build_object('status', 'forbidden'); end if;
  select id into v_id from public.share_contributors where session_id = v_sid;
  if v_id is not null then return jsonb_build_object('status', 'ok', 'contributor_id', v_id); end if;
  insert into public.share_contributors (share_id, patient_id, session_id, full_name, specialty, license_no, facility, phone,
                                         signature_path, ip_hash, user_agent)
  values (s.id, s.patient_id, v_sid, btrim(p_full_name), nullif(btrim(p_specialty), ''), nullif(btrim(p_license_no), ''),
          nullif(btrim(p_facility), ''), nullif(btrim(p_phone), ''), p_signature_path, p_ip_hash, left(p_user_agent, 300))
  returning id into v_id;
  perform app.share_log(s.id, 'contributor_identified', p_ip_hash, p_user_agent, jsonb_build_object('contributor', v_id));
  return jsonb_build_object('status', 'ok', 'contributor_id', v_id);
end $$;

-- columns a clinician may fill per table (everything else is forced or left to its default)
create function app.contribution_columns(p_table text) returns text[]
language sql immutable as $$
  select case p_table
    when 'encounters' then array['kind', 'status', 'started_at', 'ended_at', 'facility_name', 'practitioner_name', 'reason', 'symptoms',
                                 'history_of_present_illness', 'examination', 'assessment', 'plan', 'summary', 'follow_up_date']
    when 'conditions' then array['name', 'icd10_code', 'category', 'clinical_status', 'certainty', 'severity', 'onset_date', 'date_precision',
                                 'resolved_date', 'notes', 'sensitive', 'encounter_id']
    when 'procedures' then array['kind', 'name', 'performed_on', 'date_precision', 'body_site', 'facility_name', 'operator_name', 'anesthesia',
                                 'indication', 'outcome', 'complications', 'notes', 'encounter_id']
    when 'clinical_notes' then array['kind', 'title', 'body', 'author_name', 'noted_at', 'encounter_id']
    when 'medications' then array['name_brand', 'name_generic', 'strength', 'form', 'dose', 'route', 'frequency', 'as_needed', 'origin', 'status',
                                  'start_date', 'date_precision', 'end_date', 'indication', 'prescriber_name', 'instructions', 'adverse_effects',
                                  'notes', 'sensitive', 'encounter_id']
    when 'appointments' then array['scheduled_at', 'status', 'facility_name', 'practitioner_name', 'reason', 'notes', 'encounter_id']
    when 'test_orders' then array['kind', 'name', 'reason', 'priority', 'status', 'ordered_by', 'requested_on', 'notes', 'encounter_id']
    when 'imaging_studies' then array['modality', 'body_site', 'performed_on', 'date_precision', 'facility_name', 'radiologist_name', 'findings',
                                      'impression', 'encounter_id']
    else null end
$$;

create function public.share_contribute(p_session_token text, p_table text, p_payload jsonb, p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  v_cols text[];
  v_used int;
  v_spec uuid;
  v_name text;
  v_payload jsonb;
  v_list text;
  v_id uuid;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  if not (p_table = any ((c.o_share).contribute_modules)) or p_table = 'medical_documents' then
    return jsonb_build_object('status', 'forbidden');
  end if;
  v_cols := app.contribution_columns(p_table);
  if v_cols is null or jsonb_typeof(coalesce(p_payload, 'null'::jsonb)) <> 'object' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select coalesce(sum(contribution_count), 0) into v_used from public.share_contributors where share_id = (c.o_share).id;
  if v_used >= (c.o_share).max_contributions then return jsonb_build_object('status', 'limit'); end if;

  -- a specialty share writes into that specialty only
  v_spec := nullif(p_payload ->> 'specialty_id', '')::uuid;
  if (c.o_share).scope_kind = 'specialty' and (v_spec is null or not (v_spec = any ((c.o_share).specialty_ids))) then
    v_spec := ((c.o_share).specialty_ids)[1];
  end if;
  select left(full_name || coalesce(' — ' || facility, ''), 300) into v_name from public.share_contributors where id = c.o_contributor;

  select coalesce(jsonb_object_agg(k, p_payload -> k), '{}'::jsonb) into v_payload
    from unnest(v_cols) k where p_payload ? k;
  v_payload := v_payload || jsonb_build_object('patient_id', (c.o_share).patient_id, 'specialty_id', v_spec,
                                               'contributed_by', c.o_contributor, 'source', 'clinic', 'source_detail', v_name,
                                               'verification', 'confirmed');
  select string_agg(quote_ident(k), ', ') into v_list from jsonb_object_keys(v_payload) k;

  perform set_config('app.share_contributor', c.o_contributor::text, true);
  execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning id',
                 p_table, v_list, v_list, p_table)
    into v_id using v_payload;

  update public.share_contributors set contribution_count = contribution_count + 1, last_contribution_at = now()
   where id = c.o_contributor;
  perform app.share_log((c.o_share).id, 'contribution_added', p_ip_hash, p_user_agent,
                        jsonb_build_object('contributor', c.o_contributor, 'table', p_table, 'id', v_id));
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

create function public.share_register_document(p_session_token text, p_title text, p_doc_type text, p_storage_path text, p_filename text,
                                               p_mime text, p_size bigint, p_sha256 text, p_description text default null,
                                               p_document_date date default null, p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_used int; v_name text; v_id uuid;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  if not ('medical_documents' = any ((c.o_share).contribute_modules)) then return jsonb_build_object('status', 'forbidden'); end if;
  select coalesce(sum(contribution_count), 0) into v_used from public.share_contributors where share_id = (c.o_share).id;
  if v_used >= (c.o_share).max_contributions then return jsonb_build_object('status', 'limit'); end if;
  select left(full_name || coalesce(' — ' || facility, ''), 300) into v_name from public.share_contributors where id = c.o_contributor;
  perform set_config('app.share_contributor', c.o_contributor::text, true);
  insert into public.medical_documents (patient_id, specialty_id, doc_type, title, description, document_date, uploaded_by, sensitivity,
      storage_path, original_filename, mime_type, size_bytes, sha256, contributed_by, source, source_detail, verification)
  values ((c.o_share).patient_id, case when (c.o_share).scope_kind = 'specialty' then ((c.o_share).specialty_ids)[1] end, p_doc_type,
      btrim(p_title), nullif(btrim(p_description), ''), p_document_date, null, 'standard', p_storage_path, left(p_filename, 255),
      p_mime, p_size, p_sha256, c.o_contributor, 'clinic', v_name, 'confirmed')
  returning id into v_id;
  update public.share_contributors set contribution_count = contribution_count + 1, last_contribution_at = now() where id = c.o_contributor;
  perform app.share_log((c.o_share).id, 'contribution_added', p_ip_hash, p_user_agent,
                        jsonb_build_object('contributor', c.o_contributor, 'table', 'medical_documents', 'id', v_id));
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

-- what this clinician may add, and what was added through this share (for the clinician's own list)
create function public.share_contrib_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_ctr jsonb; v_items jsonb; v_encs jsonb; v_used int;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  select to_jsonb(x) - 'ip_hash' - 'user_agent' - 'signature_path' - 'session_id' into v_ctr
    from public.share_contributors x where x.id = c.o_contributor;
  select coalesce(sum(contribution_count), 0) into v_used from public.share_contributors where share_id = (c.o_share).id;
  with mine as (
    select 'encounters' as tbl, e.id, coalesce(e.reason, e.kind) as label, e.started_at as at, e.record_status, e.contributed_by from public.encounters e
    union all select 'conditions', x.id, x.name, x.recorded_at, x.record_status, x.contributed_by from public.conditions x
    union all select 'procedures', x.id, x.name, x.recorded_at, x.record_status, x.contributed_by from public.procedures x
    union all select 'clinical_notes', x.id, coalesce(x.title, left(x.body, 80)), x.noted_at, x.record_status, x.contributed_by from public.clinical_notes x
    union all select 'medications', x.id, coalesce(x.name_generic, x.name_brand), x.recorded_at, x.record_status, x.contributed_by from public.medications x
    union all select 'appointments', x.id, coalesce(x.reason, ''), x.scheduled_at, x.record_status, x.contributed_by from public.appointments x
    union all select 'test_orders', x.id, x.name, x.recorded_at, x.record_status, x.contributed_by from public.test_orders x
    union all select 'imaging_studies', x.id, x.modality || coalesce(' — ' || x.body_site, ''), x.recorded_at, x.record_status, x.contributed_by from public.imaging_studies x
    union all select 'medical_documents', x.id, x.title, x.uploaded_at, x.record_status, x.contributed_by from public.medical_documents x
  )
  select coalesce(jsonb_agg(jsonb_build_object('table', m.tbl, 'id', m.id, 'label', m.label, 'at', m.at, 'record_status', m.record_status,
                                               'by', sc.full_name, 'mine', m.contributed_by = c.o_contributor) order by m.at desc), '[]')
    into v_items
    from mine m join public.share_contributors sc on sc.id = m.contributed_by
   where sc.share_id = (c.o_share).id;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'started_at', e.started_at, 'reason', e.reason, 'kind', e.kind) order by e.started_at desc), '[]')
    into v_encs
    from public.encounters e join public.share_contributors sc on sc.id = e.contributed_by
   where sc.share_id = (c.o_share).id and e.record_status = 'active';
  -- patient_id is for the web server (storage paths); it is never rendered
  return jsonb_build_object('status', 'ok', 'patient_id', (c.o_share).patient_id, 'modules', to_jsonb((c.o_share).contribute_modules), 'max', (c.o_share).max_contributions,
                            'used', v_used, 'contributor', v_ctr, 'items', v_items, 'encounters', v_encs);
end $$;

-- the clinician withdraws something added through this share (kept in the history with the reason)
create function public.share_retract(p_session_token text, p_table text, p_id uuid, p_reason text, p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_ok boolean;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  if p_table not in ('encounters', 'conditions', 'procedures', 'clinical_notes', 'medications', 'appointments', 'test_orders',
                     'imaging_studies', 'medical_documents') then
    return jsonb_build_object('status', 'invalid');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('status', 'reason_required'); end if;
  perform set_config('app.share_contributor', c.o_contributor::text, true);
  execute format('update public.%I x set record_status = ''entered_in_error'', invalidated_reason = $1
                   where x.id = $2 and x.patient_id = $3 and x.record_status = ''active''
                     and x.contributed_by in (select sc.id from public.share_contributors sc where sc.share_id = $4)
                  returning true', p_table)
    into v_ok using left('سحبه الطبيب / withdrawn by the clinician: ' || btrim(p_reason), 500), p_id, (c.o_share).patient_id, (c.o_share).id;
  if not coalesce(v_ok, false) then return jsonb_build_object('status', 'not_found'); end if;
  perform app.share_log((c.o_share).id, 'contribution_retracted', p_ip_hash, p_user_agent,
                        jsonb_build_object('contributor', c.o_contributor, 'table', p_table, 'id', p_id));
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------------------------------------------------------------- patient side
create function public.share_mark_contributor_reviewed(p_contributor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_patient uuid;
begin
  select patient_id into v_patient from public.share_contributors where id = p_contributor;
  if v_patient is null or not app.has_patient_access(v_patient, 'write') then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.share_contributors set reviewed_at = now(), reviewed_by = auth.uid() where id = p_contributor;
end $$;

-- invalidates everything one clinician added (each row keeps the reason and who invalidated it)
create function public.share_invalidate_contributions(p_contributor uuid, p_reason text) returns int
language plpgsql security definer set search_path = '' as $$
declare v_patient uuid; t text; n int; v_total int := 0;
begin
  select patient_id into v_patient from public.share_contributors where id = p_contributor;
  if v_patient is null or not app.has_patient_access(v_patient, 'write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required to mark a record as entered in error' using errcode = '22023'; end if;
  foreach t in array array['encounters', 'conditions', 'procedures', 'clinical_notes', 'medications', 'appointments', 'test_orders',
                           'imaging_studies', 'medical_documents'] loop
    execute format('update public.%I set record_status = ''entered_in_error'', invalidated_reason = $1
                     where contributed_by = $2 and patient_id = $3 and record_status = ''active''', t)
      using left(btrim(p_reason), 500), p_contributor, v_patient;
    get diagnostics n = row_count;
    v_total := v_total + n;
  end loop;
  update public.share_contributors set reviewed_at = now(), reviewed_by = auth.uid() where id = p_contributor;
  return v_total;
end $$;

revoke all on function public.share_identify(text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.share_contribute(text, text, jsonb, text, text) from public;
revoke all on function public.share_register_document(text, text, text, text, text, text, bigint, text, text, date, text, text) from public;
revoke all on function public.share_contrib_state(text) from public;
revoke all on function public.share_retract(text, text, uuid, text, text, text) from public;
grant execute on function public.share_identify(text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.share_contribute(text, text, jsonb, text, text) to service_role;
grant execute on function public.share_register_document(text, text, text, text, text, text, bigint, text, text, date, text, text) to service_role;
grant execute on function public.share_contrib_state(text) to service_role;
grant execute on function public.share_retract(text, text, uuid, text, text, text) to service_role;
revoke all on function public.share_mark_contributor_reviewed(uuid) from public;
revoke all on function public.share_invalidate_contributions(uuid, text) from public;
grant execute on function public.share_mark_contributor_reviewed(uuid) to authenticated;
grant execute on function public.share_invalidate_contributions(uuid, text) to authenticated;
