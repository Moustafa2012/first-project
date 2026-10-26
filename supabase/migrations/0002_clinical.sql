-- 0002_clinical: longitudinal clinical record.
-- Provenance / lifecycle columns shared by all clinical tables (source, verification, record_status,
-- recorded_by, recorded_at, updated_*, invalidated_*) are added in 0004_audit_and_guards.sql.
-- Composite foreign keys (child_id, patient_id) make cross-patient links impossible.

-- ---------------------------------------------------------------- encounters
create table public.encounters (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  kind text not null default 'clinic' check (kind in
    ('clinic', 'emergency', 'telehealth', 'inpatient', 'surgery', 'diagnostic', 'therapy_session', 'follow_up', 'home_visit', 'dental')),
  status text not null default 'completed' check (status in ('planned', 'in_progress', 'completed', 'cancelled')),
  started_at timestamptz not null,
  ended_at timestamptz,
  facility_name text,
  practitioner_name text,
  reason text,
  symptoms text,
  history_of_present_illness text,
  examination text,
  assessment text,
  plan text,
  summary text,
  discharge_summary text,
  follow_up_date date,
  unique (id, patient_id),
  check (ended_at is null or ended_at >= started_at)
);
create index encounters_patient_time_idx on public.encounters (patient_id, started_at desc);
create index encounters_specialty_idx on public.encounters (patient_id, specialty_id);

-- ---------------------------------------------------------------- conditions (diagnoses, chronic, congenital...)
create table public.conditions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  encounter_id uuid,
  name text not null check (length(btrim(name)) >= 2),
  icd10_code text check (icd10_code is null or length(icd10_code) <= 12),
  category text not null default 'diagnosis' check (category in
    ('chronic', 'congenital', 'genetic', 'diagnosis', 'acute', 'mental_health', 'disability', 'other')),
  -- is it happening now?
  clinical_status text not null default 'active' check (clinical_status in
    ('active', 'recurrence', 'inactive', 'remission', 'resolved')),
  -- how sure are we? never infer "confirmed" from absence of data.
  certainty text not null default 'unknown' check (certainty in ('confirmed', 'suspected', 'provisional', 'unknown', 'refuted')),
  severity text check (severity in ('mild', 'moderate', 'severe')),
  onset_date date,
  resolved_date date,
  notes text,
  unique (id, patient_id),
  foreign key (encounter_id, patient_id) references public.encounters (id, patient_id),
  check (resolved_date is null or onset_date is null or resolved_date >= onset_date)
);
create index conditions_patient_idx on public.conditions (patient_id, clinical_status, category);

-- ---------------------------------------------------------------- allergies
create table public.allergies (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  substance text not null check (length(btrim(substance)) >= 2),
  category text not null default 'medication' check (category in ('medication', 'food', 'environment', 'biologic', 'latex', 'other')),
  reaction text,
  severity text not null default 'unknown' check (severity in ('mild', 'moderate', 'severe', 'life_threatening', 'unknown')),
  status text not null default 'active' check (status in ('active', 'inactive', 'resolved')),
  certainty text not null default 'unverified' check (certainty in ('unverified', 'confirmed', 'refuted')),
  onset_date date,
  notes text,
  unique (id, patient_id)
);
create index allergies_patient_idx on public.allergies (patient_id, status);

