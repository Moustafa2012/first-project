-- 0003_sharing: medical shares protected by an unguessable token + PIN, scoped, expiring, revocable, audited.
--
-- A link alone never grants access: the viewer must also present the PIN, and every request re-checks
-- revocation / expiry / scope inside the database. The viewer-facing functions (share_open, share_bundle,
-- share_document, share_add_note, share_end_session) are executable by service_role ONLY, so they are not
-- reachable from a browser using the public anon key; the web server calls them and adds client throttling.
-- Secrets (token, PIN, session token) are returned once and stored only as hashes.

alter table public.conditions add column sensitive boolean not null default false;
alter table public.medications add column sensitive boolean not null default false;

create table public.medical_shares (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  created_by uuid not null default auth.uid() references auth.users (id),
  title text not null check (length(btrim(title)) between 2 and 200),
  recipient_label text check (recipient_label is null or length(recipient_label) <= 200),
  scope_kind text not null check (scope_kind in ('full', 'specialty', 'custom')),
  specialty_ids uuid[] not null default '{}',
  -- optional modules. Core safety data (identity basics, allergies, chronic conditions,
  -- current medications) is always part of a share; see share_bundle.
  include text[] not null default '{}'
    check (include <@ array['contact', 'other_conditions', 'procedures', 'family_history', 'immunizations', 'encounters',
                            'observations', 'imaging', 'documents', 'specialty_records', 'notes', 'care_plans']::text[]),
  include_sensitive boolean not null default false,
  observation_type_ids uuid[] not null default '{}',
  date_from date,
  date_to date,
  allow_download boolean not null default false,
  allow_print boolean not null default false,
  allow_notes boolean not null default false,
  token_hash bytea not null unique,
  pin_hash text not null,
  max_attempts int not null default 5 check (max_attempts between 3 and 10),
  failed_attempts int not null default 0,
  lock_count int not null default 0,
  locked_until timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id),
  revoke_reason text,
  last_accessed_at timestamptz,
  access_count int not null default 0,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '30 days'),
  check (date_to is null or date_from is null or date_to >= date_from),
  check (scope_kind <> 'specialty' or cardinality(specialty_ids) > 0)
);
create index medical_shares_patient_idx on public.medical_shares (patient_id, created_at desc);

create table public.medical_share_items (
  share_id uuid not null references public.medical_shares (id) on delete cascade,
  table_name text not null check (table_name in
    ('encounters', 'observations', 'medical_documents', 'procedures', 'imaging_studies', 'clinical_notes',
     'specialty_records', 'conditions', 'care_plans')),
  record_id uuid not null,
  primary key (share_id, table_name, record_id)
);

