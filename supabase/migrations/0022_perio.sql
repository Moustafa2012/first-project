-- Phase D: the periodontal chart.
--
-- A periodontal exam is a draft until it is finalised; a final exam is not edited (it can only be marked entered in
-- error, with the reason). Each tooth carries six sites in a fixed order:
--   index 1..3 = distobuccal, buccal, mesiobuccal   (the buccal / labial side)
--   index 4..6 = distolingual, lingual, mesiolingual (the lingual / palatal side)
-- Per site: probing depth (pd, mm), gingival margin (gm, mm), bleeding on probing, plaque, suppuration.
--
-- Sign convention of the gingival margin (documented here and in the app):
--   gm = position of the gingival margin relative to the cemento-enamel junction (CEJ)
--   gm > 0 : the margin is coronal to the CEJ (enlargement / overgrowth)
--   gm = 0 : the margin is at the CEJ (also assumed when it was not measured)
--   gm < 0 : the margin is apical to the CEJ (recession of |gm| mm)
--   clinical attachment level  CAL = pd - gm   (computed by the database, never typed)
-- so 4 mm of probing with 2 mm of recession (gm = -2) is CAL 6, and a 5 mm pseudo-pocket with 2 mm of overgrowth (gm = +2) is CAL 3.

-- ---------------------------------------------------------------- helpers
create function app.perio_sites_ok(a smallint[], lo int, hi int) returns boolean
language sql immutable set search_path = '' as $$
  select a is null or (array_ndims(a) = 1 and array_length(a, 1) = 6 and array_lower(a, 1) = 1
                       and not exists (select 1 from unnest(a) v where v is not null and (v < lo or v > hi)))
$$;
create function app.perio_flags_ok(a boolean[]) returns boolean
language sql immutable set search_path = '' as $$
  select a is null or (array_ndims(a) = 1 and array_length(a, 1) = 6 and array_lower(a, 1) = 1)
$$;
-- CAL per site: pd - gm; a site without a probing depth has no CAL; an unmeasured margin counts as at the CEJ
create function app.perio_cal(pd smallint[], gm smallint[]) returns smallint[]
language sql immutable set search_path = '' as $$
  select case when pd is null then null else
    array(select case when pd[i] is null then null else (pd[i] - coalesce(gm[i], 0))::smallint end from generate_series(1, 6) i) end
$$;
grant execute on function app.perio_sites_ok(smallint[], int, int) to authenticated, service_role;
grant execute on function app.perio_flags_ok(boolean[]) to authenticated, service_role;
grant execute on function app.perio_cal(smallint[], smallint[]) to authenticated, service_role;

-- ---------------------------------------------------------------- exams
create table public.perio_exams (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  exam_date date not null,
  status text not null default 'draft' check (status in ('draft', 'final')),
  examiner_name text check (length(examiner_name) <= 200),
  facility_name text check (length(facility_name) <= 200),
  notes text check (length(notes) <= 4000),
  finalized_at timestamptz,
  finalized_by uuid references auth.users (id),
  unique (id, patient_id),
  check (status = 'draft' or finalized_at is not null)
);
create index perio_exams_patient_idx on public.perio_exams (patient_id, exam_date desc);