-- ---------------------------------------------------------------- medications
create table public.medications (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  encounter_id uuid,
  condition_id uuid,
  name_brand text,
  name_generic text,
  strength text,
  form text,
  dose text,
  route text,
  frequency text,
  as_needed boolean not null default false,
  -- prescribed by a clinician vs. told to us by the patient vs. over the counter
  origin text not null default 'patient_reported' check (origin in ('prescribed', 'patient_reported', 'otc_supplement')),
  status text not null default 'active' check (status in ('active', 'on_hold', 'stopped', 'completed')),
  stopped_by text check (stopped_by in ('clinician', 'patient', 'course_completed', 'adverse_reaction', 'other')),
  stop_reason text,
  start_date date,
  end_date date,
  indication text,
  prescriber_name text,
  instructions text,
  adverse_effects text,
  notes text,
  unique (id, patient_id),
  foreign key (encounter_id, patient_id) references public.encounters (id, patient_id),
  foreign key (condition_id, patient_id) references public.conditions (id, patient_id),
  check (name_brand is not null or name_generic is not null),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index medications_patient_idx on public.medications (patient_id, status);

-- ---------------------------------------------------------------- procedures / surgeries
create table public.procedures (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  encounter_id uuid,
  condition_id uuid,
  kind text not null default 'procedure' check (kind in ('surgery', 'procedure', 'dental', 'endoscopy', 'biopsy', 'therapy', 'other')),
  name text not null check (length(btrim(name)) >= 2),
  performed_on date not null,
  body_site text,
  facility_name text,
  operator_name text,
  anesthesia text,
  indication text,
  outcome text,
  complications text,
  notes text,
  unique (id, patient_id),
  foreign key (encounter_id, patient_id) references public.encounters (id, patient_id),
  foreign key (condition_id, patient_id) references public.conditions (id, patient_id)
);
create index procedures_patient_idx on public.procedures (patient_id, performed_on desc);

-- ---------------------------------------------------------------- documents (metadata; bytes live in private storage)
create table public.medical_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  encounter_id uuid,
  doc_type text not null default 'other' check (doc_type in
    ('doctor_report', 'lab_report', 'imaging_image', 'imaging_report', 'dental_image', 'prescription', 'operative_report',
     'discharge_summary', 'vaccination_record', 'external_record', 'insurance', 'other')),
  title text not null check (length(btrim(title)) >= 2),
  description text,
  document_date date,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid not null default auth.uid() references auth.users (id),
  -- restricted documents are never included in a share unless the patient picks them one by one.
  sensitivity text not null default 'standard' check (sensitivity in ('standard', 'sensitive', 'restricted')),
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  unique (id, patient_id),
  foreign key (encounter_id, patient_id) references public.encounters (id, patient_id),
  check (storage_path like patient_id::text || '/%')
);
create index documents_patient_idx on public.medical_documents (patient_id, document_date desc);

-- ---------------------------------------------------------------- observation catalog + rules
create table public.observation_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,50}$'),
  category text not null check (category in ('vital', 'lab', 'activity', 'other')),
  lab_group text,
  name_ar text not null,
  name_en text not null,
  -- numeric: one number; bp: systolic + diastolic stored together; text: free/qualitative result
  value_kind text not null default 'numeric' check (value_kind in ('numeric', 'bp', 'text')),
  default_unit text,
  -- unit -> multiplier that converts a value in that unit to default_unit (used only to apply
  -- plausibility limits and alert rules; stored values are never rewritten).
  unit_conversions jsonb not null default '{}'::jsonb,
  decimals int not null default 1,
  plausible_min numeric,
  plausible_max numeric,
  default_specialty_id uuid references public.medical_specialties (id),
  sort int not null default 0,
  is_active boolean not null default true
);

