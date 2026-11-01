-- 0027: prescriptions, consents with a drawn signature, safety alerts as reviewable rules.
--
-- 1. A prescription groups several medication lines (dose, frequency, quantity, duration, refills). Writing one writes the
--    medications (active, starting on the day of issue, ending when the course ends) in one call. A clinician writes one
--    through a share link that allows it, as the doctor the patient named on the link.
-- 2. A consent is the patient's (or guardian's) signed agreement, with the drawn signature kept as an image in the private
--    bucket. It is never edited and never deleted: it can be withdrawn with a reason, or superseded by a new version.
--    A doctor presents it through a share; the patient signs on the doctor's screen.
-- 3. Safety alerts are data, not code: rules an administrator reviews, activates and edits. The application matches them
--    against the record and the planned treatment and shows the reason; they remind, they never decide.

-- ============================================================================================================ 1. prescriptions
create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  encounter_id uuid,
  prescriber_name text not null check (length(btrim(prescriber_name)) between 2 and 200),
  prescriber_license text check (length(prescriber_license) <= 60),
  facility_name text check (length(facility_name) <= 200),
  issued_on date not null default current_date,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  status_reason text check (length(status_reason) <= 500),
  notes text check (length(notes) <= 2000),
  unique (id, patient_id),
  foreign key (encounter_id, patient_id) references public.encounters (id, patient_id),
  check (status <> 'cancelled' or length(btrim(coalesce(status_reason, ''))) > 0)
);
create index prescriptions_patient_idx on public.prescriptions (patient_id, issued_on desc);
create index prescriptions_encounter_idx on public.prescriptions (encounter_id) where encounter_id is not null;

-- the missing per-item detail of a medication, and the prescription it belongs to
alter table public.medications
  add column prescription_id uuid,
  add column quantity text check (length(quantity) <= 60),
  add column duration_days int check (duration_days between 1 and 3650),
  add column refills int check (refills between 0 and 24),
  add constraint medications_prescription_fkey foreign key (prescription_id, patient_id) references public.prescriptions (id, patient_id);
create index medications_prescription_idx on public.medications (prescription_id) where prescription_id is not null;

-- ============================================================================================================ 2. consents
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  kind text not null check (kind in ('treatment', 'surgery', 'anesthesia', 'imaging', 'sedation', 'other')),
  title text not null check (length(btrim(title)) between 2 and 200),
  version int not null default 1 check (version between 1 and 200),
  -- the text as it was shown and signed (a snapshot: later changes to a template never touch it)
  body text not null check (length(btrim(body)) between 3 and 20000),
  treatment_plan_id uuid,
  treatment_item_id uuid,
  signer_name text not null check (length(btrim(signer_name)) between 2 and 200),
  signer_role text not null check (signer_role in ('patient', 'guardian', 'representative')),
  -- the drawn signature: a PNG in the private bucket, in the patient's own folder
  signature_path text not null,
  signed_at timestamptz not null default now(),
  witness_name text check (length(witness_name) <= 200),
  presented_by text check (length(presented_by) <= 200),
  status text not null default 'signed' check (status in ('signed', 'withdrawn', 'superseded')),
  withdrawn_at timestamptz,
  withdrawn_reason text check (length(withdrawn_reason) <= 500),
  withdrawn_by uuid references auth.users (id),
  supersedes uuid,                         -- the earlier version this one replaces
  superseded_by uuid,                      -- set on the earlier version when a new one is signed
  superseded_at timestamptz,
  unique (id, patient_id),
  foreign key (treatment_plan_id, patient_id) references public.treatment_plans (id, patient_id),
  foreign key (treatment_item_id, patient_id) references public.treatment_items (id, patient_id),
  foreign key (supersedes, patient_id) references public.consents (id, patient_id),
  foreign key (superseded_by, patient_id) references public.consents (id, patient_id),
  check (signature_path like patient_id::text || '/signatures/%.png'),
  check (status <> 'withdrawn' or (withdrawn_at is not null and length(btrim(coalesce(withdrawn_reason, ''))) >= 3)),
  check (status <> 'superseded' or (superseded_by is not null and superseded_at is not null)),
  check (supersedes is null or supersedes <> id)
);
create index consents_patient_idx on public.consents (patient_id, signed_at desc);
create index consents_plan_idx on public.consents (treatment_plan_id) where treatment_plan_id is not null;
create index consents_item_idx on public.consents (treatment_item_id) where treatment_item_id is not null;
create unique index consents_supersedes_idx on public.consents (supersedes) where supersedes is not null;

