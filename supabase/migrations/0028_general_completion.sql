-- 0028: general completion (phase 4) — structured social history, the symptom log, search inside the file and the full export.
--
-- * Social history: what 0016 already holds (tobacco with pack-years, alcohol, activity level, occupation, free-text exposures, diet)
--   is kept. Added: weekly activity minutes/days, a diet pattern, sleep, other substance use (sensitive: never part of a share or a
--   report), the living situation, and occupational / environmental exposures as a list (patient_exposures) with years and the
--   protective equipment used.
-- * Symptom log: symptom_entries, with severity 0-10 over time, onset / end, pattern, triggers and relief, optionally tied to a condition.
-- * public.patient_search: one function with invoker rights, so RLS decides what a signed-in account can find.
-- * public.patient_export_data / public.patient_export_log: the whole record for the owner (manager) and an audit row for the export.
-- Nothing here changes public.share_context: the new social-history fields are for the patient's own side only.

-- ---------------------------------------------------------------- social history on the health profile
alter table public.patient_health_profile
  add column activity_minutes_per_week int check (activity_minutes_per_week between 0 and 5040),
  add column activity_days_per_week smallint check (activity_days_per_week between 0 and 7),
  add column diet_pattern text check (diet_pattern in ('balanced', 'vegetarian', 'vegan', 'low_carb', 'diabetic', 'low_salt', 'high_protein', 'irregular', 'other')),
  add column sleep_hours numeric(3, 1) check (sleep_hours between 0 and 24),
  add column sleep_quality text check (sleep_quality in ('good', 'fair', 'poor')),
  add column substance_use_status text not null default 'unknown' check (substance_use_status in ('unknown', 'none', 'former', 'current')),
  add column substance_types text[] not null default '{}'
    check (substance_types <@ array['cannabis', 'stimulants', 'opioids', 'sedatives', 'hallucinogens', 'inhalants', 'khat', 'other']::text[]),
  add column substance_notes text check (length(substance_notes) <= 500),
  add column living_situation text check (living_situation in ('alone', 'with_spouse', 'with_family', 'with_roommates', 'care_facility', 'other')),
  add constraint patient_health_profile_substance_chk check (substance_use_status in ('former', 'current') or (cardinality(substance_types) = 0 and substance_notes is null));

-- ---------------------------------------------------------------- occupational / environmental exposures (a list)
create table public.patient_exposures (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  kind text not null default 'other' check (kind in (
    'dust', 'silica', 'asbestos', 'chemicals', 'solvents', 'pesticides', 'fumes', 'radiation', 'noise', 'heat', 'vibration', 'biological', 'secondhand_smoke', 'other')),
  agent text check (length(agent) <= 200),
  setting text not null default 'work' check (setting in ('work', 'home', 'environment', 'other')),
  years numeric(4, 1) check (years between 0 and 80),
  ongoing boolean not null default true,
  protective_equipment text not null default 'unknown' check (protective_equipment in ('unknown', 'none', 'sometimes', 'always')),
  notes text check (length(notes) <= 2000),
  unique (id, patient_id)
);
create index patient_exposures_patient_idx on public.patient_exposures (patient_id, ongoing);

-- ---------------------------------------------------------------- the symptom log
create table public.symptom_entries (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  symptom text not null check (length(btrim(symptom)) between 2 and 200),
  body_site text check (length(body_site) <= 200),
  severity smallint check (severity between 0 and 10),
  onset_at timestamptz not null,
  ended_at timestamptz,
  pattern text check (pattern in ('constant', 'intermittent', 'episodic', 'worsening', 'improving', 'unknown')),
  triggers text check (length(triggers) <= 1000),
  relieved_by text check (length(relieved_by) <= 1000),
  condition_id uuid,
  notes text check (length(notes) <= 4000),
  unique (id, patient_id),
  foreign key (condition_id, patient_id) references public.conditions (id, patient_id),
  check (ended_at is null or ended_at >= onset_at)
);
create index symptom_entries_patient_idx on public.symptom_entries (patient_id, onset_at desc);
create index symptom_entries_condition_idx on public.symptom_entries (condition_id) where condition_id is not null;