create table public.medical_share_sessions (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.medical_shares (id) on delete cascade,
  session_hash bytea not null unique,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index medical_share_sessions_share_idx on public.medical_share_sessions (share_id);

create table public.medical_share_access_logs (
  id bigint generated always as identity primary key,
  share_id uuid not null references public.medical_shares (id) on delete cascade,
  event text not null check (event in
    ('created', 'revoked', 'auto_revoked', 'opened', 'pin_failed', 'locked', 'locked_attempt', 'blocked',
     'viewed', 'document_opened', 'note_added', 'session_ended')),
  ip_hash text,
  user_agent text,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index medical_share_access_logs_idx on public.medical_share_access_logs (share_id, at desc);

create table public.share_notes (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.medical_shares (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete restrict,
  author_name text not null check (length(btrim(author_name)) between 2 and 120),
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  -- a clinician's note is only a suggestion until the patient reviews it; it is never merged automatically.
  reviewed_at timestamptz
);
create index share_notes_patient_idx on public.share_notes (patient_id, created_at desc);

create table public.share_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  at timestamptz not null default now()
);
create index share_attempts_idx on public.share_attempts (ip_hash, at);

-- ---------------------------------------------------------------- helpers
create function app.b64url(p_bytes bytea) returns text language sql immutable as $$
  select translate(rtrim(encode(p_bytes, 'base64'), '='), E'+/\n', '-_')
$$;

create function app.sha256(p_text text) returns bytea
language sql immutable set search_path = '' as $$
  select extensions.digest(convert_to(p_text, 'UTF8'), 'sha256')
$$;

create function app.share_log(p_share uuid, p_event text, p_ip text, p_ua text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.medical_share_access_logs (share_id, event, ip_hash, user_agent, detail)
  values (p_share, p_event, left(p_ip, 128), left(p_ua, 300), coalesce(p_detail, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------- create / revoke (patient side)
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
  p_items jsonb default '[]'::jsonb
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
  if p_scope_kind = 'custom' and jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'a custom share needs at least one selected record' using errcode = '22023';
  end if;

  v_token := app.b64url(extensions.gen_random_bytes(24));
  v_pin := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');

  insert into public.medical_shares (
    patient_id, created_by, title, recipient_label, scope_kind, specialty_ids, include, include_sensitive,
    observation_type_ids, date_from, date_to, allow_download, allow_print, allow_notes,
    token_hash, pin_hash, max_attempts, expires_at)
  values (
    p_patient, v_uid, btrim(p_title), nullif(btrim(p_recipient_label), ''), p_scope_kind, coalesce(p_specialty_ids, '{}'),
    coalesce(p_include, '{}'), coalesce(p_include_sensitive, false), coalesce(p_observation_type_ids, '{}'),
    p_date_from, p_date_to, coalesce(p_allow_download, false), coalesce(p_allow_print, false), coalesce(p_allow_notes, false),
    app.sha256(v_token), extensions.crypt(v_pin, extensions.gen_salt('bf', 10)), coalesce(p_max_attempts, 5), v_expires)
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

  perform app.share_log(v_id, 'created', null, null, jsonb_build_object('by', v_uid, 'scope', p_scope_kind));
  return jsonb_build_object('share_id', v_id, 'token', v_token, 'pin', v_pin, 'expires_at', v_expires);
end $$;

create function public.share_revoke(p_share uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_patient uuid;
begin
  select patient_id into v_patient from public.medical_shares where id = p_share;
  if v_patient is null or not app.has_patient_access(v_patient, 'share') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.medical_shares
     set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, auth.uid()),
         revoke_reason = coalesce(revoke_reason, left(p_reason, 300))
   where id = p_share;
  delete from public.medical_share_sessions where share_id = p_share;
  perform app.share_log(p_share, 'revoked', null, null, jsonb_build_object('by', auth.uid()));
end $$;

create function public.share_mark_note_reviewed(p_note uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_patient uuid;
begin
  select patient_id into v_patient from public.share_notes where id = p_note;
  if v_patient is null or not app.has_patient_access(v_patient, 'share') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.share_notes set reviewed_at = coalesce(reviewed_at, now()) where id = p_note;
end $$;

-- ---------------------------------------------------------------- open a session (viewer side, service_role only)
create function public.share_open(p_token text, p_pin text, p_ip_hash text, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.medical_shares;
  v_recent int;
  v_session text;
  v_exp timestamptz;
  v_wait int;
begin
  delete from public.share_attempts where at < now() - interval '1 day';
  select count(*) into v_recent from public.share_attempts
   where ip_hash = coalesce(p_ip_hash, '-') and at > now() - interval '15 minutes';
  if v_recent >= 20 then
    return jsonb_build_object('status', 'throttled');
  end if;

  if p_token is null or length(p_token) < 20 or length(p_token) > 128 then
    insert into public.share_attempts (ip_hash) values (coalesce(p_ip_hash, '-'));
    return jsonb_build_object('status', 'unavailable');
  end if;

  select * into s from public.medical_shares where token_hash = app.sha256(p_token) for update;
  if not found then
    insert into public.share_attempts (ip_hash) values (coalesce(p_ip_hash, '-'));
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- revoked / expired links look exactly like unknown links to the caller
  if s.revoked_at is not null or s.expires_at <= now() then
    insert into public.share_attempts (ip_hash) values (coalesce(p_ip_hash, '-'));
    perform app.share_log(s.id, 'blocked', p_ip_hash, p_user_agent,
      jsonb_build_object('reason', case when s.revoked_at is not null then 'revoked' else 'expired' end));
    return jsonb_build_object('status', 'unavailable');
  end if;

  if s.locked_until is not null and s.locked_until > now() then
    v_wait := ceil(extract(epoch from (s.locked_until - now())))::int;
    insert into public.share_attempts (ip_hash) values (coalesce(p_ip_hash, '-'));
    perform app.share_log(s.id, 'locked_attempt', p_ip_hash, p_user_agent);
    return jsonb_build_object('status', 'locked', 'retry_after_seconds', v_wait);
  end if;

  if p_pin is not null and p_pin ~ '^[0-9]{6}$' and extensions.crypt(p_pin, s.pin_hash) = s.pin_hash then
    v_session := app.b64url(extensions.gen_random_bytes(32));
    v_exp := least(s.expires_at, now() + interval '30 minutes');
    insert into public.medical_share_sessions (share_id, session_hash, ip_hash, user_agent, expires_at)
    values (s.id, app.sha256(v_session), left(p_ip_hash, 128), left(p_user_agent, 300), v_exp);
    delete from public.medical_share_sessions where expires_at < now() - interval '1 day';
    update public.medical_shares
       set failed_attempts = 0, lock_count = 0, locked_until = null,
           last_accessed_at = now(), access_count = access_count + 1
     where id = s.id;
    perform app.share_log(s.id, 'opened', p_ip_hash, p_user_agent);
    return jsonb_build_object('status', 'ok', 'session_token', v_session, 'expires_at', v_exp);
  end if;

  -- wrong PIN
  insert into public.share_attempts (ip_hash) values (coalesce(p_ip_hash, '-'));
  s.failed_attempts := s.failed_attempts + 1;
  perform app.share_log(s.id, 'pin_failed', p_ip_hash, p_user_agent, jsonb_build_object('n', s.failed_attempts));
  if s.failed_attempts >= s.max_attempts then
    s.lock_count := s.lock_count + 1;
    if s.lock_count >= 3 then
      update public.medical_shares
         set revoked_at = now(), revoke_reason = 'auto_revoked_too_many_failed_pins', failed_attempts = 0, lock_count = s.lock_count
       where id = s.id;
      delete from public.medical_share_sessions where share_id = s.id;
      perform app.share_log(s.id, 'auto_revoked', p_ip_hash, p_user_agent);
      return jsonb_build_object('status', 'unavailable');
    end if;
    v_wait := 900 * (2 ^ (s.lock_count - 1))::int;       -- 15 min, then 30 min
    update public.medical_shares
       set failed_attempts = 0, lock_count = s.lock_count, locked_until = now() + make_interval(secs => v_wait)
     where id = s.id;
    perform app.share_log(s.id, 'locked', p_ip_hash, p_user_agent, jsonb_build_object('seconds', v_wait));
    return jsonb_build_object('status', 'locked', 'retry_after_seconds', v_wait);
  end if;
  update public.medical_shares set failed_attempts = s.failed_attempts where id = s.id;
  return jsonb_build_object('status', 'invalid_pin', 'attempts_left', s.max_attempts - s.failed_attempts);
end $$;

-- Resolves a viewer session and re-validates the share. status: ok | expired
create function app.resolve_share_session(p_session_token text, out o_share_id uuid, out o_session_id uuid, out o_status text)
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  o_status := 'expired';
  if p_session_token is null or length(p_session_token) < 20 or length(p_session_token) > 128 then return; end if;
  select ss.id as session_id, ss.expires_at as session_exp, sh.id as share_id, sh.revoked_at, sh.expires_at as share_exp
    into r
    from public.medical_share_sessions ss
    join public.medical_shares sh on sh.id = ss.share_id
   where ss.session_hash = app.sha256(p_session_token);
  if not found then return; end if;
  if r.revoked_at is not null or r.share_exp <= now() or r.session_exp <= now() then return; end if;
  o_share_id := r.share_id; o_session_id := r.session_id; o_status := 'ok';
end $$;

-- ---------------------------------------------------------------- the scoped read model
create function public.share_bundle(p_session_token text, p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_share uuid; v_sid uuid; v_status text;
  s public.medical_shares;
  p public.patients;
  v_spec uuid[];
  v_from date; v_to date;
  v_specs jsonb;
  r jsonb;
begin
  select o_share_id, o_session_id, o_status into v_share, v_sid, v_status from app.resolve_share_session(p_session_token);
  if v_status <> 'ok' then return jsonb_build_object('status', 'expired'); end if;
  select * into s from public.medical_shares where id = v_share;
  select * into p from public.patients where id = s.patient_id;

  v_spec := case when s.scope_kind = 'specialty' then s.specialty_ids else null end;
  v_from := coalesce(s.date_from, '-infinity'::date);
  v_to := coalesce(s.date_to, 'infinity'::date);

  select coalesce(jsonb_agg(jsonb_build_object('code', m.code, 'name_ar', m.name_ar, 'name_en', m.name_en) order by m.sort), '[]')
    into v_specs from public.medical_specialties m where m.id = any(s.specialty_ids);

  r := jsonb_build_object(
    'status', 'ok',
    'meta', jsonb_build_object(
      'title', s.title, 'recipient_label', s.recipient_label, 'scope_kind', s.scope_kind, 'specialties', v_specs,
      'include', to_jsonb(s.include), 'date_from', s.date_from, 'date_to', s.date_to,
      'expires_at', s.expires_at, 'allow_download', s.allow_download, 'allow_print', s.allow_print,
      'allow_notes', s.allow_notes, 'generated_at', now()),
    'patient', jsonb_build_object(
      'mrn', p.mrn, 'full_name', p.full_name, 'full_name_en', p.full_name_en, 'date_of_birth', p.date_of_birth,
      'age_years', date_part('year', age(current_date, p.date_of_birth))::int, 'sex', p.sex, 'nationality', p.nationality,
      'blood_group', case when p.blood_abo is null then null else p.blood_abo || coalesce(p.blood_rh, '') end,
      'blood_group_verified', p.blood_group_verified,
      'phone', case when 'contact' = any(s.include) then p.phone end),
    'allergy_assertion', p.allergy_assertion,
    'allergies', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'substance', a.substance, 'category', a.category, 'reaction', a.reaction, 'severity', a.severity,
        'certainty', a.certainty, 'onset_date', a.onset_date, 'notes', a.notes) order by a.substance)
      from public.allergies a
      where a.patient_id = p.id and a.status = 'active' and a.record_status = 'active' and a.certainty <> 'refuted'), '[]'),
    'chronic_conditions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'icd10_code', c.icd10_code, 'category', c.category, 'clinical_status', c.clinical_status,
        'certainty', c.certainty, 'severity', c.severity, 'onset_date', c.onset_date, 'notes', c.notes) order by c.name)
      from public.conditions c
      where c.patient_id = p.id and c.record_status = 'active'
        and c.category in ('chronic', 'congenital', 'genetic', 'disability')
        and c.clinical_status in ('active', 'recurrence', 'inactive', 'remission')
        and c.certainty <> 'refuted'
        and (not c.sensitive or s.include_sensitive or exists (
              select 1 from public.medical_share_items i where i.share_id = s.id and i.table_name = 'conditions' and i.record_id = c.id))), '[]'),
    'medications', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name_brand', m.name_brand, 'name_generic', m.name_generic, 'strength', m.strength, 'form', m.form,
        'dose', m.dose, 'route', m.route, 'frequency', m.frequency, 'as_needed', m.as_needed, 'origin', m.origin,
        'status', m.status, 'start_date', m.start_date, 'indication', m.indication, 'instructions', m.instructions)
        order by coalesce(m.name_generic, m.name_brand))
      from public.medications m
      where m.patient_id = p.id and m.record_status = 'active' and m.status in ('active', 'on_hold')
        and (not m.sensitive or s.include_sensitive)), '[]')
  );

  if 'contact' = any(s.include) then
    r := r || jsonb_build_object('emergency_contacts', coalesce((select jsonb_agg(jsonb_build_object(
        'full_name', e.full_name, 'relation', e.relation, 'phone', e.phone, 'is_legal_representative', e.is_legal_representative))
      from public.emergency_contacts e where e.patient_id = p.id), '[]'));
  end if;

  if 'other_conditions' = any(s.include) then
    r := r || jsonb_build_object('other_conditions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'icd10_code', c.icd10_code, 'category', c.category, 'clinical_status', c.clinical_status,
        'certainty', c.certainty, 'onset_date', c.onset_date, 'resolved_date', c.resolved_date, 'specialty_id', c.specialty_id)
        order by c.onset_date desc nulls last)
      from public.conditions c
      where c.patient_id = p.id and c.record_status = 'active'
        and c.category not in ('chronic', 'congenital', 'genetic', 'disability')
        and (v_spec is null or c.specialty_id = any(v_spec))
        and (not c.sensitive or s.include_sensitive)
        and (s.scope_kind <> 'custom' or exists (select 1 from public.medical_share_items i
              where i.share_id = s.id and i.table_name = 'conditions' and i.record_id = c.id))), '[]'));
  end if;

  if 'encounters' = any(s.include) then
    r := r || jsonb_build_object('encounters', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'status', e.status, 'started_at', e.started_at, 'ended_at', e.ended_at,
        'facility_name', e.facility_name, 'practitioner_name', e.practitioner_name, 'reason', e.reason,
        'symptoms', e.symptoms, 'examination', e.examination, 'assessment', e.assessment, 'plan', e.plan,
        'summary', e.summary, 'discharge_summary', e.discharge_summary, 'specialty_id', e.specialty_id)
        order by e.started_at desc)
      from public.encounters e
      where e.patient_id = p.id and e.record_status = 'active'
        and (v_spec is null or e.specialty_id = any(v_spec))
        and e.started_at::date between v_from and v_to
        and (s.scope_kind <> 'custom' or exists (select 1 from public.medical_share_items i
              where i.share_id = s.id and i.table_name = 'encounters' and i.record_id = e.id))), '[]'));
  end if;

  if 'procedures' = any(s.include) then
    r := r || jsonb_build_object('procedures', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'kind', x.kind, 'name', x.name, 'performed_on', x.performed_on, 'body_site', x.body_site,
        'facility_name', x.facility_name, 'operator_name', x.operator_name, 'indication', x.indication,
        'outcome', x.outcome, 'complications', x.complications, 'notes', x.notes, 'specialty_id', x.specialty_id)
        order by x.performed_on desc)
      from public.procedures x
      where x.patient_id = p.id and x.record_status = 'active'
        and (v_spec is null or x.specialty_id = any(v_spec))
        and x.performed_on between v_from and v_to
        and (s.scope_kind <> 'custom' or exists (select 1 from public.medical_share_items i
              where i.share_id = s.id and i.table_name = 'procedures' and i.record_id = x.id))), '[]'));
  end if;

  if 'imaging' = any(s.include) then
    r := r || jsonb_build_object('imaging', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'modality', x.modality, 'body_site', x.body_site, 'performed_on', x.performed_on,
        'facility_name', x.facility_name, 'radiologist_name', x.radiologist_name, 'findings', x.findings,
        'impression', x.impression, 'document_id', x.document_id, 'specialty_id', x.specialty_id)
        order by x.performed_on desc)
      from public.imaging_studies x
      where x.patient_id = p.id and x.record_status = 'active'
        and (v_spec is null or x.specialty_id = any(v_spec))
        and x.performed_on between v_from and v_to
        and (s.scope_kind <> 'custom' or exists (select 1 from public.medical_share_items i
              where i.share_id = s.id and i.table_name = 'imaging_studies' and i.record_id = x.id))), '[]'));
  end if;

  if 'family_history' = any(s.include) then
    r := r || jsonb_build_object('family_history', coalesce((select jsonb_agg(jsonb_build_object(
        'relation', f.relation, 'condition_name', f.condition_name, 'age_at_onset', f.age_at_onset,
        'deceased', f.deceased, 'certainty', f.certainty, 'notes', f.notes))
      from public.family_history f where f.patient_id = p.id and f.record_status = 'active'), '[]'));
  end if;

  if 'immunizations' = any(s.include) then
    r := r || jsonb_build_object('immunizations', coalesce((select jsonb_agg(jsonb_build_object(
        'vaccine_name', x.vaccine_name, 'dose_number', x.dose_number, 'status', x.status,
        'administered_on', x.administered_on, 'next_due_on', x.next_due_on) order by x.administered_on desc nulls last)
      from public.immunizations x where x.patient_id = p.id and x.record_status = 'active'), '[]'));
  end if;

  if 'care_plans' = any(s.include) then
    r := r || jsonb_build_object('care_plans', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'title', x.title, 'status', x.status, 'start_date', x.start_date, 'end_date', x.end_date,
        'goals', x.goals, 'instructions', x.instructions, 'specialty_id', x.specialty_id))
      from public.care_plans x
      where x.patient_id = p.id and x.record_status = 'active'
        and (v_spec is null or x.specialty_id = any(v_spec))
        and (s.scope_kind <> 'custom' or exists (select 1 from public.medical_share_items i
              where i.share_id = s.id and i.table_name = 'care_plans' and i.record_id = x.id))), '[]'));
  end if;

  if 'notes' = any(s.include) then
    r := r || jsonb_build_object('notes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'kind', x.kind, 'title', x.title, 'body', x.body, 'author_name', x.author_name,
        'noted_at', x.noted_at, 'specialty_id', x.specialty_id) order by x.noted_at desc)
      from public.clinical_notes x
      where x.patient_id = p.id and x.record_status = 'active'
        and (v_spec is null or x.specialty_id = any(v_spec))
        and x.noted_at::date between v_from and v_to
        and (s.scope_kind <> 'custom' or exists (select 1 from public.medical_share_items i
              where i.share_id = s.id and i.table_name = 'clinical_notes' and i.record_id = x.id))), '[]'));
  end if;

  if 'specialty_records' = any(s.include) then
    r := r || jsonb_build_object('specialty_records', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'specialty_id', x.specialty_id, 'record_type_code', t.code, 'record_type_name_ar', t.name_ar,
        'record_type_name_en', t.name_en, 'fields', t.fields, 'occurred_on', x.occurred_on, 'data', x.data, 'notes', x.notes)
        order by x.occurred_on desc)
      from public.specialty_records x
      join public.specialty_record_types t on t.id = x.record_type_id
      where x.patient_id = p.id and x.record_status = 'active'
        and (v_spec is null or x.specialty_id = any(v_spec))
        and x.occurred_on between v_from and v_to
        and (s.scope_kind <> 'custom' or exists (select 1 from public.medical_share_items i
              where i.share_id = s.id and i.table_name = 'specialty_records' and i.record_id = x.id))), '[]'));
  end if;

  if 'observations' = any(s.include) then
    r := r || jsonb_build_object('observations', coalesce((select jsonb_agg(row_to_json(q)::jsonb order by q.effective_at desc) from (
        select o.id, t.code as type_code, t.name_ar, t.name_en, t.category, t.lab_group, t.value_kind,
               o.custom_name, o.value_num, o.value_num2, o.value_text, o.unit, o.effective_at, o.setting, o.context,
               o.interpretation, o.ref_low, o.ref_high, o.ref_text, o.status, (o.supersedes_id is not null) as is_correction,
               o.report_id, o.notes
          from public.observations o
          join public.observation_types t on t.id = o.type_id
         where o.patient_id = p.id and o.status in ('preliminary', 'final')
           and o.effective_at::date between v_from and v_to
           and (case
                  when s.scope_kind = 'custom' then exists (select 1 from public.medical_share_items i
                         where i.share_id = s.id and i.table_name = 'observations' and i.record_id = o.id)
                  when cardinality(s.observation_type_ids) > 0 then o.type_id = any(s.observation_type_ids)
                  when v_spec is not null then coalesce(o.specialty_id, t.default_specialty_id) = any(v_spec)
                  else true
                end)
         order by o.effective_at desc
         limit 5000) q), '[]'));
  end if;

  if 'documents' = any(s.include) then
    r := r || jsonb_build_object('documents', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'title', d.title, 'doc_type', d.doc_type, 'document_date', d.document_date, 'mime_type', d.mime_type,
        'size_bytes', d.size_bytes, 'description', d.description, 'specialty_id', d.specialty_id)
        order by d.document_date desc nulls last)
      from public.medical_documents d
      where d.patient_id = p.id and d.record_status = 'active'
        and (v_spec is null or d.specialty_id = any(v_spec))
        and (d.document_date is null or d.document_date between v_from and v_to)
        and (case
               when s.scope_kind = 'custom' then exists (select 1 from public.medical_share_items i
                      where i.share_id = s.id and i.table_name = 'medical_documents' and i.record_id = d.id)
               else d.sensitivity <> 'restricted'
             end)), '[]'));
  end if;

  r := r || jsonb_build_object('specialties', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'code', m.code, 'name_ar', m.name_ar, 'name_en', m.name_en)) from public.medical_specialties m), '[]'));

  perform app.share_log(s.id, 'viewed', p_ip_hash, p_user_agent, jsonb_build_object('session', v_sid));
  return r;
