-- The patient names the clinician on the share itself.
--
-- The file belongs to the patient; a clinician reaches it only through a share link the patient makes for them. Going to
-- another clinician means a new link for that clinician. So the patient states, when making the link, who it is for:
-- name, specialty, clinic, city, licence and phone. The clinician does not type any of it: on opening a link that lets
-- them add, they confirm once that they are the clinician named, and every addition carries that name.

-- ---------------------------------------------------------------- 1. the clinician on the share
alter table public.medical_shares
  add column clinician_name text check (clinician_name is null or length(btrim(clinician_name)) between 3 and 120),
  add column clinician_specialty text check (clinician_specialty is null or length(clinician_specialty) <= 120),
  add column clinician_license text check (clinician_license is null or length(clinician_license) <= 60),
  add column clinician_facility text check (clinician_facility is null or length(clinician_facility) <= 200),
  add column clinician_city text check (clinician_city is null or length(clinician_city) <= 120),
  add column clinician_phone text check (clinician_phone is null or length(clinician_phone) <= 40);
grant select (clinician_name, clinician_specialty, clinician_license, clinician_facility, clinician_city, clinician_phone)
  on public.medical_shares to authenticated;
-- A link that lets the clinician add must say who the clinician is: share_create enforces it. It is not a table check,
-- because links made before this change have no name and every later update of them (opening, revoking) would fail.

-- the clinician no longer signs on screen when the patient named them: the confirmation is recorded instead
alter table public.share_contributors alter column signature_path drop not null;
alter table public.share_contributors drop constraint if exists share_contributors_signature_path_check;
alter table public.share_contributors add constraint share_contributors_signature_path_check
  check (signature_path is null or signature_path like patient_id::text || '/signatures/%.png');
alter table public.share_contributors
  add column city text check (city is null or length(city) <= 120),
  add column named_by_patient boolean not null default false;

-- ---------------------------------------------------------------- 2. share_create with the clinician
drop function public.share_create(uuid, text, text, uuid[], text[], uuid[], date, date, timestamptz, int, boolean, boolean, boolean, boolean, text, jsonb, boolean, text[]);
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
  p_contribute_modules text[] default '{}',
  p_clinician jsonb default null
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
  v_cn text := nullif(btrim(p_clinician ->> 'name'), '');
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
  if coalesce(p_allow_contribute, false) and (v_cn is null or length(v_cn) < 3) then
    raise exception 'clinician_name_required' using errcode = '22023', hint = 'Name the clinician this link is for.';
  end if;
  if p_scope_kind = 'custom' and jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'a custom share needs at least one selected record' using errcode = '22023';
  end if;

  v_token := app.b64url(extensions.gen_random_bytes(24));
  v_pin := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');

  insert into public.medical_shares (
    patient_id, created_by, title, recipient_label, scope_kind, specialty_ids, include, include_sensitive,
    observation_type_ids, date_from, date_to, allow_download, allow_print, allow_notes,
    token_hash, token_hint, pin_hash, max_attempts, expires_at, allow_contribute, contribute_modules,
    clinician_name, clinician_specialty, clinician_license, clinician_facility, clinician_city, clinician_phone)
  values (
    p_patient, v_uid, btrim(p_title), coalesce(nullif(btrim(p_recipient_label), ''), v_cn), p_scope_kind, coalesce(p_specialty_ids, '{}'),
    coalesce(p_include, '{}'), coalesce(p_include_sensitive, false), coalesce(p_observation_type_ids, '{}'),
    p_date_from, p_date_to, coalesce(p_allow_download, false), coalesce(p_allow_print, false), coalesce(p_allow_notes, false),
    app.sha256(v_token), right(v_token, 4), extensions.crypt(v_pin, extensions.gen_salt('bf', 10)), coalesce(p_max_attempts, 5), v_expires,
    coalesce(p_allow_contribute, false), case when coalesce(p_allow_contribute, false) then coalesce(p_contribute_modules, '{}') else '{}' end,
    v_cn, nullif(btrim(p_clinician ->> 'specialty'), ''), nullif(btrim(p_clinician ->> 'license'), ''),
    nullif(btrim(p_clinician ->> 'facility'), ''), nullif(btrim(p_clinician ->> 'city'), ''), nullif(btrim(p_clinician ->> 'phone'), ''))
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
revoke all on function public.share_create(uuid, text, text, uuid[], text[], uuid[], date, date, timestamptz, int, boolean, boolean, boolean, boolean, text, jsonb, boolean, text[], jsonb) from public, anon;
grant execute on function public.share_create(uuid, text, text, uuid[], text[], uuid[], date, date, timestamptz, int, boolean, boolean, boolean, boolean, text, jsonb, boolean, text[], jsonb) to authenticated;