-- provenance + lifecycle (the same columns every clinical table carries), guard, audit, RLS
do $$
declare t text;
begin
  foreach t in array array['patient_exposures', 'symptom_entries'] loop
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
      add constraint %I check (record_status = ''active'' or length(btrim(coalesce(invalidated_reason, ''''))) > 0)', t, t || '_invalid_reason_chk');
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.clinical_guard()', t || '_guard', t);
    execute format('create trigger %I after insert or update on public.%I for each row execute function app.audit_row()', t || '_audit', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app.has_patient_access(patient_id))', t || '_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.has_patient_access(patient_id, ''write''))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.has_patient_access(patient_id, ''write'')) with check (app.has_patient_access(patient_id, ''write''))', t || '_upd', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- search inside the file
-- Text compared without diacritics and letter-form differences (alef forms, ya / alef maqsura, ta marbuta), case-insensitively.
create function app.search_norm(p_text text) returns text
language sql stable set search_path = '' as $$
  select regexp_replace(translate(lower(coalesce(p_text, '')), E'أإآٱىة', E'اااايه'),
                        E'[ً-ْٰـ]', '', 'g')
$$;

-- The first text that contains the query, cut to a short excerpt around the match; null when none does.
create function app.search_hit(p_q text, p_texts text[]) returns text
language plpgsql stable set search_path = '' as $$
declare t text; nq text := app.search_norm(btrim(p_q)); pos int;
begin
  foreach t in array p_texts loop
    continue when t is null or btrim(t) = '';
    if position(nq in app.search_norm(t)) > 0 then
      pos := position(lower(btrim(p_q)) in lower(t));
      if pos = 0 then return left(t, 160) || case when length(t) > 160 then '…' else '' end; end if;
      return case when pos > 40 then '…' else '' end || substr(t, greatest(pos - 40, 1), 160)
             || case when length(t) > greatest(pos - 40, 1) + 159 then '…' else '' end;
    end if;
  end loop;
  return null;
end $$;
grant execute on function app.search_norm(text) to authenticated, service_role;
grant execute on function app.search_hit(text, text[]) to authenticated, service_role;

-- One box over the patient's active records. Invoker rights: every branch is filtered by the caller's RLS, and the patient id is
-- part of every filter, so another patient's rows are never reachable. Each source returns at most 15 hits so one big source (lab
-- values) cannot crowd out the rest; the whole result is capped at 80, newest first.
create function public.patient_search(p_patient uuid, p_q text)
returns table (table_name text, record_id uuid, title text, snippet text, happened_at timestamptz, link_kind text)
language plpgsql stable security invoker set search_path = '' as $$
declare q text := btrim(coalesce(p_q, ''));
begin
  if length(q) < 2 or length(q) > 100 then return; end if;
  if not app.has_patient_access(p_patient) then return; end if;
  return query
  select r.table_name, r.record_id, r.title, r.snippet, r.happened_at, r.link_kind from (
    (select 'conditions'::text, c.id, c.name, h.s, c.onset_date::timestamptz, 'conditions'::text
       from public.conditions c cross join lateral (select app.search_hit(q, array[c.name, c.notes, c.icd10_code]) as s) h
      where c.patient_id = p_patient and c.record_status = 'active' and h.s is not null order by c.onset_date desc nulls last, c.recorded_at desc limit 15)
    union all
    (select 'medications', m.id, coalesce(m.name_generic, m.name_brand), h.s, m.start_date::timestamptz, 'medications'
       from public.medications m cross join lateral (select app.search_hit(q, array[m.name_generic, m.name_brand, m.indication, m.instructions, m.notes]) as s) h
      where m.patient_id = p_patient and m.record_status = 'active' and h.s is not null order by m.start_date desc nulls last, m.recorded_at desc limit 15)
    union all
    (select 'allergies', a.id, a.substance, h.s, a.onset_date::timestamptz, 'allergies'
       from public.allergies a cross join lateral (select app.search_hit(q, array[a.substance, a.reaction, a.notes]) as s) h
      where a.patient_id = p_patient and a.record_status = 'active' and h.s is not null order by a.onset_date desc nulls last, a.recorded_at desc limit 15)
    union all
    (select 'encounters', e.id, coalesce(e.reason, e.kind), h.s, e.started_at, 'visits'
       from public.encounters e cross join lateral (select app.search_hit(q, array[e.reason, e.assessment, e.plan, e.symptoms, e.summary, e.history_of_present_illness]) as s) h
      where e.patient_id = p_patient and e.record_status = 'active' and h.s is not null order by e.started_at desc limit 15)
    union all
    (select 'procedures', pr.id, pr.name, h.s, pr.performed_on::timestamptz, 'procedures'
       from public.procedures pr cross join lateral (select app.search_hit(q, array[pr.name, pr.indication, pr.outcome, pr.notes]) as s) h
      where pr.patient_id = p_patient and pr.record_status = 'active' and h.s is not null order by pr.performed_on desc nulls last, pr.recorded_at desc limit 15)
    union all
    (select 'clinical_notes', n.id, coalesce(n.title, n.kind), h.s, n.noted_at, 'notes'
       from public.clinical_notes n cross join lateral (select app.search_hit(q, array[n.title, n.body]) as s) h
      where n.patient_id = p_patient and n.record_status = 'active' and h.s is not null order by n.noted_at desc limit 15)
    union all
    (select 'medical_documents', d.id, d.title, h.s, coalesce(d.document_date::timestamptz, d.uploaded_at), 'documents'
       from public.medical_documents d cross join lateral (select app.search_hit(q, array[d.title, d.description]) as s) h
      where d.patient_id = p_patient and d.record_status = 'active' and h.s is not null order by coalesce(d.document_date::timestamptz, d.uploaded_at) desc limit 15)
    union all
    (select 'lab_reports', l.id, l.title, h.s, coalesce(l.collected_at, l.recorded_at), 'labs'
       from public.lab_reports l cross join lateral (select app.search_hit(q, array[l.title, l.lab_name]) as s) h
      where l.patient_id = p_patient and l.record_status = 'active' and h.s is not null order by coalesce(l.collected_at, l.recorded_at) desc limit 15)
    union all
    (select 'observations', o.id, coalesce(o.custom_name, ty.name_en), h.s, o.effective_at, case when ty.category = 'lab' then 'labs' else 'vitals' end
       from public.observations o join public.observation_types ty on ty.id = o.type_id
            cross join lateral (select app.search_hit(q, array[o.custom_name, ty.name_en, ty.name_ar, o.value_text, o.notes]) as s) h
      where o.patient_id = p_patient and o.status in ('final', 'preliminary', 'amended') and h.s is not null order by o.effective_at desc limit 15)
    union all
    (select 'imaging_studies', i.id, concat_ws(' — ', i.modality, i.body_site), h.s, i.performed_on::timestamptz, 'imaging'
       from public.imaging_studies i cross join lateral (select app.search_hit(q, array[i.impression, i.findings, i.body_site]) as s) h
      where i.patient_id = p_patient and i.record_status = 'active' and h.s is not null order by i.performed_on desc nulls last, i.recorded_at desc limit 15)
    union all
    (select 'symptom_entries', y.id, y.symptom, h.s, y.onset_at, 'symptoms'
       from public.symptom_entries y cross join lateral (select app.search_hit(q, array[y.symptom, y.body_site, y.triggers, y.relieved_by, y.notes]) as s) h
      where y.patient_id = p_patient and y.record_status = 'active' and h.s is not null order by y.onset_at desc limit 15)
  ) r(table_name, record_id, title, snippet, happened_at, link_kind)
  order by r.happened_at desc nulls last, r.title
  limit 80;
end $$;
revoke all on function public.patient_search(uuid, text) from public, anon;
grant execute on function public.patient_search(uuid, text) to authenticated;

-- ---------------------------------------------------------------- the full export
-- Every record of the patient grouped by table (active and entered-in-error alike), read with the caller's rights. Only an owner or
-- guardian may ask. Not included: the audit log, the members list and everything about share links (tokens and PIN hashes).
create function public.patient_export_data(p_patient uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_out jsonb; v_part jsonb; t text;
begin
  if not app.has_patient_access(p_patient, 'manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_part from public.patients x where x.id = p_patient;
  v_out := jsonb_build_object('patients', v_part);
  for t in
    select c.relname from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attname = 'patient_id' and not a.attisdropped
     where c.relkind = 'r' and has_table_privilege(c.oid, 'select')
       and c.relname not in ('patients', 'patient_deletion_log', 'audit_logs', 'patient_members', 'medical_shares', 'medical_share_items',
                             'medical_share_sessions', 'medical_share_access_logs', 'share_notes', 'share_attempts', 'share_contributors')
     order by c.relname
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x where x.patient_id = $1', t) into v_part using p_patient;
    v_out := v_out || jsonb_build_object(t, v_part);
  end loop;
  -- the catalogs the records point to (so the export can be read without the database): measurement types and specialties
  v_out := v_out || jsonb_build_object('catalogs', jsonb_build_object(
    'observation_types', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'category', x.category, 'value_kind', x.value_kind,
                                                                      'name_ar', x.name_ar, 'name_en', x.name_en, 'default_unit', x.default_unit)), '[]')
                            from public.observation_types x),
    'medical_specialties', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'name_ar', x.name_ar, 'name_en', x.name_en)), '[]')
                              from public.medical_specialties x)));
  return v_out;
end $$;
revoke all on function public.patient_export_data(uuid) from public, anon;
grant execute on function public.patient_export_data(uuid) to authenticated;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in ('insert', 'update', 'invalidate', 'export'));

-- The export is written to the audit log by the web server once the archive is built (how many document files it carried).
create function public.patient_export_log(p_patient uuid, p_documents int default 0) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not app.has_patient_access(p_patient, 'manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.audit_logs (actor_id, actor_kind, patient_id, table_name, record_id, action, changed_fields, new_data)
  values (auth.uid(), 'user', p_patient, 'patients', p_patient, 'export', array['export'], jsonb_build_object('documents', coalesce(p_documents, 0)));
end $$;
revoke all on function public.patient_export_log(uuid, int) from public, anon;
grant execute on function public.patient_export_log(uuid, int) to authenticated;