end $$;

-- Authorises one document for the current viewer session. The caller (web server) then mints a
-- short-lived signed URL for the returned path; the path itself is never sent to the browser.
create function public.share_document(p_session_token text, p_document uuid, p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_share uuid; v_sid uuid; v_status text;
  s public.medical_shares;
  d public.medical_documents;
  v_spec uuid[];
begin
  select o_share_id, o_session_id, o_status into v_share, v_sid, v_status from app.resolve_share_session(p_session_token);
  if v_status <> 'ok' then return jsonb_build_object('status', 'expired'); end if;
  select * into s from public.medical_shares where id = v_share;
  if not ('documents' = any(s.include)) then return jsonb_build_object('status', 'forbidden'); end if;
  v_spec := case when s.scope_kind = 'specialty' then s.specialty_ids else null end;

  select * into d from public.medical_documents x
   where x.id = p_document and x.patient_id = s.patient_id and x.record_status = 'active'
     and (v_spec is null or x.specialty_id = any(v_spec))
     and (x.document_date is null or x.document_date between coalesce(s.date_from, '-infinity'::date) and coalesce(s.date_to, 'infinity'::date))
     and (case
            when s.scope_kind = 'custom' then exists (select 1 from public.medical_share_items i
                   where i.share_id = s.id and i.table_name = 'medical_documents' and i.record_id = x.id)
            else x.sensitivity <> 'restricted'
          end);
  if not found then return jsonb_build_object('status', 'forbidden'); end if;

  perform app.share_log(s.id, 'document_opened', p_ip_hash, p_user_agent, jsonb_build_object('document', d.id));
  return jsonb_build_object('status', 'ok', 'storage_path', d.storage_path, 'mime_type', d.mime_type,
                            'filename', d.original_filename, 'allow_download', s.allow_download);
end $$;

create function public.share_add_note(p_session_token text, p_author_name text, p_body text, p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_share uuid; v_sid uuid; v_status text;
  s public.medical_shares;
begin
  select o_share_id, o_session_id, o_status into v_share, v_sid, v_status from app.resolve_share_session(p_session_token);
  if v_status <> 'ok' then return jsonb_build_object('status', 'expired'); end if;
  select * into s from public.medical_shares where id = v_share;
  if not s.allow_notes then return jsonb_build_object('status', 'forbidden'); end if;
  if (select count(*) from public.share_notes where share_id = s.id) >= 20 then
    return jsonb_build_object('status', 'limit');
  end if;
  insert into public.share_notes (share_id, patient_id, author_name, body)
  values (s.id, s.patient_id, btrim(p_author_name), btrim(p_body));
  perform app.share_log(s.id, 'note_added', p_ip_hash, p_user_agent);
  return jsonb_build_object('status', 'ok');
end $$;

create function public.share_end_session(p_session_token text, p_ip_hash text default null, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_share uuid; v_sid uuid; v_status text;
begin
  select o_share_id, o_session_id, o_status into v_share, v_sid, v_status from app.resolve_share_session(p_session_token);
  if v_status = 'ok' then
    delete from public.medical_share_sessions where id = v_sid;
    perform app.share_log(v_share, 'session_ended', p_ip_hash, p_user_agent);
  end if;
end $$;
