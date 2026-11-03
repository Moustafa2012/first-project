-- 0001_foundation: accounts, specialty catalog, patients, access membership.
-- Design notes
--   * Every patient has an independent file (public.patients). Users reach a patient only through
--     public.patient_members (owner / guardian / caregiver). System admins get NO access to clinical data.
--   * Helper functions live in schema "app" (not exposed through the REST API).
--   * Clinical rows are never hard-deleted; see 0004_audit_and_guards.sql.

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- accounts
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  -- account-level role. 'admin' manages catalogs/accounts only and has no clinical-data policy.
  role text not null default 'user' check (role in ('user', 'admin', 'clinician')),
  preferred_lang text not null default 'ar' check (preferred_lang in ('ar', 'en')),
  created_at timestamptz not null default now()
);

create function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

create function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role = 'admin' from public.profiles p where p.id = auth.uid()), false)
$$;

create function app.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- specialty catalog
create table public.medical_specialties (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name_ar text not null,
  name_en text not null,
  description_ar text,
  description_en text,
  icon text not null default 'folder',
  parent_id uuid references public.medical_specialties (id) on delete set null,
  kind text not null default 'clinical' check (kind in ('clinical', 'support')),
  sort int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- patients
create sequence app.patient_mrn_seq;

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  mrn text not null unique default ('SH-' || lpad(nextval('app.patient_mrn_seq')::text, 8, '0')),
  full_name text not null check (length(btrim(full_name)) between 2 and 200),
  full_name_en text check (full_name_en is null or length(full_name_en) <= 200),
  date_of_birth date not null check (date_of_birth >= date '1900-01-01'),
  sex text not null default 'unspecified' check (sex in ('male', 'female', 'intersex', 'unspecified')),
  nationality text check (nationality is null or length(nationality) <= 80),
  blood_abo text check (blood_abo in ('A', 'B', 'AB', 'O')),
  blood_rh text check (blood_rh in ('+', '-')),
  blood_group_verified boolean not null default false,
  phone text check (phone is null or length(phone) <= 40),
  email text check (email is null or length(email) <= 200),
  address_line text check (address_line is null or length(address_line) <= 300),
  city text check (city is null or length(city) <= 100),
  country text check (country is null or length(country) <= 100),
  -- explicit assertion: absence of allergy rows must never be read as "no allergies".
  allergy_assertion text not null default 'unknown' check (allergy_assertion in ('unknown', 'none_known', 'has_allergies')),
  allergy_assertion_at timestamptz,
  allergy_assertion_by uuid references auth.users (id),
  photo_path text,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz
);
create index patients_created_by_idx on public.patients (created_by);
create trigger patients_touch before update on public.patients
  for each row execute function app.touch_updated_at();

create function app.patients_guard() returns trigger language plpgsql as $$
begin
  if new.date_of_birth > current_date then
    raise exception 'date_of_birth cannot be in the future' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.mrn <> old.mrn or new.created_by <> old.created_by or new.created_at <> old.created_at then
      raise exception 'immutable patient fields cannot be changed' using errcode = '42501';
    end if;
    if new.allergy_assertion is distinct from old.allergy_assertion then
      new.allergy_assertion_at := now();
      new.allergy_assertion_by := auth.uid();
    end if;
  end if;
  return new;
end $$;
create trigger patients_guard before insert or update on public.patients
  for each row execute function app.patients_guard();

-- Who may touch which patient. Only the creating owner exists today; roles are modelled for
-- guardians / caregivers / future care-team grants.
create table public.patient_members (
  patient_id uuid not null references public.patients (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'guardian', 'caregiver', 'clinician')),
  can_write boolean not null default false,
  can_share boolean not null default false,
  invited_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (patient_id, user_id)
);
create index patient_members_user_idx on public.patient_members (user_id) where revoked_at is null;

-- need: read | write | share | manage
create function app.has_patient_access(p_patient uuid, p_need text default 'read') returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.patient_members m
     where m.patient_id = p_patient
       and m.user_id = auth.uid()
       and m.revoked_at is null
       and case p_need
             when 'read' then true
             when 'write' then m.can_write
             when 'share' then m.can_share
             when 'manage' then m.role in ('owner', 'guardian')
             else false
           end)
$$;

-- National id / passport etc. are deliberately NOT part of patients and are never shared.
create table public.patient_identifiers (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  id_type text not null check (id_type in ('national_id', 'residency', 'passport', 'other')),
  id_value text not null check (length(btrim(id_value)) between 3 and 60),
  issuing_country text,
  created_at timestamptz not null default now(),
  unique (patient_id, id_type)
);

create table public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  full_name text not null check (length(btrim(full_name)) >= 2),
  relation text,
  phone text not null,
  is_legal_representative boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create table public.patient_insurance (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  provider text not null,
  policy_number text,
  class_name text,
  valid_from date,
  valid_to date,
  notes text,
  created_at timestamptz not null default now()
);

-- Creates a patient file and the creator's membership atomically.
-- Refuses a likely duplicate among the caller's own files unless p_confirm_distinct is true.
-- (Cross-account matching is intentionally not done: it would reveal other people's records.)
create function public.create_patient(
  p_full_name text, p_date_of_birth date, p_sex text default 'unspecified',
  p_full_name_en text default null, p_nationality text default null,
  p_blood_abo text default null, p_blood_rh text default null,
  p_phone text default null, p_email text default null,
  p_relationship text default 'self', p_confirm_distinct boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_relationship not in ('self', 'dependent') then
    raise exception 'invalid relationship' using errcode = '22023';
  end if;
  if not p_confirm_distinct and exists (
    select 1
      from public.patients p
      join public.patient_members m on m.patient_id = p.id and m.user_id = v_uid and m.revoked_at is null
     where p.date_of_birth = p_date_of_birth
       and lower(btrim(p.full_name)) = lower(btrim(p_full_name))
  ) then
    raise exception 'possible_duplicate' using errcode = 'P0001', hint = 'A patient with the same name and birth date already exists in your account.';
  end if;

  insert into public.patients (full_name, full_name_en, date_of_birth, sex, nationality, blood_abo, blood_rh, phone, email, created_by)
  values (btrim(p_full_name), nullif(btrim(p_full_name_en), ''), p_date_of_birth, coalesce(p_sex, 'unspecified'),
          nullif(btrim(p_nationality), ''), p_blood_abo, p_blood_rh, nullif(btrim(p_phone), ''), nullif(btrim(p_email), ''), v_uid)
  returning id into v_id;

  insert into public.patient_members (patient_id, user_id, role, can_write, can_share)
  values (v_id, v_uid, case p_relationship when 'self' then 'owner' else 'guardian' end, true, true);
  return v_id;
end $$;
