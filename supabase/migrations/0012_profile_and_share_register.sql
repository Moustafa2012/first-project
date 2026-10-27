-- 0012_profile_and_share_register: richer account profile + avatar storage, and a non-secret fingerprint on shares
-- so the owner can tell links apart in the share register (the token itself is never stored in readable form).

alter table public.profiles
  add column date_of_birth date,
  add column sex text check (sex is null or sex in ('male', 'female', 'intersex', 'unspecified')),
  add column blood_abo text check (blood_abo is null or blood_abo in ('A', 'B', 'AB', 'O')),
  add column blood_rh text check (blood_rh is null or blood_rh in ('+', '-')),
  add column phone text check (phone is null or length(phone) <= 40),
  add column nationality text check (nationality is null or length(nationality) <= 80),
  add column city text check (city is null or length(city) <= 100),
  add column country text check (country is null or length(country) <= 100),
  add column avatar_path text,          -- written by the web server (service role) only
  add column updated_at timestamptz not null default now();

create function app.profiles_guard() returns trigger language plpgsql as $$
begin
  if new.date_of_birth is not null and (new.date_of_birth > current_date or new.date_of_birth < date '1900-01-01') then
    raise exception 'invalid_date_of_birth' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_guard before insert or update on public.profiles for each row execute function app.profiles_guard();

grant update (date_of_birth, sex, blood_abo, blood_rh, phone, nationality, city, country) on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

alter table public.medical_shares add column token_hint text check (token_hint is null or length(token_hint) = 4);
grant select (token_hint) on public.medical_shares to authenticated;

create or replace function public.share_create(
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
    token_hash, token_hint, pin_hash, max_attempts, expires_at)
  values (
    p_patient, v_uid, btrim(p_title), nullif(btrim(p_recipient_label), ''), p_scope_kind, coalesce(p_specialty_ids, '{}'),
    coalesce(p_include, '{}'), coalesce(p_include_sensitive, false), coalesce(p_observation_type_ids, '{}'),
    p_date_from, p_date_to, coalesce(p_allow_download, false), coalesce(p_allow_print, false), coalesce(p_allow_notes, false),
    app.sha256(v_token), right(v_token, 4), extensions.crypt(v_pin, extensions.gen_salt('bf', 10)), coalesce(p_max_attempts, 5), v_expires)
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

grant execute on function public.share_create(uuid, text, text, uuid[], text[], uuid[], date, date, timestamptz, int, boolean, boolean, boolean, boolean, text, jsonb) to authenticated;