-- ---------------------------------------------------------------- 3. the clinician, as the patient named them
create function public.share_clinician(p_session_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_share uuid; v_sid uuid; v_st text; s public.medical_shares;
begin
  select a.o_share_id, a.o_session_id, a.o_status into v_share, v_sid, v_st from app.resolve_share_session(p_session_token) a;
  if v_st <> 'ok' then return jsonb_build_object('status', 'expired'); end if;
  select * into s from public.medical_shares where id = v_share;
  return jsonb_build_object('status', 'ok', 'name', s.clinician_name, 'specialty', s.clinician_specialty, 'license', s.clinician_license,
                            'facility', s.clinician_facility, 'city', s.clinician_city, 'phone', s.clinician_phone);
end $$;
revoke all on function public.share_clinician(text) from public, anon, authenticated;
grant execute on function public.share_clinician(text) to service_role;

-- one click: "I am the clinician named on this link"; the contributor takes the details the patient gave
create function public.share_confirm_clinician(p_session_token text, p_ip_hash text default null, p_user_agent text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_share uuid; v_sid uuid; v_st text; s public.medical_shares; v_id uuid;
begin
  select a.o_share_id, a.o_session_id, a.o_status into v_share, v_sid, v_st from app.resolve_share_session(p_session_token) a;
  if v_st <> 'ok' then return jsonb_build_object('status', 'expired'); end if;
  select * into s from public.medical_shares where id = v_share;
  if not s.allow_contribute then return jsonb_build_object('status', 'forbidden'); end if;
  if s.clinician_name is null then return jsonb_build_object('status', 'identify_first'); end if;
  select id into v_id from public.share_contributors where session_id = v_sid;
  if v_id is not null then return jsonb_build_object('status', 'ok', 'contributor_id', v_id); end if;
  insert into public.share_contributors (share_id, patient_id, session_id, full_name, specialty, license_no, facility, city, phone,
                                         signature_path, named_by_patient, ip_hash, user_agent)
  values (s.id, s.patient_id, v_sid, s.clinician_name, s.clinician_specialty, s.clinician_license, s.clinician_facility, s.clinician_city,
          s.clinician_phone, null, true, p_ip_hash, left(p_user_agent, 300))
  returning id into v_id;
  perform app.share_log(s.id, 'contributor_identified', p_ip_hash, p_user_agent, jsonb_build_object('contributor', v_id, 'named_by_patient', true));
  return jsonb_build_object('status', 'ok', 'contributor_id', v_id);
end $$;
revoke all on function public.share_confirm_clinician(text, text, text) from public, anon, authenticated;
grant execute on function public.share_confirm_clinician(text, text, text) to service_role;

-- the old form stays only for links made before this change; on a link that names the clinician, the name is the patient's
create or replace function public.share_identify(p_session_token text, p_full_name text, p_specialty text, p_license_no text, p_facility text,
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
  if s.clinician_name is not null then
    return public.share_confirm_clinician(p_session_token, p_ip_hash, p_user_agent);
  end if;
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