-- Reviewable alert bands. A band applies to one component (1 = value / systolic, 2 = diastolic).
-- Bands are screening aids: they flag "needs assessment", never a diagnosis.
create table public.observation_bands (
  id uuid primary key default gen_random_uuid(),
  type_id uuid not null references public.observation_types (id) on delete cascade,
  component smallint not null default 1 check (component in (1, 2)),
  context text,                       -- null = any context
  exclude_contexts text[] not null default '{}',   -- e.g. resting-heart-rate bands must not judge post-exercise readings
  age_min_years int not null default 18,
  age_max_years int,
  band text not null check (band in ('critical_low', 'low', 'normal', 'borderline', 'high', 'critical_high')),
  lo numeric,                         -- inclusive, null = -infinity (in the type's default_unit)
  hi numeric,                         -- exclusive, null = +infinity
  rule_set text not null,
  rationale text,
  reviewed_by_clinician boolean not null default false,
  check (lo is null or hi is null or lo < hi)
);
create index observation_bands_type_idx on public.observation_bands (type_id, component);

-- ---------------------------------------------------------------- lab reports (header) and observations
create table public.lab_reports (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  encounter_id uuid,
  document_id uuid,
  title text not null check (length(btrim(title)) >= 2),
  lab_name text,
  specimen_type text,
  collected_at timestamptz,
  performed_at timestamptz,
  approved_at timestamptz,
  approved_by_name text,
  status text not null default 'final' check (status in ('preliminary', 'final', 'corrected')),
  lab_notes text,
  unique (id, patient_id),
  foreign key (encounter_id, patient_id) references public.encounters (id, patient_id),
  foreign key (document_id, patient_id) references public.medical_documents (id, patient_id)
);
create index lab_reports_patient_idx on public.lab_reports (patient_id, collected_at desc);

create table public.observations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  type_id uuid not null references public.observation_types (id),
  specialty_id uuid references public.medical_specialties (id),
  report_id uuid,
  encounter_id uuid,
  custom_name text,
  value_num numeric,
  value_num2 numeric,
  value_text text,
  unit text,
  effective_at timestamptz not null,          -- when it was measured / sampled
  setting text not null default 'home' check (setting in ('home', 'clinic', 'hospital', 'lab', 'other')),
  device text,
  context text,                               -- fasting, random, post_meal_2h, resting, left_arm, ...
  symptoms text,
  notes text,
  ref_low numeric,
  ref_high numeric,
  ref_text text,
  interpretation text not null default 'not_assessed' check (interpretation in
    ('normal', 'borderline', 'low', 'high', 'critical_low', 'critical_high', 'abnormal', 'not_assessed')),
  interpretation_basis text check (interpretation_basis in ('lab_reference_range', 'reported_by_lab', 'screening_rule', 'none')),
  status text not null default 'final' check (status in ('preliminary', 'final', 'amended', 'entered_in_error')),
  supersedes_id uuid references public.observations (id),
  amendment_reason text,
  unique (id, patient_id),
  foreign key (report_id, patient_id) references public.lab_reports (id, patient_id),
  foreign key (encounter_id, patient_id) references public.encounters (id, patient_id),
  check (value_num is not null or value_text is not null),
  check (value_num2 is null or value_num is not null)
);
create index observations_series_idx on public.observations (patient_id, type_id, effective_at desc);
create index observations_patient_time_idx on public.observations (patient_id, effective_at desc);
create index observations_report_idx on public.observations (report_id);

-- ---------------------------------------------------------------- test orders (requested tests)
create table public.test_orders (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  encounter_id uuid,
  kind text not null default 'lab' check (kind in ('lab', 'imaging', 'clinical', 'other')),
  name text not null check (length(btrim(name)) >= 2),
  reason text,
  priority text not null default 'routine' check (priority in ('routine', 'soon', 'urgent')),
  status text not null default 'requested' check (status in ('requested', 'done', 'cancelled')),
  requested_on date not null default current_date,
  done_on date,
  report_id uuid,
  notes text,
  unique (id, patient_id),
  foreign key (encounter_id, patient_id) references public.encounters (id, patient_id),
  foreign key (report_id, patient_id) references public.lab_reports (id, patient_id)
);
create index test_orders_patient_idx on public.test_orders (patient_id, status);

-- ---------------------------------------------------------------- imaging
create table public.imaging_studies (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  encounter_id uuid,
  document_id uuid,
  modality text not null default 'xray' check (modality in
    ('xray', 'dental_xray', 'panoramic', 'ct', 'mri', 'ultrasound', 'echo', 'mammography', 'fluoroscopy', 'nuclear', 'other')),
  body_site text,
  performed_on date not null,
  facility_name text,
  radiologist_name text,
  findings text,
  impression text,
  unique (id, patient_id),
  foreign key (encounter_id, patient_id) references public.encounters (id, patient_id),
  foreign key (document_id, patient_id) references public.medical_documents (id, patient_id)
);
create index imaging_patient_idx on public.imaging_studies (patient_id, performed_on desc);