do $$
begin
  execute 'alter table public.perio_exams
    add column source text not null default ''self'' check (source in (''self'', ''clinic'', ''hospital'', ''laboratory'', ''device'', ''imported'', ''other'')),
    add column source_detail text check (source_detail is null or length(source_detail) <= 300),
    add column verification text not null default ''reported'' check (verification in (''reported'', ''confirmed'', ''verified'')),
    add column recorded_by uuid references auth.users (id) default auth.uid(),
    add column recorded_at timestamptz not null default now(),
    add column updated_at timestamptz not null default now(),
    add column updated_by uuid references auth.users (id),
    add column record_status text not null default ''active'' check (record_status in (''active'', ''entered_in_error'')),
    add column invalidated_reason text,
    add column invalidated_at timestamptz,
    add column invalidated_by uuid references auth.users (id),
    add constraint perio_exams_invalid_reason_chk check (record_status = ''active'' or length(btrim(coalesce(invalidated_reason, ''''))) > 0)';
end $$;
-- one open draft per file: a new chart resumes it
create unique index perio_exams_one_draft on public.perio_exams (patient_id) where status = 'draft' and record_status = 'active';

-- draft -> final once; a final exam only changes by being marked entered in error
create function app.perio_exam_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'final' then new.finalized_at := now(); new.finalized_by := auth.uid();
    else new.finalized_at := null; new.finalized_by := null; end if;
    return new;
  end if;
  if old.status = 'final' then
    if new.status <> 'final' or new.finalized_at is distinct from old.finalized_at or new.finalized_by is distinct from old.finalized_by
       or new.exam_date <> old.exam_date or new.examiner_name is distinct from old.examiner_name
       or new.facility_name is distinct from old.facility_name or new.notes is distinct from old.notes
       or new.specialty_id is distinct from old.specialty_id or new.source <> old.source or new.source_detail is distinct from old.source_detail then
      raise exception 'perio_final' using errcode = '42501', hint = 'A final periodontal exam is not edited; mark it entered in error and record a new one.';
    end if;
  elsif new.status = 'final' then
    new.finalized_at := now(); new.finalized_by := auth.uid();
  else
    new.finalized_at := null; new.finalized_by := null;
  end if;
  return new;
end $$;
create trigger perio_exams_guard before insert or update on public.perio_exams for each row execute function app.clinical_guard();
create trigger perio_exams_final_guard before insert or update on public.perio_exams for each row execute function app.perio_exam_guard();
create trigger perio_exams_audit after insert or update on public.perio_exams for each row execute function app.audit_row();

-- ---------------------------------------------------------------- teeth (six sites each)
create table public.perio_teeth (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  exam_id uuid not null,
  tooth smallint not null check (app.is_fdi_tooth(tooth)),
  missing boolean not null default false,
  implant boolean not null default false,
  mobility smallint check (mobility between 0 and 3),
  -- furcation grade (0..3) at each entrance: buccal, lingual/palatal, mesial, distal (molars and upper first premolars)
  furcation_b smallint check (furcation_b between 0 and 3),
  furcation_l smallint check (furcation_l between 0 and 3),
  furcation_m smallint check (furcation_m between 0 and 3),
  furcation_d smallint check (furcation_d between 0 and 3),
  pd smallint[] check (app.perio_sites_ok(pd, 0, 20)),
  gm smallint[] check (app.perio_sites_ok(gm, -15, 15)),
  bop boolean[] check (app.perio_flags_ok(bop)),
  plaque boolean[] check (app.perio_flags_ok(plaque)),
  suppuration boolean[] check (app.perio_flags_ok(suppuration)),
  cal smallint[] generated always as (app.perio_cal(pd, gm)) stored,
  note text check (length(note) <= 500),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) default auth.uid(),
  unique (exam_id, tooth),
  foreign key (exam_id, patient_id) references public.perio_exams (id, patient_id),
  -- a missing tooth has no measurements
  check (not missing or (pd is null and gm is null and bop is null and plaque is null and suppuration is null and mobility is null
                         and furcation_b is null and furcation_l is null and furcation_m is null and furcation_d is null)),
  -- no furcation on incisors and canines
  check (tooth % 10 > 3 or (furcation_b is null and furcation_l is null and furcation_m is null and furcation_d is null))
);
create index perio_teeth_patient_idx on public.perio_teeth (patient_id, tooth);

-- teeth follow their exam: written only while it is an active draft
create function app.perio_tooth_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e record;
begin
  if tg_op = 'UPDATE' and (new.exam_id <> old.exam_id or new.patient_id <> old.patient_id or new.tooth <> old.tooth) then
    raise exception 'immutable fields cannot be changed' using errcode = '42501';
  end if;
  select x.status, x.record_status into e from public.perio_exams x where x.id = new.exam_id and x.patient_id = new.patient_id;
  if not found then return new; end if;   -- the foreign key reports it
  if e.record_status <> 'active' then raise exception 'the exam was marked entered in error' using errcode = '22023'; end if;
  if e.status = 'final' then
    raise exception 'perio_final' using errcode = '42501', hint = 'A final periodontal exam is not edited; mark it entered in error and record a new one.';
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
create trigger perio_teeth_guard before insert or update on public.perio_teeth for each row execute function app.perio_tooth_guard();
create trigger perio_teeth_audit after insert or update on public.perio_teeth for each row execute function app.audit_row();

-- ---------------------------------------------------------------- access
do $$
declare t text;
begin
  foreach t in array array['perio_exams', 'perio_teeth'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app.has_patient_access(patient_id))', t || '_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.has_patient_access(patient_id, ''write''))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.has_patient_access(patient_id, ''write'')) with check (app.has_patient_access(patient_id, ''write''))', t || '_upd', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- saving a chart in one step
-- Creates the draft (or updates the open one), writes the teeth sent, and optionally finalises it. Runs with the
-- caller's rights: RLS and the guards above apply. Teeth not sent are left as they are.
create function public.perio_exam_save(p_patient uuid, p_exam_id uuid, p_exam jsonb, p_teeth jsonb, p_finalize boolean default false)
returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid := p_exam_id; v_date date; x jsonb; v_n int;
begin
  if not app.has_patient_access(p_patient, 'write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_exam, 'null')) <> 'object' or jsonb_typeof(coalesce(p_teeth, '[]')) <> 'array'
     or jsonb_array_length(coalesce(p_teeth, '[]')) > 60 then
    raise exception 'invalid exam' using errcode = '22023';
  end if;
  v_date := (p_exam ->> 'exam_date')::date;
  if v_date is null or v_date > current_date + 1 then raise exception 'exam_date_invalid' using errcode = '22023'; end if;

  if v_id is null then
    insert into public.perio_exams (patient_id, specialty_id, exam_date, examiner_name, facility_name, notes, source, source_detail)
    values (p_patient, (select id from public.medical_specialties where code = 'dentistry'), v_date,
            nullif(btrim(p_exam ->> 'examiner_name'), ''), nullif(btrim(p_exam ->> 'facility_name'), ''), nullif(btrim(p_exam ->> 'notes'), ''),
            coalesce(nullif(p_exam ->> 'source', ''), 'self'), nullif(btrim(p_exam ->> 'source_detail'), ''))
    returning id into v_id;
  else
    update public.perio_exams set exam_date = v_date, examiner_name = nullif(btrim(p_exam ->> 'examiner_name'), ''),
           facility_name = nullif(btrim(p_exam ->> 'facility_name'), ''), notes = nullif(btrim(p_exam ->> 'notes'), ''),
           source = coalesce(nullif(p_exam ->> 'source', ''), 'self'), source_detail = nullif(btrim(p_exam ->> 'source_detail'), '')
     where id = v_id and patient_id = p_patient and record_status = 'active';
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;

  for x in select * from jsonb_array_elements(coalesce(p_teeth, '[]')) loop
    insert into public.perio_teeth as t (patient_id, exam_id, tooth, missing, implant, mobility, furcation_b, furcation_l, furcation_m, furcation_d,
                                         pd, gm, bop, plaque, suppuration, note)
    values (p_patient, v_id, (x ->> 'tooth')::smallint, coalesce((x ->> 'missing')::boolean, false), coalesce((x ->> 'implant')::boolean, false),
            (x ->> 'mobility')::smallint, (x ->> 'furcation_b')::smallint, (x ->> 'furcation_l')::smallint,
            (x ->> 'furcation_m')::smallint, (x ->> 'furcation_d')::smallint,
            case when jsonb_typeof(x -> 'pd') = 'array' then array(select (v #>> '{}')::smallint from jsonb_array_elements(x -> 'pd') v) end,
            case when jsonb_typeof(x -> 'gm') = 'array' then array(select (v #>> '{}')::smallint from jsonb_array_elements(x -> 'gm') v) end,
            case when jsonb_typeof(x -> 'bop') = 'array' then array(select (v #>> '{}')::boolean from jsonb_array_elements(x -> 'bop') v) end,
            case when jsonb_typeof(x -> 'plaque') = 'array' then array(select (v #>> '{}')::boolean from jsonb_array_elements(x -> 'plaque') v) end,
            case when jsonb_typeof(x -> 'suppuration') = 'array' then array(select (v #>> '{}')::boolean from jsonb_array_elements(x -> 'suppuration') v) end,
            nullif(btrim(x ->> 'note'), ''))
    on conflict (exam_id, tooth) do update set missing = excluded.missing, implant = excluded.implant, mobility = excluded.mobility,
           furcation_b = excluded.furcation_b, furcation_l = excluded.furcation_l, furcation_m = excluded.furcation_m, furcation_d = excluded.furcation_d,
           pd = excluded.pd, gm = excluded.gm, bop = excluded.bop, plaque = excluded.plaque, suppuration = excluded.suppuration, note = excluded.note
     where (t.missing, t.implant, t.mobility, t.furcation_b, t.furcation_l, t.furcation_m, t.furcation_d, t.pd, t.gm, t.bop, t.plaque, t.suppuration, t.note)
           is distinct from (excluded.missing, excluded.implant, excluded.mobility, excluded.furcation_b, excluded.furcation_l, excluded.furcation_m,
                             excluded.furcation_d, excluded.pd, excluded.gm, excluded.bop, excluded.plaque, excluded.suppuration, excluded.note);
  end loop;

  if p_finalize then
    select count(*) into v_n from public.perio_teeth where exam_id = v_id and (missing or pd is not null);
    if v_n = 0 then raise exception 'exam_empty' using errcode = '22023'; end if;
    update public.perio_exams set status = 'final' where id = v_id and status = 'draft';
  end if;
  return v_id;
end $$;
revoke all on function public.perio_exam_save(uuid, uuid, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.perio_exam_save(uuid, uuid, jsonb, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------- a final exam advances the periodontal maintenance recall
create function app.recall_from_perio() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'final' and new.record_status = 'active' and (tg_op = 'INSERT' or old.status <> 'final') then
    perform app.recall_advance(new.patient_id, array['perio_maintenance'], new.exam_date);
  end if;
  return null;
end $$;
create trigger perio_exams_recall after insert or update of status on public.perio_exams for each row execute function app.recall_from_perio();
