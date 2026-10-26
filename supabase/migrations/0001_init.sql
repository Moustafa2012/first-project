create type user_role as enum ('patient', 'doctor', 'admin');
create type case_status as enum ('open', 'in_progress', 'resolved', 'closed');
create type appointment_status as enum ('scheduled', 'completed', 'cancelled');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null,
  role user_role not null default 'patient',
  created_at timestamptz not null default now()
);

create table cases (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references profiles (id) on delete cascade,
  doctor_id uuid references profiles (id) on delete set null,
  title text not null,
  description text,
  status case_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table case_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases (id) on delete cascade,
  author_id uuid not null references profiles (id),
  body text not null,
  created_at timestamptz not null default now()
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases (id) on delete set null,
  patient_id uuid not null references profiles (id) on delete cascade,
  doctor_id uuid not null references profiles (id) on delete cascade,
  scheduled_at timestamptz not null,
  status appointment_status not null default 'scheduled'
);

alter table profiles enable row level security;
alter table cases enable row level security;
alter table case_notes enable row level security;
alter table appointments enable row level security;

-- Minimal starting policies; refine before handling real patient data.
create policy "profiles: read own" on profiles for select using (auth.uid() = id);
create policy "cases: patient or doctor reads" on cases for select
  using (auth.uid() = patient_id or auth.uid() = doctor_id);
create policy "appointments: participants read" on appointments for select
  using (auth.uid() = patient_id or auth.uid() = doctor_id);
create policy "case_notes: case participants read" on case_notes for select
  using (exists (
    select 1 from cases c
    where c.id = case_id and (auth.uid() = c.patient_id or auth.uid() = c.doctor_id)
  ));