-- ---------------------------------------------------------------- immunizations
create table public.immunizations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  vaccine_name text not null check (length(btrim(vaccine_name)) >= 2),
  dose_number int check (dose_number is null or dose_number between 1 and 20),
  status text not null default 'completed' check (status in ('completed', 'scheduled', 'declined', 'contraindicated')),
  administered_on date,
  next_due_on date,
  lot_number text,
  facility_name text,
  administered_by text,
  notes text,
  unique (id, patient_id)
);
create index immunizations_patient_idx on public.immunizations (patient_id, administered_on desc);

-- ---------------------------------------------------------------- family history
create table public.family_history (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  relation text not null,
  condition_name text not null check (length(btrim(condition_name)) >= 2),
  age_at_onset int check (age_at_onset is null or age_at_onset between 0 and 130),
  deceased boolean,
  certainty text not null default 'reported' check (certainty in ('reported', 'confirmed', 'unknown')),
  notes text,
  unique (id, patient_id)
);
create index family_history_patient_idx on public.family_history (patient_id);

-- ---------------------------------------------------------------- appointments and care plans
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  encounter_id uuid,
  scheduled_at timestamptz not null,
  facility_name text,
  practitioner_name text,
  reason text,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  notes text,
  unique (id, patient_id),
  foreign key (encounter_id, patient_id) references public.encounters (id, patient_id)
);
create index appointments_patient_idx on public.appointments (patient_id, scheduled_at);

create table public.care_plans (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  encounter_id uuid,
  condition_id uuid,
  title text not null check (length(btrim(title)) >= 2),
  status text not null default 'active' check (status in ('draft', 'active', 'on_hold', 'completed', 'cancelled')),
  start_date date,
  end_date date,
  goals text,
  instructions text,
  unique (id, patient_id),
  foreign key (encounter_id, patient_id) references public.encounters (id, patient_id),
  foreign key (condition_id, patient_id) references public.conditions (id, patient_id)
);
create index care_plans_patient_idx on public.care_plans (patient_id, status);

create table public.clinical_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  encounter_id uuid,
  kind text not null default 'progress' check (kind in ('progress', 'consult', 'nursing', 'patient_note', 'other')),
  title text,
  body text not null check (length(btrim(body)) >= 1),
  author_name text,
  noted_at timestamptz not null default now(),
  unique (id, patient_id),
  foreign key (encounter_id, patient_id) references public.encounters (id, patient_id)
);
create index clinical_notes_patient_idx on public.clinical_notes (patient_id, noted_at desc);

-- ---------------------------------------------------------------- specialty-specific structured records
-- Shared envelope + a jsonb payload whose shape is declared by public.specialty_record_types.fields,
-- so a new specialty form needs a catalog row, not a schema change.
create table public.specialty_record_types (
  id uuid primary key default gen_random_uuid(),
  specialty_id uuid not null references public.medical_specialties (id) on delete cascade,
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,50}$'),
  name_ar text not null,
  name_en text not null,
  -- [{ "key": "tooth", "type": "text|number|date|select|textarea", "label_ar": "", "label_en": "",
  --    "required": true, "unit": "mmHg", "options": [{"value":"x","label_ar":"","label_en":""}] }]
  fields jsonb not null check (jsonb_typeof(fields) = 'array'),
  sort int not null default 0,
  is_active boolean not null default true
);

create table public.specialty_records (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid not null references public.medical_specialties (id),
  record_type_id uuid not null references public.specialty_record_types (id),
  encounter_id uuid,
  occurred_on date not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  notes text,
  unique (id, patient_id),
  foreign key (encounter_id, patient_id) references public.encounters (id, patient_id)
);
create index specialty_records_idx on public.specialty_records (patient_id, specialty_id, occurred_on desc);

-- now that documents/reports exist
alter table public.medical_documents add column lab_report_id uuid;
alter table public.medical_documents add column imaging_id uuid;
alter table public.medical_documents
  add foreign key (lab_report_id, patient_id) references public.lab_reports (id, patient_id);
alter table public.medical_documents
  add foreign key (imaging_id, patient_id) references public.imaging_studies (id, patient_id);