-- provenance + lifecycle as on the other clinical tables, the clinician link, guards, audit and access
do $$
declare t text;
begin
  foreach t in array array['prescriptions', 'consents'] loop
    execute format('alter table public.%I
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
      add column contributed_by uuid,
      add constraint %I check (record_status = ''active'' or length(btrim(coalesce(invalidated_reason, ''''))) > 0),
      add constraint %I foreign key (contributed_by, patient_id) references public.share_contributors (id, patient_id)',
      t, t || '_invalid_reason_chk', t || '_contributed_by_fkey');
    execute format('create index %I on public.%I (contributed_by) where contributed_by is not null', t || '_contributed_idx', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.clinical_guard()', t || '_guard', t);
    execute format('create trigger %I after insert or update on public.%I for each row execute function app.audit_row()', t || '_audit', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app.has_patient_access(patient_id))', t || '_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.has_patient_access(patient_id, ''write''))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.has_patient_access(patient_id, ''write'')) with check (app.has_patient_access(patient_id, ''write''))', t || '_upd', t);
    -- no delete policy and no delete grant: a prescription or a consent is never deleted
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
-- a clinician's prescription stays theirs: the patient can complete or cancel it, or mark it entered in error, not rewrite it
create trigger prescriptions_contrib_guard before insert or update on public.prescriptions
  for each row execute function app.contribution_guard('status', 'status_reason');
create trigger consents_contrib_guard before insert or update on public.consents
  for each row execute function app.contribution_guard('status', 'withdrawn_at', 'withdrawn_reason', 'withdrawn_by', 'superseded_by', 'superseded_at');

-- ---------------------------------------------------------------- prescription life cycle
create function app.prescription_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'active' then raise exception 'a new prescription starts active' using errcode = '22023'; end if;
    if new.issued_on > current_date + 1 then raise exception 'date_in_future' using errcode = '22023'; end if;
    return new;
  end if;
  -- who wrote it, for whom and when are fixed; only the notes, the clinic and the visit link can be corrected while it is open
  if new.issued_on <> old.issued_on or new.prescriber_name <> old.prescriber_name or new.prescriber_license is distinct from old.prescriber_license
     or new.specialty_id is distinct from old.specialty_id then
    raise exception 'immutable fields cannot be changed' using errcode = '42501';
  end if;
  if new.status <> old.status then
    if old.status <> 'active' then raise exception 'invalid_transition' using errcode = '22023', detail = old.status || ' → ' || new.status; end if;
  elsif old.status <> 'active' and new.record_status = old.record_status
        and (new.notes is distinct from old.notes or new.facility_name is distinct from old.facility_name or new.encounter_id is distinct from old.encounter_id) then
    raise exception 'prescription_closed' using errcode = '22023', hint = 'A completed or cancelled prescription is not edited.';
  end if;
  return new;
end $$;
create trigger prescriptions_lifecycle before insert or update on public.prescriptions for each row execute function app.prescription_guard();

-- its medication lines follow it: completed → completed, cancelled → stopped, entered in error → entered in error
create function app.prescription_cascade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.record_status = 'entered_in_error' and old.record_status = 'active' then
    update public.medications set record_status = 'entered_in_error',
           invalidated_reason = left('أُبطلت مع الوصفة / invalidated with the prescription: ' || coalesce(new.invalidated_reason, ''), 500)
     where prescription_id = new.id and record_status = 'active';
  elsif new.status <> old.status and new.status = 'completed' then
    perform set_config('app.status_reason', 'اكتملت الوصفة / the prescription was completed', true);
    update public.medications set status = 'completed', stopped_by = 'course_completed',
           end_date = greatest(coalesce(start_date, current_date), least(coalesce(end_date, current_date), current_date))
     where prescription_id = new.id and record_status = 'active' and status in ('active', 'on_hold');
  elsif new.status <> old.status and new.status = 'cancelled' then
    perform set_config('app.status_reason', left('أُلغيت الوصفة / the prescription was cancelled: ' || coalesce(new.status_reason, ''), 500), true);
    update public.medications set status = 'stopped', stopped_by = 'clinician', stop_reason = left(coalesce(new.status_reason, 'prescription cancelled'), 500),
           end_date = greatest(coalesce(start_date, current_date), least(coalesce(end_date, current_date), current_date))
     where prescription_id = new.id and record_status = 'active' and status in ('active', 'on_hold');
  end if;
  return null;
end $$;
create trigger prescriptions_cascade after update on public.prescriptions for each row execute function app.prescription_cascade();

-- a line belongs to one open prescription for good
create function app.medication_rx_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.prescription_id is not null and not exists (
         select 1 from public.prescriptions p where p.id = new.prescription_id and p.patient_id = new.patient_id
            and p.status = 'active' and p.record_status = 'active') then
      raise exception 'prescription_closed' using errcode = '22023', hint = 'Lines are added to an open prescription.';
    end if;
    return new;
  end if;
  if new.prescription_id is distinct from old.prescription_id then raise exception 'immutable fields cannot be changed' using errcode = '42501'; end if;
  return new;
end $$;
create trigger medications_rx_guard before insert or update on public.medications for each row execute function app.medication_rx_guard();

-- ---------------------------------------------------------------- writing a prescription (caller's rights)
-- From an account RLS and the guards apply; from the share function below it writes for the clinician.
create function app.prescription_write(p_patient uuid, p_rx jsonb, p_lines jsonb, p_contributor uuid default null, p_source_detail text default null)
returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid; x jsonb; n int := 0;
  v_issued date := coalesce(nullif(p_rx ->> 'issued_on', '')::date, current_date);
  v_spec uuid := nullif(p_rx ->> 'specialty_id', '')::uuid;
  v_enc uuid := nullif(p_rx ->> 'encounter_id', '')::uuid;
  v_src text := case when p_contributor is null then 'self' else 'clinic' end;
  v_ver text := case when p_contributor is null then 'reported' else 'confirmed' end;
  v_name text := left(btrim(coalesce(p_rx ->> 'prescriber_name', '')), 200);
  v_dur int; v_g text; v_b text;
begin
  if jsonb_typeof(coalesce(p_rx, 'null')) <> 'object' or jsonb_typeof(coalesce(p_lines, 'null')) <> 'array' then
    raise exception 'invalid prescription' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) = 0 then raise exception 'prescription_needs_lines' using errcode = '22023'; end if;
  if jsonb_array_length(p_lines) > 20 then raise exception 'prescription_too_long' using errcode = '22023'; end if;
  if length(v_name) < 2 then raise exception 'prescriber_required' using errcode = '22023'; end if;
  insert into public.prescriptions (patient_id, specialty_id, encounter_id, prescriber_name, prescriber_license, facility_name, issued_on, notes,
                                    source, source_detail, verification, contributed_by)
  values (p_patient, v_spec, v_enc, v_name, nullif(left(btrim(coalesce(p_rx ->> 'prescriber_license', '')), 60), ''),
          nullif(left(btrim(coalesce(p_rx ->> 'facility_name', '')), 200), ''), v_issued, nullif(left(btrim(coalesce(p_rx ->> 'notes', '')), 2000), ''),
          v_src, p_source_detail, v_ver, p_contributor)
  returning id into v_id;
  for x in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    v_g := nullif(left(btrim(coalesce(x ->> 'name_generic', '')), 200), '');
    v_b := nullif(left(btrim(coalesce(x ->> 'name_brand', '')), 200), '');
    if v_g is null and v_b is null then raise exception 'medication_name_required' using errcode = '22023'; end if;
    v_dur := nullif(x ->> 'duration_days', '')::int;
    insert into public.medications (patient_id, specialty_id, encounter_id, prescription_id, name_generic, name_brand, strength, form, dose, route, frequency,
                                    as_needed, long_term, origin, status, start_date, end_date, indication, prescriber_name, instructions, quantity,
                                    duration_days, refills, source, source_detail, verification, contributed_by)
    values (p_patient, v_spec, v_enc, v_id, v_g, v_b, nullif(left(btrim(coalesce(x ->> 'strength', '')), 60), ''), nullif(left(btrim(coalesce(x ->> 'form', '')), 60), ''),
            nullif(left(btrim(coalesce(x ->> 'dose', '')), 100), ''), nullif(left(btrim(coalesce(x ->> 'route', '')), 60), ''),
            nullif(left(btrim(coalesce(x ->> 'frequency', '')), 100), ''), coalesce((x ->> 'as_needed')::boolean, false), coalesce((x ->> 'long_term')::boolean, false),
            'prescribed', 'active', v_issued, case when v_dur is not null then v_issued + (v_dur - 1) end,
            nullif(left(btrim(coalesce(x ->> 'indication', '')), 500), ''), v_name, nullif(left(btrim(coalesce(x ->> 'instructions', '')), 2000), ''),
            nullif(left(btrim(coalesce(x ->> 'quantity', '')), 60), ''), v_dur, nullif(x ->> 'refills', '')::int,
            v_src, p_source_detail, v_ver, p_contributor);
  end loop;
  return v_id;
end $$;
grant execute on function app.prescription_write(uuid, jsonb, jsonb, uuid, text) to authenticated, service_role;

create function public.prescription_create(p_patient uuid, p_rx jsonb, p_lines jsonb) returns uuid
language plpgsql set search_path = '' as $$
begin
  if not app.has_patient_access(p_patient, 'write') then raise exception 'forbidden' using errcode = '42501'; end if;
  return app.prescription_write(p_patient, p_rx, p_lines);
end $$;

-- completed (the course is over) or cancelled (with the reason); the lines follow
create function public.prescription_set_status(p_rx uuid, p_status text, p_reason text default null) returns void
language plpgsql set search_path = '' as $$
begin
  if p_status not in ('completed', 'cancelled') then raise exception 'invalid_transition' using errcode = '22023'; end if;
  perform 1 from public.prescriptions where id = p_rx and record_status = 'active' for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform set_config('app.status_reason', coalesce(btrim(p_reason), ''), true);
  perform set_config('app.status_date', current_date::text, true);
  update public.prescriptions set status = p_status, status_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), '') where id = p_rx;
end $$;

revoke all on function public.prescription_create(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.prescription_set_status(uuid, text, text) from public, anon;
grant execute on function public.prescription_create(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.prescription_set_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- consent life cycle
create function app.consent_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o public.consents;
  v_keep text[] := array['status', 'withdrawn_at', 'withdrawn_reason', 'withdrawn_by', 'superseded_by', 'superseded_at', 'record_status',
                         'invalidated_reason', 'invalidated_at', 'invalidated_by', 'updated_at', 'updated_by'];
  v_plan uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'signed' then raise exception 'a consent is recorded when it is signed' using errcode = '22023'; end if;
    new.signed_at := now();
    new.withdrawn_at := null; new.withdrawn_reason := null; new.withdrawn_by := null; new.superseded_by := null; new.superseded_at := null;
    if new.treatment_item_id is not null then
      select plan_id into v_plan from public.treatment_items where id = new.treatment_item_id and patient_id = new.patient_id;
      if new.treatment_plan_id is null then new.treatment_plan_id := v_plan;
      elsif v_plan is distinct from new.treatment_plan_id then raise exception 'consent_plan_mismatch' using errcode = '22023'; end if;
    end if;
    if new.supersedes is not null then
      select * into o from public.consents where id = new.supersedes and patient_id = new.patient_id for update;
      if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
      if o.status <> 'signed' or o.record_status <> 'active' then raise exception 'consent_not_signed' using errcode = '22023', hint = 'Only a signed consent is superseded.'; end if;
      if o.kind <> new.kind then raise exception 'consent_kind_mismatch' using errcode = '22023'; end if;
      new.version := o.version + 1;
      if new.treatment_plan_id is null and new.treatment_item_id is null then
        new.treatment_plan_id := o.treatment_plan_id; new.treatment_item_id := o.treatment_item_id;
      end if;
    else
      new.version := 1;
    end if;
    return new;
  end if;

  -- a signed consent is never rewritten: only its life cycle moves (withdrawn, superseded, or marked entered in error)
  if (to_jsonb(new) - v_keep) is distinct from (to_jsonb(old) - v_keep) then
    raise exception 'consent_signed' using errcode = '42501', hint = 'A signed consent is not edited; withdraw it or sign a new version.';
  end if;
  if new.status <> old.status then
    if old.status <> 'signed' then raise exception 'invalid_transition' using errcode = '22023', detail = old.status || ' → ' || new.status; end if;
    if new.status = 'withdrawn' then
      if length(btrim(coalesce(new.withdrawn_reason, ''))) < 3 then raise exception 'reason_required' using errcode = '22023'; end if;
      new.withdrawn_at := now(); new.withdrawn_by := auth.uid();
    elsif new.status = 'superseded' then
      if coalesce(current_setting('app.consent_superseding', true), '') <> 'on' then raise exception 'invalid_transition' using errcode = '22023'; end if;
    else
      raise exception 'invalid_transition' using errcode = '22023';
    end if;
  elsif (new.withdrawn_at, new.withdrawn_reason, new.withdrawn_by, new.superseded_by, new.superseded_at)
        is distinct from (old.withdrawn_at, old.withdrawn_reason, old.withdrawn_by, old.superseded_by, old.superseded_at) then
    raise exception 'consent_signed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger consents_lifecycle before insert or update on public.consents for each row execute function app.consent_guard();

-- signing a new version closes the one it replaces
create function app.consent_superseded() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.supersedes is not null then
    perform set_config('app.consent_superseding', 'on', true);
    update public.consents set status = 'superseded', superseded_by = new.id, superseded_at = now() where id = new.supersedes and patient_id = new.patient_id;
    perform set_config('app.consent_superseding', '', true);
  end if;
  return null;
end $$;
create trigger consents_superseded after insert on public.consents for each row execute function app.consent_superseded();

-- ---------------------------------------------------------------- writing a consent (caller's rights)
create function app.consent_write(p_patient uuid, p_consent jsonb, p_signature_path text, p_contributor uuid default null, p_source_detail text default null)
returns uuid
language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  if jsonb_typeof(coalesce(p_consent, 'null')) <> 'object' then raise exception 'invalid consent' using errcode = '22023'; end if;
  insert into public.consents (patient_id, specialty_id, kind, title, body, treatment_plan_id, treatment_item_id, signer_name, signer_role, signature_path,
                               witness_name, presented_by, supersedes, source, source_detail, verification, contributed_by)
  values (p_patient, nullif(p_consent ->> 'specialty_id', '')::uuid, p_consent ->> 'kind', btrim(coalesce(p_consent ->> 'title', '')),
          btrim(coalesce(p_consent ->> 'body', '')), nullif(p_consent ->> 'treatment_plan_id', '')::uuid, nullif(p_consent ->> 'treatment_item_id', '')::uuid,
          btrim(coalesce(p_consent ->> 'signer_name', '')), p_consent ->> 'signer_role', p_signature_path,
          nullif(left(btrim(coalesce(p_consent ->> 'witness_name', '')), 200), ''), nullif(left(btrim(coalesce(p_consent ->> 'presented_by', '')), 200), ''),
          nullif(p_consent ->> 'supersedes', '')::uuid,
          case when p_contributor is null then 'self' else 'clinic' end, p_source_detail,
          case when p_contributor is null then 'reported' else 'confirmed' end, p_contributor)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function app.consent_write(uuid, jsonb, text, uuid, text) to authenticated, service_role;

create function public.consent_create(p_patient uuid, p_consent jsonb, p_signature_path text) returns uuid
language plpgsql set search_path = '' as $$
begin
  if not app.has_patient_access(p_patient, 'write') then raise exception 'forbidden' using errcode = '42501'; end if;
  return app.consent_write(p_patient, p_consent, p_signature_path);
end $$;

create function public.consent_withdraw(p_consent uuid, p_reason text) returns void
language plpgsql set search_path = '' as $$
declare v_st text;
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required' using errcode = '22023'; end if;
  select status into v_st from public.consents where id = p_consent and record_status = 'active' for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_st <> 'signed' then raise exception 'invalid_transition' using errcode = '22023', detail = v_st || ' → withdrawn'; end if;
  update public.consents set status = 'withdrawn', withdrawn_reason = left(btrim(p_reason), 500) where id = p_consent;
end $$;

revoke all on function public.consent_create(uuid, jsonb, text) from public, anon;
revoke all on function public.consent_withdraw(uuid, text) from public, anon;
grant execute on function public.consent_create(uuid, jsonb, text) to authenticated;
grant execute on function public.consent_withdraw(uuid, text) to authenticated;

-- ============================================================================================================ 3. safety rules
-- The shape of a rule's "match": the record factors that raise it (any one is enough) and, optionally, what it is about
-- (planned procedures by category or catalogue code, or drugs being prescribed). Without a trigger it is a reminder about
-- the patient; with one it is shown only next to the treatment or drug it concerns.
create function app.safety_match_ok(m jsonb) returns boolean
language plpgsql immutable as $$
declare k text; e jsonb;
begin
  if jsonb_typeof(m) <> 'object' then return false; end if;
  for k in select jsonb_object_keys(m) loop
    if k not in ('conditions', 'medications', 'allergies', 'devices', 'pregnancy', 'labs', 'procedures', 'drugs') then return false; end if;
  end loop;
  if not (m ? 'conditions' or m ? 'medications' or m ? 'allergies' or m ? 'devices' or m ? 'pregnancy' or m ? 'labs') then return false; end if;
  foreach k in array array['conditions', 'medications', 'allergies', 'devices', 'drugs'] loop
    if m ? k then
      if jsonb_typeof(m -> k) <> 'array' or jsonb_array_length(m -> k) = 0 then return false; end if;
      for e in select * from jsonb_array_elements(m -> k) loop
        if jsonb_typeof(e) <> 'string' or length(e #>> '{}') not between 2 and 80 then return false; end if;
      end loop;
    end if;
  end loop;
  if m ? 'pregnancy' and jsonb_typeof(m -> 'pregnancy') <> 'boolean' then return false; end if;
  if m ? 'labs' then
    if jsonb_typeof(m -> 'labs') <> 'array' or jsonb_array_length(m -> 'labs') = 0 then return false; end if;
    for e in select * from jsonb_array_elements(m -> 'labs') loop
      if jsonb_typeof(e) <> 'object' or coalesce(jsonb_typeof(e -> 'code'), '') <> 'string' or not (e ? 'gte' or e ? 'gt' or e ? 'lte' or e ? 'lt') then return false; end if;
      foreach k in array array['gte', 'gt', 'lte', 'lt'] loop
        if e ? k and jsonb_typeof(e -> k) <> 'number' then return false; end if;
      end loop;
    end loop;
  end if;
  if m ? 'procedures' then
    if jsonb_typeof(m -> 'procedures') <> 'object' then return false; end if;
    for k in select jsonb_object_keys(m -> 'procedures') loop
      if k not in ('categories', 'codes') then return false; end if;
      if jsonb_typeof(m -> 'procedures' -> k) <> 'array' then return false; end if;
      for e in select * from jsonb_array_elements(m -> 'procedures' -> k) loop
        if jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[a-z][a-z0-9_]{1,40}$' then return false; end if;
      end loop;
    end loop;
  end if;
  return true;
end $$;

grant execute on function app.safety_match_ok(jsonb) to authenticated, service_role;

create table public.safety_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{2,60}$'),
  specialty_code text not null default 'dentistry' references public.medical_specialties (code) on update cascade,
  title_ar text not null check (length(btrim(title_ar)) between 3 and 120),
  title_en text not null check (length(btrim(title_en)) between 3 and 120),
  message_ar text not null check (length(btrim(message_ar)) between 3 and 700),
  message_en text not null check (length(btrim(message_en)) between 3 and 700),
  severity text not null default 'warn' check (severity in ('info', 'warn', 'danger')),
  match jsonb not null check (app.safety_match_ok(match)),
  reference text check (length(reference) <= 500),
  sort int not null default 0,
  is_active boolean not null default true,
  -- who looked at the rule and when; any change to what it says clears it and raises the version
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);
create index safety_rules_active_idx on public.safety_rules (specialty_code) where is_active;

create function app.safety_rule_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_changed boolean;
begin
  new.updated_at := now(); new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    new.version := 1; new.reviewed_by := null; new.reviewed_at := null;
    return new;
  end if;
  new.code := old.code;
  v_changed := (new.specialty_code, new.title_ar, new.title_en, new.message_ar, new.message_en, new.severity, new.match, new.reference)
               is distinct from (old.specialty_code, old.title_ar, old.title_en, old.message_ar, old.message_en, old.severity, old.match, old.reference);
  if v_changed then
    new.version := old.version + 1; new.reviewed_by := null; new.reviewed_at := null;
  elsif new.reviewed_by is null then
    new.reviewed_at := null;
  elsif new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at then
    new.reviewed_by := auth.uid(); new.reviewed_at := now();      -- the reviewer is whoever presses the button, not what the client says
  end if;
  return new;
end $$;
create trigger safety_rules_guard before insert or update on public.safety_rules for each row execute function app.safety_rule_guard();
create trigger safety_rules_audit after insert or update on public.safety_rules for each row execute function app.audit_row();

alter table public.safety_rules enable row level security;
create policy safety_rules_sel on public.safety_rules for select to authenticated using (true);
create policy safety_rules_admin_ins on public.safety_rules for insert to authenticated with check (app.is_admin());
create policy safety_rules_admin_upd on public.safety_rules for update to authenticated using (app.is_admin()) with check (app.is_admin());
grant select, insert, update on public.safety_rules to authenticated;
grant all on public.safety_rules to service_role;

-- Seed: dental rules for review. None is marked reviewed; the administrator reviews, edits and activates them.
insert into public.safety_rules (code, title_ar, title_en, message_ar, message_en, severity, match, reference, sort)
select v.code, v.tar, v.ten, v.mar, v.men, v.sev, v.m::jsonb, v.ref, v.srt
  from (values
  ('anticoagulant_before_surgery', 'مضاد تخثر أو صفيحات قبل الجراحة', 'Anticoagulant or antiplatelet before surgery',
   'يتناول مضاد تخثر أو مضاد صفيحات: خطر نزف عند الخلع والجراحة. راجع الطبيب المعالج وافحص زمن التخثر (INR) عند الحاجة، ولا يوقف المريض الدواء من تلقاء نفسه.',
   'Takes an anticoagulant or antiplatelet: bleeding risk with extractions and surgery. Check with the treating physician and the INR where relevant; the patient must not stop the medicine on their own.',
   'danger',
   $j${"medications":["warfarin","وارفارين","coumadin","apixaban","أبيكسابان","eliquis","rivaroxaban","ريفاروكسابان","xarelto","dabigatran","دابيغاتران","edoxaban","clopidogrel","كلوبيدوجريل","plavix","ticagrelor","prasugrel","aspirin","أسبرين","اسبرين","heparin","هيبارين","enoxaparin","إينوكسابارين","clexane"],
      "procedures":{"categories":["surgical","implant"],"codes":["gum_graft","gingivectomy","crown_lengthening","root_planing"]}}$j$,
   'Pending clinical review. Local haemostasis and the physician''s advice decide; see the dental guidance on anticoagulants.', 10),
  ('antiresorptive_mronj', 'مضاد استرجاع العظم وخطر تنخر الفك', 'Antiresorptive and risk of jaw osteonecrosis',
   'يتناول بايفوسفونات أو دينوسوماب: خطر تنخّر عظم الفك المرتبط بالدواء (MRONJ) بعد الخلع والزرع. قيّم الخطر مع الطبيب المعالج قبل الجراحة.',
   'Takes a bisphosphonate or denosumab: risk of medication-related osteonecrosis of the jaw (MRONJ) after extraction or implant surgery. Assess the risk with the treating physician before surgery.',
   'danger',
   $j${"medications":["alendron","ألندرون","fosamax","risedron","ريزدرون","actonel","ibandron","إيباندرون","boniva","zoledron","زوليدرون","zometa","aclasta","pamidron","denosumab","دينوسوماب","prolia","xgeva"],
      "procedures":{"categories":["surgical","implant"]}}$j$,
   'Pending clinical review. See the oral and maxillofacial surgeons'' position paper on MRONJ.', 20),
  ('endocarditis_prophylaxis_review', 'مراجعة الوقاية من التهاب الشغاف', 'Review of endocarditis prophylaxis',
   'مرض قلبي أو صمامي مسجّل: راجع مع طبيب القلب هل تلزم وقاية بمضاد حيوي قبل الإجراءات التي تمسّ اللثة أو ذروة الجذر أو الغشاء المخاطي (مثل الخلع).',
   'A heart or valve condition is recorded: review with the cardiologist whether antibiotic prophylaxis is needed before procedures that manipulate the gums, the root apex or the oral mucosa (for example extraction).',
   'warn',
   $j${"conditions":["prosthetic valve","artificial valve","valve replacement","mechanical valve","صمام صناعي","استبدال صمام","صمام ميكانيكي","infective endocarditis","endocarditis","التهاب الشغاف","congenital heart","cyanotic","قلب خلقي","عيب قلبي خلقي","aortic stenosis","coarctation","تضيق الابهر","تضيق خلقي","الشريان الابهر","rheumatic heart","روماتيزم القلب","valve disease","مرض صمامي"],
      "devices":["prosthetic_heart_valve"],
      "procedures":{"categories":["surgical","implant"],"codes":["scaling","root_planing","gum_graft","gingivectomy","crown_lengthening"]}}$j$,
   'Pending clinical review. Current guidance limits routine prophylaxis to the highest-risk groups; the decision belongs to the cardiologist.', 30),
  ('pregnancy_imaging_drugs', 'الحمل: الأشعة والأدوية', 'Pregnancy: imaging and drugs',
   'حامل: راجع الحاجة للأشعة (مع وسائل الحماية) واختيار الأدوية (مضادات حيوية ومسكنات) مع طبيب التوليد.',
   'Pregnant: review the need for X-rays (with protection) and the choice of drugs (antibiotics, analgesics) with the obstetrician.',
   'warn',
   $j${"pregnancy":true,"procedures":{"codes":["xray_periapical","xray_bitewing","xray_panoramic","cbct"]},
      "drugs":["tetracycline","doxycycline","minocycline","ibuprofen","diclofenac","naproxen","ketorolac","codeine","tramadol","تتراسيكلين","دوكسيسيكلين","ايبوبروفين","ديكلوفيناك"]}$j$,
   'Pending clinical review.', 40),
  ('diabetes_healing', 'السكري: التئام وعدوى', 'Diabetes: healing and infection',
   'سكري: التئام أبطأ وخطر عدوى أعلى بعد الجراحة وعلاج اللثة؛ تحقق من ضبط السكر قبل الإجراءات الاختيارية.',
   'Diabetes: slower healing and a higher infection risk after surgery and periodontal treatment; check glucose control before elective procedures.',
   'info',
   $j${"conditions":["diabet","سكري","السكري","insulin dependent"],
      "procedures":{"categories":["surgical","implant","periodontal"]}}$j$,
   'Pending clinical review.', 50),
  ('diabetes_uncontrolled', 'سكري غير منضبط (HbA1c)', 'Uncontrolled diabetes (HbA1c)',
   'السكر التراكمي مرتفع (HbA1c 8% أو أكثر): أجّل الجراحة الاختيارية والزرع حتى يُضبط السكر، وراجع الطبيب المعالج.',
   'HbA1c is high (8% or more): defer elective surgery and implants until glucose is controlled, and check with the treating physician.',
   'danger',
   $j${"labs":[{"code":"hba1c","gte":8}],
      "procedures":{"categories":["surgical","implant"],"codes":["gum_graft","gingivectomy","crown_lengthening"]}}$j$,
   'Pending clinical review. The threshold is a prompt, not a rule: edit it to the practice''s own.', 51),
  ('penicillin_allergy', 'حساسية البنسلين', 'Penicillin allergy',
   'حساسية البنسلين موثقة: اختر مضاداً حيوياً بديلاً عند الوصف.',
   'A penicillin allergy is recorded: choose an alternative antibiotic when prescribing.',
   'warn',
   $j${"allergies":["penicillin","بنسلين","البنسلين","amoxicillin","اموكسيسيلين","أموكسيسيلين","augmentin","اوجمنتين","ampicillin","cloxacillin","flucloxacillin"]}$j$,
   'Pending clinical review.', 60),
  ('penicillin_allergy_prescribed', 'وصفة من عائلة البنسلين مع حساسية موثقة', 'Penicillin-family drug prescribed despite a recorded allergy',
   'وُصف دواء من عائلة البنسلين والملف يسجّل حساسية منه: راجع الوصفة قبل الصرف.',
   'A penicillin-family drug is prescribed while a penicillin allergy is recorded: review the prescription before it is dispensed.',
   'danger',
   $j${"allergies":["penicillin","بنسلين","البنسلين","amoxicillin","اموكسيسيلين","أموكسيسيلين","augmentin","اوجمنتين","ampicillin","cloxacillin","flucloxacillin"],
      "drugs":["amoxicillin","amoxil","augmentin","penicillin","ampicillin","cloxacillin","flucloxacillin","اموكسيسيلين","أموكسيسيلين","أوجمنتين","اوجمنتين","بنسلين","amoclan","curam"]}$j$,
   'Pending clinical review.', 61),
  ('local_anesthetic_allergy', 'حساسية المخدر الموضعي', 'Local anaesthetic allergy',
   'حساسية من مخدر موضعي: راجع نوع المخدر قبل الحقن.',
   'A local anaesthetic allergy is recorded: check the anaesthetic before injecting.',
   'danger',
   $j${"allergies":["lidocaine","lignocaine","ليدوكائين","articaine","ارتيكائين","أرتيكائين","mepivacaine","ميبيفاكائين","bupivacaine","prilocaine","procaine","novocaine","local anesthetic","local anaesthetic","مخدر موضعي","بنج موضعي","بنج"]}$j$,
   'Pending clinical review.', 70),
  ('latex_allergy', 'حساسية اللاتكس', 'Latex allergy',
   'حساسية اللاتكس: استخدم قفازات وأدوات خالية منه.',
   'A latex allergy is recorded: use latex-free gloves and materials.',
   'warn',
   $j${"allergies":["latex","لاتكس","مطاط"]}$j$,
   'Pending clinical review.', 71),
  ('head_neck_radiotherapy', 'العلاج الإشعاعي للرأس والعنق', 'Head and neck radiotherapy',
   'علاج إشعاعي سابق للرأس والعنق: خطر تنخّر العظم الإشعاعي بعد الخلع والجراحة. استشر أخصائي الأورام وجراح الفم قبل الخلع.',
   'Previous head and neck radiotherapy: risk of osteoradionecrosis after extraction and surgery. Consult the oncologist and an oral surgeon before extractions.',
   'danger',
   $j${"conditions":["radiotherapy","radiation therapy","head and neck cancer","oral cancer","tongue cancer","jaw radiation","علاج اشعاعي","علاج إشعاعي","اشعة علاجية","سرطان الفم","سرطان اللسان","سرطان الحنجرة","سرطان الرأس والعنق"],
      "procedures":{"categories":["surgical","implant"]}}$j$,
   'Pending clinical review.', 80),
  ('immunosuppression', 'كبت المناعة', 'Immunosuppression',
   'كبت مناعي (دواء أو مرض): خطر عدوى وبطء التئام؛ راجع الطبيب المعالج قبل الجراحة وعلاج اللثة.',
   'Immunosuppression (a drug or a condition): infection risk and slower healing; check with the treating physician before surgery and periodontal treatment.',
   'warn',
   $j${"medications":["prednisolone","prednisone","بريدنيزولون","methotrexate","ميثوتريكسات","azathioprine","cyclosporine","tacrolimus","mycophenolate","infliximab","adalimumab","etanercept","rituximab","chemotherapy","كيماوي"],
      "conditions":["hiv","aids","ايدز","transplant","زراعة عضو","leukemia","ابيضاض","lymphoma","لمفوما","immunodeficiency","نقص مناعة","chemotherapy","كيماوي"],
      "procedures":{"categories":["surgical","implant","periodontal"]}}$j$,
   'Pending clinical review.', 90),
  ('bleeding_disorder', 'اضطراب النزف', 'Bleeding disorder',
   'اضطراب نزف أو تخثر مسجّل: خطر نزف في الإجراءات الجراحية؛ نسّق مع طبيب الدم قبل الإجراء.',
   'A bleeding or clotting disorder is recorded: bleeding risk with surgical procedures; coordinate with the haematologist before the procedure.',
   'danger',
   $j${"conditions":["hemophilia","haemophilia","هيموفيليا","ناعور","von willebrand","فون ويلبراند","thrombocytopenia","نقص الصفيحات","bleeding disorder","اضطراب نزف","coagulopathy","خلل تخثر"],
      "procedures":{"categories":["surgical","implant"],"codes":["root_planing","gum_graft","gingivectomy","crown_lengthening"]}}$j$,
   'Pending clinical review.', 100),
  ('cardiac_epinephrine', 'مرض القلب والأدرينالين في المخدر', 'Cardiac disease and epinephrine in the anaesthetic',
   'مرض قلبي أو دواء حاصر بيتا غير انتقائي: قلّل الأدرينالين في المخدر الموضعي لأقل جرعة فعّالة واسحب المكبس قبل الحقن، وراجع الطبيب المعالج عند عدم استقرار الحالة.',
   'A cardiac condition or a non-selective beta-blocker: keep the epinephrine in the local anaesthetic to the lowest effective dose, aspirate before injecting, and check with the physician if the condition is unstable.',
   'warn',
   $j${"conditions":["myocardial infarction","heart attack","angina","ischemic heart","coronary","arrhythmia","atrial fibrillation","heart failure","جلطة قلبية","ذبحة","قصور القلب","اضطراب نظم","عدم انتظام","رجفان","شريان تاجي"],
      "medications":["propranolol","nadolol","بروبرانولول"],
      "devices":["coronary_stent"]}$j$,
   'Pending clinical review.', 110)
  ) v(code, tar, ten, mar, men, sev, m, ref, srt);

-- ============================================================================================================ 4. the share link
-- the clinician may write prescriptions and present consents when the patient allows it (0020's list, plus the periodontal
-- chart added by 0026, plus these two)
alter table public.medical_shares drop constraint if exists medical_shares_contribute_modules_check;
alter table public.medical_shares add constraint medical_shares_contribute_modules_check
  check (contribute_modules <@ array['encounters', 'conditions', 'procedures', 'clinical_notes', 'medications', 'appointments',
                                     'test_orders', 'imaging_studies', 'medical_documents', 'dental_exams', 'treatment_plans',
                                     'perio_exams', 'prescriptions', 'consents']::text[]);

-- the doctor writes a prescription (it counts as one addition); the prescriber is the doctor the patient named on the link
create function public.share_prescription_create(p_session_token text, p_rx jsonb, p_lines jsonb, p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_used int; v_ctr public.share_contributors; v_id uuid; v_spec uuid; v_rx jsonb; v_enc uuid; v_name text;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  if not ('prescriptions' = any ((c.o_share).contribute_modules)) then return jsonb_build_object('status', 'forbidden'); end if;
  select coalesce(sum(contribution_count), 0) into v_used from public.share_contributors where share_id = (c.o_share).id;
  if v_used >= (c.o_share).max_contributions then return jsonb_build_object('status', 'limit'); end if;
  if jsonb_typeof(coalesce(p_rx, 'null')) <> 'object' or jsonb_typeof(coalesce(p_lines, 'null')) <> 'array' then return jsonb_build_object('status', 'invalid'); end if;
  select * into v_ctr from public.share_contributors where id = c.o_contributor;
  -- a specialty share writes into that specialty only
  v_spec := nullif(p_rx ->> 'specialty_id', '')::uuid;
  if (c.o_share).scope_kind = 'specialty' and (v_spec is null or not (v_spec = any ((c.o_share).specialty_ids))) then
    v_spec := ((c.o_share).specialty_ids)[1];
  elsif (c.o_share).scope_kind <> 'specialty' and not exists (select 1 from public.medical_specialties m where m.id = v_spec) then
    v_spec := null;
  end if;
  -- a link to a visit only to one this clinician added through this share
  v_enc := nullif(p_rx ->> 'encounter_id', '')::uuid;
  if v_enc is not null and not exists (select 1 from public.encounters e join public.share_contributors sc on sc.id = e.contributed_by
                                        where e.id = v_enc and e.patient_id = (c.o_share).patient_id and sc.share_id = (c.o_share).id and e.record_status = 'active') then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_name := left(v_ctr.full_name || coalesce(' — ' || v_ctr.facility, ''), 300);
  v_rx := (p_rx - 'prescriber_name' - 'prescriber_license' - 'facility_name' - 'status' - 'specialty_id' - 'encounter_id')
          || jsonb_build_object('prescriber_name', v_ctr.full_name, 'prescriber_license', v_ctr.license_no, 'facility_name', v_ctr.facility,
                                'specialty_id', v_spec, 'encounter_id', v_enc);
  perform set_config('app.share_contributor', c.o_contributor::text, true);
  begin
    v_id := app.prescription_write((c.o_share).patient_id, v_rx, p_lines, c.o_contributor, v_name);
  exception when sqlstate '22023' then
    return jsonb_build_object('status', 'invalid', 'reason', sqlerrm);
  when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('status', 'invalid');
  end;
  update public.share_contributors set contribution_count = contribution_count + 1, last_contribution_at = now() where id = c.o_contributor;
  perform app.share_log((c.o_share).id, 'contribution_added', p_ip_hash, p_user_agent,
                        jsonb_build_object('contributor', c.o_contributor, 'table', 'prescriptions', 'id', v_id));
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

-- the doctor withdraws a prescription they wrote through this share (kept in the history with the reason; its lines follow)
create function public.share_retract_prescription(p_session_token text, p_id uuid, p_reason text, p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_ok boolean;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('status', 'reason_required'); end if;
  perform set_config('app.share_contributor', c.o_contributor::text, true);
  update public.prescriptions x set record_status = 'entered_in_error',
         invalidated_reason = left('سحبها الطبيب / withdrawn by the clinician: ' || btrim(p_reason), 500)
   where x.id = p_id and x.patient_id = (c.o_share).patient_id and x.record_status = 'active'
     and x.contributed_by in (select sc.id from public.share_contributors sc where sc.share_id = (c.o_share).id)
  returning true into v_ok;
  if not coalesce(v_ok, false) then return jsonb_build_object('status', 'not_found'); end if;
  perform app.share_log((c.o_share).id, 'contribution_retracted', p_ip_hash, p_user_agent,
                        jsonb_build_object('contributor', c.o_contributor, 'table', 'prescriptions', 'id', p_id));
  return jsonb_build_object('status', 'ok');
end $$;

-- the doctor presents a consent; the patient has signed it on the doctor's screen (the signature is already in the patient's folder)
create function public.share_present_consent(p_session_token text, p_consent jsonb, p_signature_path text, p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c record; v_used int; v_ctr public.share_contributors; v_id uuid; v_spec uuid; v_plan uuid; v_item uuid; v_old uuid; v_cx jsonb; v_name text;
  v_dent uuid := (select id from public.medical_specialties where code = 'dentistry');
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  if not ('consents' = any ((c.o_share).contribute_modules)) then return jsonb_build_object('status', 'forbidden'); end if;
  select coalesce(sum(contribution_count), 0) into v_used from public.share_contributors where share_id = (c.o_share).id;
  if v_used >= (c.o_share).max_contributions then return jsonb_build_object('status', 'limit'); end if;
  if jsonb_typeof(coalesce(p_consent, 'null')) <> 'object' or p_signature_path is null
     or p_signature_path not like (c.o_share).patient_id::text || '/signatures/%.png' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into v_ctr from public.share_contributors where id = c.o_contributor;
  v_plan := nullif(p_consent ->> 'treatment_plan_id', '')::uuid;
  v_item := nullif(p_consent ->> 'treatment_item_id', '')::uuid;
  v_old := nullif(p_consent ->> 'supersedes', '')::uuid;
  -- a consent for a plan or a treatment only where the share covers the dental file, and only for what is current
  if v_plan is not null or v_item is not null then
    if not app.share_covers_dentistry(c.o_share) then return jsonb_build_object('status', 'forbidden'); end if;
    if v_item is not null then
      select i.plan_id into v_plan from public.treatment_items i join public.treatment_plans p on p.id = i.plan_id
       where i.id = v_item and i.patient_id = (c.o_share).patient_id and i.record_status = 'active' and p.record_status = 'active' and p.status <> 'superseded'
         and (v_plan is null or i.plan_id = v_plan);
      if v_plan is null then return jsonb_build_object('status', 'not_found'); end if;
    elsif not exists (select 1 from public.treatment_plans p where p.id = v_plan and p.patient_id = (c.o_share).patient_id and p.record_status = 'active' and p.status <> 'superseded') then
      return jsonb_build_object('status', 'not_found');
    end if;
  end if;
  -- a new version only of a consent this clinician presented
  if v_old is not null and not exists (select 1 from public.consents k where k.id = v_old and k.patient_id = (c.o_share).patient_id
                                          and k.contributed_by = c.o_contributor and k.status = 'signed' and k.record_status = 'active') then
    return jsonb_build_object('status', 'not_found');
  end if;
  v_spec := case when (c.o_share).scope_kind = 'specialty' then ((c.o_share).specialty_ids)[1]
                 when v_plan is not null then v_dent else null end;
  v_name := left(v_ctr.full_name || coalesce(' — ' || v_ctr.facility, ''), 300);
  v_cx := (p_consent - 'specialty_id' - 'presented_by' - 'treatment_plan_id' - 'treatment_item_id' - 'supersedes')
          || jsonb_build_object('specialty_id', v_spec, 'presented_by', v_ctr.full_name, 'treatment_plan_id', v_plan, 'treatment_item_id', v_item, 'supersedes', v_old);
  perform set_config('app.share_contributor', c.o_contributor::text, true);
  begin
    v_id := app.consent_write((c.o_share).patient_id, v_cx, p_signature_path, c.o_contributor, v_name);
  exception when sqlstate '22023' then
    return jsonb_build_object('status', 'invalid', 'reason', sqlerrm);
  when check_violation or not_null_violation or invalid_text_representation then
    return jsonb_build_object('status', 'invalid');
  end;
  update public.share_contributors set contribution_count = contribution_count + 1, last_contribution_at = now() where id = c.o_contributor;
  perform app.share_log((c.o_share).id, 'contribution_added', p_ip_hash, p_user_agent,
                        jsonb_build_object('contributor', c.o_contributor, 'table', 'consents', 'id', v_id));
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

-- what the doctor sees: the prescriptions and consents within the share's scope (no signature image, no cost)
create function public.share_rx_extras(p_session_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_share uuid; v_sid uuid; v_st text; s public.medical_shares; v_ctr uuid; v_from date; v_to date; v_rx jsonb := '[]'; v_cons jsonb := '[]';
begin
  select a.o_share_id, a.o_session_id, a.o_status into v_share, v_sid, v_st from app.resolve_share_session(p_session_token) a;
  if v_st <> 'ok' then return jsonb_build_object('status', 'expired'); end if;
  select * into s from public.medical_shares where id = v_share;
  select id into v_ctr from public.share_contributors where session_id = v_sid;
  v_from := coalesce(s.date_from, '-infinity'::date);
  v_to := coalesce(s.date_to, 'infinity'::date);
  if s.allow_contribute and 'prescriptions' = any (s.contribute_modules) then
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'prescriber_name', p.prescriber_name, 'prescriber_license', p.prescriber_license, 'facility_name', p.facility_name,
        'issued_on', p.issued_on, 'status', p.status, 'status_reason', p.status_reason, 'notes', p.notes, 'contributed_by', p.contributed_by,
        'mine', v_ctr is not null and p.contributed_by = v_ctr,
        'lines', coalesce((select jsonb_agg(jsonb_build_object(
            'id', m.id, 'name_generic', m.name_generic, 'name_brand', m.name_brand, 'strength', m.strength, 'form', m.form, 'dose', m.dose, 'route', m.route,
            'frequency', m.frequency, 'as_needed', m.as_needed, 'quantity', m.quantity, 'duration_days', m.duration_days, 'refills', m.refills,
            'instructions', m.instructions, 'indication', m.indication, 'end_date', m.end_date, 'status', m.status) order by m.recorded_at)
          from public.medications m where m.prescription_id = p.id and m.record_status = 'active'), '[]'))
        order by p.issued_on desc, p.recorded_at desc), '[]')
      into v_rx
      from public.prescriptions p
     where p.patient_id = s.patient_id and p.record_status = 'active' and p.issued_on between v_from and v_to
       and (s.scope_kind = 'full' or (s.scope_kind = 'specialty' and p.specialty_id = any (s.specialty_ids)) or (v_ctr is not null and p.contributed_by = v_ctr));
  end if;
  if s.allow_contribute and 'consents' = any (s.contribute_modules) then
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', k.id, 'kind', k.kind, 'title', k.title, 'version', k.version, 'status', k.status, 'signer_name', k.signer_name, 'signer_role', k.signer_role,
        'signed_at', k.signed_at, 'presented_by', k.presented_by, 'treatment_plan_id', k.treatment_plan_id, 'treatment_item_id', k.treatment_item_id,
        'withdrawn_at', k.withdrawn_at, 'withdrawn_reason', k.withdrawn_reason, 'contributed_by', k.contributed_by, 'mine', v_ctr is not null and k.contributed_by = v_ctr)
        order by k.signed_at desc), '[]')
      into v_cons
      from public.consents k
     where k.patient_id = s.patient_id and k.record_status = 'active'
       and (s.scope_kind = 'full' or (s.scope_kind = 'specialty' and k.specialty_id = any (s.specialty_ids)) or (v_ctr is not null and k.contributed_by = v_ctr));
  end if;
  return jsonb_build_object('status', 'ok', 'prescriptions', v_rx, 'consents', v_cons);
end $$;

-- the patient invalidates the prescriptions one clinician wrote (their medication lines are covered by share_invalidate_contributions;
-- this closes the prescription itself)
create function public.share_invalidate_prescriptions(p_contributor uuid, p_reason text) returns int
language plpgsql security definer set search_path = '' as $$
declare v_patient uuid; n int;
begin
  select patient_id into v_patient from public.share_contributors where id = p_contributor;
  if v_patient is null or not app.has_patient_access(v_patient, 'write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required to mark a record as entered in error' using errcode = '22023'; end if;
  update public.prescriptions set record_status = 'entered_in_error', invalidated_reason = left(btrim(p_reason), 500)
   where contributed_by = p_contributor and patient_id = v_patient and record_status = 'active';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.share_prescription_create(text, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.share_retract_prescription(text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.share_present_consent(text, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.share_rx_extras(text) from public, anon, authenticated;
revoke all on function public.share_invalidate_prescriptions(uuid, text) from public, anon;
grant execute on function public.share_prescription_create(text, jsonb, jsonb, text, text) to service_role;
grant execute on function public.share_retract_prescription(text, uuid, text, text, text) to service_role;
grant execute on function public.share_present_consent(text, jsonb, text, text, text) to service_role;
grant execute on function public.share_rx_extras(text) to service_role;
grant execute on function public.share_invalidate_prescriptions(uuid, text) to authenticated;
