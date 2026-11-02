-- 0031: care (phase 3) — the reminders centre, the emergency card, "needs attention", and members invited by link.
--
-- 1. Reminders. One read function (care_reminder_feed) gathers, under the caller's own rights, everything that is coming up
--    for one patient or for every patient the account can see: recalls, medication end dates and refills, prescriptions
--    ending, open test orders past their target date, appointments and the reminders people write themselves
--    (care_reminders). There is no provider for e-mail or SMS, so nothing is sent: the feed is what a provider would read.
-- 2. Emergency card. emergency_cards holds only the SHA-256 of the link token (like medical_shares). The public link is
--    answered by emergency_view (service role only): it exposes the card fields and nothing else, never what the patient
--    marked sensitive unless the patient opted in, is rate limited per client address, and every view is logged.
-- 3. Needs attention: care_abnormal_labs (latest value per test against its reference, with the previous value) and
--    care_attention (one count per indicator per patient), both with invoker rights so RLS decides what is counted.
-- 4. Invites. An owner or guardian invites another account by e-mail as viewer or editor. There is no mail provider: the
--    invite is a one-time link (only its hash is stored, valid for 7 days) that the invited account must open while signed
--    in with that same e-mail address. Members are listed, revoked and can leave through definer functions; patient_members
--    still has no insert/update grant for anyone.

-- ---------------------------------------------------------------- test orders get an optional target date
alter table public.test_orders add column target_on date;
alter table public.test_orders add constraint test_orders_target_chk check (target_on is null or target_on >= requested_on);
comment on column public.test_orders.target_on is 'Date by which the test should be done. Without one the reminders use the request date plus 3 / 14 / 30 days by priority.';

-- ================================================================================================================ 1. reminders
create table public.care_reminders (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  title text not null check (length(btrim(title)) between 2 and 200),
  notes text check (length(notes) <= 1000),
  due_on date not null,
  -- how many days before the due date it starts to show
  remind_days_before smallint not null default 3 check (remind_days_before between 0 and 365),
  -- a repeating reminder moves to the next date when it is done; a one-off one is closed
  repeat_months smallint check (repeat_months between 1 and 60),
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  completed_on date,
  last_done_on date,
  unique (id, patient_id),
  check ((status = 'open') = (completed_on is null))
);
create index care_reminders_patient_idx on public.care_reminders (patient_id, status, due_on);

alter table public.care_reminders
  add column source text not null default 'self' check (source in ('self', 'clinic', 'hospital', 'laboratory', 'device', 'imported', 'other')),
  add column source_detail text check (source_detail is null or length(source_detail) <= 300),
  add column verification text not null default 'reported' check (verification in ('reported', 'confirmed', 'verified')),
  add column recorded_by uuid references auth.users (id) default auth.uid(),
  add column recorded_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid references auth.users (id),
  add column record_status text not null default 'active' check (record_status in ('active', 'entered_in_error')),
  add column invalidated_reason text,
  add column invalidated_at timestamptz,
  add column invalidated_by uuid references auth.users (id),
  add constraint care_reminders_invalid_reason_chk check (record_status = 'active' or length(btrim(coalesce(invalidated_reason, ''))) > 0);
create trigger care_reminders_guard before insert or update on public.care_reminders for each row execute function app.clinical_guard();
create trigger care_reminders_audit after insert or update on public.care_reminders for each row execute function app.audit_row();
alter table public.care_reminders enable row level security;
create policy care_reminders_sel on public.care_reminders for select to authenticated using (app.has_patient_access(patient_id));
create policy care_reminders_ins on public.care_reminders for insert to authenticated with check (app.has_patient_access(patient_id, 'write'));
create policy care_reminders_upd on public.care_reminders for update to authenticated
  using (app.has_patient_access(patient_id, 'write')) with check (app.has_patient_access(patient_id, 'write'));
grant select, insert, update on public.care_reminders to authenticated;
grant all on public.care_reminders to service_role;

-- done: a one-off reminder closes; a repeating one moves to its next date after today (never backwards)
create function public.care_reminder_done(p_reminder uuid, p_date date default null) returns void
language plpgsql set search_path = '' as $$
declare r public.care_reminders; v_date date := coalesce(p_date, current_date); v_next date; v_i int := 0;
begin
  if v_date > current_date + 1 then raise exception 'date_in_future' using errcode = '22023'; end if;
  select * into r from public.care_reminders where id = p_reminder and record_status = 'active' and status = 'open';
  if not found or not app.has_patient_access(r.patient_id, 'write') then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.repeat_months is null then
    update public.care_reminders set status = 'done', completed_on = v_date, last_done_on = v_date where id = p_reminder;
  else
    v_next := r.due_on;
    loop
      v_next := (v_next + make_interval(months => r.repeat_months))::date;
      v_i := v_i + 1;
      exit when v_next > v_date or v_i >= 600;
    end loop;
    update public.care_reminders set due_on = v_next, last_done_on = v_date where id = p_reminder;
  end if;
end $$;
revoke all on function public.care_reminder_done(uuid, date) from public, anon;
grant execute on function public.care_reminder_done(uuid, date) to authenticated;

-- The feed. kind: recall | medication_end | medication_refill | prescription_end | test_order | appointment | custom.
-- code: the sub-kind (the recall kind, the test priority...), label/detail: free text to show. Invoker rights: RLS limits it to
-- the patients the caller can read (and to one patient when p_patient is given). Dates are the caller's local dates.
create function public.care_reminder_feed(p_patient uuid default null, p_horizon int default 30, p_today date default current_date, p_tz text default 'UTC')
returns table (kind text, code text, patient_id uuid, ref_id uuid, due_on date, label text, detail text, at_time timestamptz)
language sql stable set search_path = '' as $$
  -- recalls (the dental check-up, cleaning...): overdue or coming up
  select 'recall'::text, r.kind::text, r.patient_id, r.id, r.due_on, r.label::text, null::text, null::timestamptz
    from public.recalls r
   where r.status = 'active' and r.record_status = 'active' and (p_patient is null or r.patient_id = p_patient)
     and r.due_on <= p_today + p_horizon
  union all
  -- a medicine with an end date that is not part of a prescription (those are read through the prescription)
  select 'medication_end', m.status::text, m.patient_id, m.id, m.end_date, coalesce(m.name_generic, m.name_brand)::text,
         nullif(btrim(concat_ws(' ', m.strength, m.dose)), '')::text, null::timestamptz
    from public.medications m
   where m.record_status = 'active' and m.status in ('active', 'on_hold') and m.prescription_id is null and m.end_date is not null
     and (p_patient is null or m.patient_id = p_patient) and m.end_date <= p_today + p_horizon and m.end_date >= p_today - 365
  union all
  -- the next refill of a medicine that has refills: one supply lasts duration_days, refill k is due k supplies after the start
  select 'medication_refill', 'refill', m.patient_id, m.id, nx.d, coalesce(m.name_generic, m.name_brand)::text,
         (nx.k::text || '/' || m.refills::text), null::timestamptz
    from public.medications m
    left join public.prescriptions rx on rx.id = m.prescription_id and rx.patient_id = m.patient_id
   cross join lateral (
      select (coalesce(m.start_date, rx.issued_on) + k * m.duration_days)::date as d, k
        from generate_series(1, m.refills) k
       where (coalesce(m.start_date, rx.issued_on) + k * m.duration_days)::date >= p_today
       order by 1 limit 1) nx
   where m.record_status = 'active' and m.status = 'active' and m.refills > 0 and m.duration_days is not null
     and coalesce(m.start_date, rx.issued_on) is not null and (p_patient is null or m.patient_id = p_patient)
     and nx.d <= p_today + p_horizon
  union all
  -- an active prescription whose last supply ends (the latest end over its lines, refills included)
  select 'prescription_end', 'rx', x.patient_id, x.id, x.ends, x.prescriber_name::text, x.n::text, null::timestamptz
    from (select rx.patient_id, rx.id, rx.prescriber_name, count(*) as n,
                 max(case when m.duration_days is not null and coalesce(m.refills, 0) > 0
                          then (coalesce(m.start_date, rx.issued_on) + m.duration_days * (1 + m.refills) - 1)::date
                          else coalesce(m.end_date, (coalesce(m.start_date, rx.issued_on) + m.duration_days - 1)::date) end) as ends
            from public.prescriptions rx
            join public.medications m on m.prescription_id = rx.id and m.patient_id = rx.patient_id and m.record_status = 'active' and m.status = 'active'
           where rx.status = 'active' and rx.record_status = 'active' and (p_patient is null or rx.patient_id = p_patient)
           group by rx.patient_id, rx.id, rx.prescriber_name) x
   where x.ends is not null and x.ends <= p_today + p_horizon and x.ends >= p_today - 90
  union all
  -- an open test request past its target date (or about to be): the target is the date set, else the request plus 3 / 14 / 30 days
  select 'test_order', t.priority::text, t.patient_id, t.id, t.tgt, t.name::text, t.kind::text, null::timestamptz
    from (select o.*, coalesce(o.target_on, o.requested_on + case o.priority when 'urgent' then 3 when 'soon' then 14 else 30 end) as tgt
            from public.test_orders o
           where o.status = 'requested' and o.record_status = 'active' and (p_patient is null or o.patient_id = p_patient)) t
   where t.tgt <= p_today + 7
  union all
  -- appointments coming up
  select 'appointment', 'scheduled', a.patient_id, a.id, (a.scheduled_at at time zone p_tz)::date, coalesce(a.reason, a.practitioner_name)::text,
         a.practitioner_name::text, a.scheduled_at
    from public.appointments a
   where a.status = 'scheduled' and a.record_status = 'active' and (p_patient is null or a.patient_id = p_patient)
     and (a.scheduled_at at time zone p_tz)::date between p_today and p_today + p_horizon
  union all
  -- what people wrote for themselves, from its lead time on
  select 'custom', case when c.repeat_months is null then 'once' else 'repeat' end, c.patient_id, c.id, c.due_on, c.title::text, c.notes::text, null::timestamptz
    from public.care_reminders c
   where c.status = 'open' and c.record_status = 'active' and (p_patient is null or c.patient_id = p_patient)
     and c.due_on - c.remind_days_before <= p_today
$$;
revoke all on function public.care_reminder_feed(uuid, int, date, text) from public, anon;
grant execute on function public.care_reminder_feed(uuid, int, date, text) to authenticated;

-- the number shown on the bell: overdue, due within a week, and the reminders people wrote that are inside their lead time
create function public.care_reminder_count(p_today date default current_date, p_tz text default 'UTC') returns int
language sql stable set search_path = '' as $$
  select count(*)::int from public.care_reminder_feed(null, 30, p_today, p_tz) f where f.kind = 'custom' or f.due_on <= p_today + 7
$$;
revoke all on function public.care_reminder_count(date, text) from public, anon;
grant execute on function public.care_reminder_count(date, text) to authenticated;

-- ================================================================================================================ 3. needs attention
-- The latest value of each laboratory test that is outside its reference, within the last year, with the value before it.
-- A test is told apart by its type and, for "other" tests, its own name. Invoker rights: RLS decides which files are read.
create function public.care_abnormal_labs(p_patient uuid default null, p_today date default current_date)
returns table (patient_id uuid, observation_id uuid, type_id uuid, custom_name text, value_num numeric, value_text text, unit text,
               interpretation text, effective_at timestamptz, ref_low numeric, ref_high numeric,
               prev_value numeric, prev_unit text, prev_at timestamptz)
language sql stable set search_path = '' as $$
  with labs as (
    select o.id, o.patient_id, o.type_id, o.custom_name, o.value_num, o.value_text, o.unit, o.interpretation, o.effective_at, o.ref_low, o.ref_high,
           row_number() over (partition by o.patient_id, o.type_id, coalesce(o.custom_name, '') order by o.effective_at desc, o.recorded_at desc) as rn
      from public.observations o
      join public.observation_types t on t.id = o.type_id and t.category = 'lab'
     where o.status in ('final', 'preliminary') and (p_patient is null or o.patient_id = p_patient)
  )
  select l.patient_id, l.id, l.type_id, l.custom_name::text, l.value_num, l.value_text::text, l.unit::text, l.interpretation::text, l.effective_at, l.ref_low, l.ref_high,
         p.value_num, p.unit::text, p.effective_at
    from labs l
    left join labs p on p.patient_id = l.patient_id and p.type_id = l.type_id and coalesce(p.custom_name, '') = coalesce(l.custom_name, '') and p.rn = 2
   where l.rn = 1 and l.interpretation not in ('normal', 'not_assessed') and l.effective_at >= (p_today - 365)::timestamptz
$$;
revoke all on function public.care_abnormal_labs(uuid, date) from public, anon;
grant execute on function public.care_abnormal_labs(uuid, date) to authenticated;

-- One count per indicator per patient (only those above zero):
--   abnormal_labs, overdue (reminders past their date), unreviewed (doctor additions and notes not yet reviewed),
--   soft_tissue (an open suspicious lesion), expiring_shares (active links ending within 72 hours), drafts (perio drafts, unsigned notes)
create function public.care_attention(p_today date default current_date, p_tz text default 'UTC')
returns table (patient_id uuid, code text, n int)
language sql stable set search_path = '' as $$
  select l.patient_id, 'abnormal_labs'::text, count(*)::int from public.care_abnormal_labs(null, p_today) l group by l.patient_id
  union all
  select f.patient_id, 'overdue', count(*)::int from public.care_reminder_feed(null, 30, p_today, p_tz) f where f.due_on < p_today group by f.patient_id
  union all
  select u.patient_id, 'unreviewed', sum(u.k)::int
    from (select c.patient_id, count(*) as k from public.share_contributors c
           where c.contribution_count > 0 and (c.reviewed_at is null or c.last_contribution_at > c.reviewed_at) group by c.patient_id
          union all
          select s.patient_id, count(*) from public.share_notes s where s.reviewed_at is null group by s.patient_id) u
   group by u.patient_id
  union all
  -- the newest exam that answered the cancer screening decisively ("suspicious", or "no suspicious lesion" confirmed by a clinician)
  select x.patient_id, 'soft_tissue', 1
    from (select distinct on (e.patient_id) e.patient_id, e.sections -> 'soft_tissue' ->> 'cancer_screening' as answer
            from public.dental_exams e
           where e.record_status = 'active'
             and (e.sections -> 'soft_tissue' ->> 'cancer_screening' = 'suspicious'
                  or (e.sections -> 'soft_tissue' ->> 'cancer_screening' = 'no_suspicious' and e.verification <> 'reported'))
           order by e.patient_id, e.exam_date desc, e.recorded_at desc) x
   where x.answer = 'suspicious'
  union all
  select s.patient_id, 'expiring_shares', count(*)::int from public.medical_shares s
   where s.revoked_at is null and s.expires_at > now() and s.expires_at <= now() + interval '72 hours' group by s.patient_id
  union all
  select d.patient_id, 'drafts', sum(d.k)::int
    from (select e.patient_id, count(*) as k from public.perio_exams e where e.record_status = 'active' and e.status = 'draft' group by e.patient_id
          union all
          select n.patient_id, count(*) from public.clinical_notes n where n.record_status = 'active' and n.status = 'draft' group by n.patient_id) d
   group by d.patient_id
$$;
revoke all on function public.care_attention(date, text) from public, anon;
grant execute on function public.care_attention(date, text) to authenticated;

-- ================================================================================================================ 2. emergency card
create function app.care_require_manager(p_patient uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not app.has_patient_access(p_patient, 'manage') or not app.has_patient_access(p_patient, 'write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create table public.emergency_cards (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null unique references public.patients (id) on delete restrict,
  enabled boolean not null default false,
  -- SHA-256 of the link token: the token itself is shown once, when it is made, and never stored
  token_hash bytea unique,
  -- the patient's opt-in: conditions and medicines marked sensitive appear on the card only when this is on
  include_sensitive boolean not null default false,
  include_contacts boolean not null default true,
  enabled_at timestamptz,
  disabled_at timestamptz,
  regenerated_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) default auth.uid(),
  unique (id, patient_id),
  check (not enabled or token_hash is not null)
);
create trigger emergency_cards_touch before update on public.emergency_cards for each row execute function app.touch_updated_at();
create trigger emergency_cards_audit after insert or update on public.emergency_cards for each row execute function app.audit_row('token_hash');
alter table public.emergency_cards enable row level security;
create policy emergency_cards_sel on public.emergency_cards for select to authenticated using (app.has_patient_access(patient_id, 'manage'));
-- no insert/update/delete grant: the definer functions below are the only writers
grant select (id, patient_id, enabled, include_sensitive, include_contacts, enabled_at, disabled_at, regenerated_at, created_at, updated_at)
  on public.emergency_cards to authenticated;
grant all on public.emergency_cards to service_role;

-- who opened (or tried to open) the link: shown to the patient, never the client address or browser
create table public.emergency_access_logs (
  id bigint generated always as identity primary key,
  patient_id uuid not null references public.patients (id) on delete restrict,
  event text not null check (event in ('viewed', 'blocked')),
  ip_hash text,
  user_agent text,
  at timestamptz not null default now()
);
create index emergency_access_logs_idx on public.emergency_access_logs (patient_id, at desc);
alter table public.emergency_access_logs enable row level security;
create policy emergency_access_logs_sel on public.emergency_access_logs for select to authenticated using (app.has_patient_access(patient_id, 'manage'));
grant select (id, patient_id, event, at) on public.emergency_access_logs to authenticated;
grant all on public.emergency_access_logs to service_role;

-- rate limit of the public link, per client address (no patient attached: an unknown token has none)
create table public.emergency_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  ok boolean not null,
  at timestamptz not null default now()
);
create index emergency_attempts_idx on public.emergency_attempts (ip_hash, at);
alter table public.emergency_attempts enable row level security;     -- no policy, no grant: the viewer function only
grant all on public.emergency_attempts to service_role;

-- turns the link on (a new token). Returns the token: the only time it can be read.
create function public.emergency_enable(p_patient uuid, p_include_sensitive boolean default false, p_include_contacts boolean default true) returns text
language plpgsql security definer set search_path = '' as $$
declare v_token text := app.b64url(extensions.gen_random_bytes(24)); c public.emergency_cards;
begin
  perform app.care_require_manager(p_patient);
  select * into c from public.emergency_cards where patient_id = p_patient for update;
  if found and c.enabled then raise exception 'already_enabled' using errcode = '22023'; end if;
  if not found then
    insert into public.emergency_cards (patient_id, enabled, token_hash, include_sensitive, include_contacts, enabled_at)
    values (p_patient, true, app.sha256(v_token), coalesce(p_include_sensitive, false), coalesce(p_include_contacts, true), now());
  else
    update public.emergency_cards
       set enabled = true, token_hash = app.sha256(v_token), enabled_at = now(), disabled_at = null,
           include_sensitive = coalesce(p_include_sensitive, include_sensitive), include_contacts = coalesce(p_include_contacts, include_contacts)
     where patient_id = p_patient;
  end if;
  return v_token;
end $$;

-- a new token: the old link and every QR printed from it stop working at once
create function public.emergency_regenerate(p_patient uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_token text := app.b64url(extensions.gen_random_bytes(24)); c public.emergency_cards;
begin
  perform app.care_require_manager(p_patient);
  select * into c from public.emergency_cards where patient_id = p_patient for update;
  if not found or not c.enabled then raise exception 'not_enabled' using errcode = '22023'; end if;
  update public.emergency_cards set token_hash = app.sha256(v_token), regenerated_at = now() where patient_id = p_patient;
  return v_token;
end $$;

create function public.emergency_disable(p_patient uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.care_require_manager(p_patient);
  update public.emergency_cards set enabled = false, disabled_at = now() where patient_id = p_patient and enabled;
  if not found then raise exception 'not_enabled' using errcode = '22023'; end if;
end $$;

create function public.emergency_set_options(p_patient uuid, p_include_sensitive boolean, p_include_contacts boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.care_require_manager(p_patient);
  if p_include_sensitive is null or p_include_contacts is null then raise exception 'invalid options' using errcode = '22023'; end if;
  insert into public.emergency_cards (patient_id, include_sensitive, include_contacts) values (p_patient, p_include_sensitive, p_include_contacts)
  on conflict (patient_id) do update set include_sensitive = excluded.include_sensitive, include_contacts = excluded.include_contacts;
end $$;

-- Is this the current token of the file's card? (the printable PDF only draws a QR for a token that is really current)
create function public.emergency_token_ok(p_patient uuid, p_token text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.care_require_manager(p_patient);
  return exists (select 1 from public.emergency_cards c
                  where c.patient_id = p_patient and c.enabled and p_token is not null and c.token_hash = app.sha256(p_token));
end $$;

-- The card itself: the one place that decides what the emergency card shows. The public link (emergency_view) and the owner's
-- own page and PDF (emergency_preview) both read it, so the page shows exactly what the link shows. It never leaves the patient's
-- file, carries no record ids, and leaves out anything marked sensitive unless the patient opted in.
create function app.emergency_card_json(p_patient uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'patient', jsonb_build_object('full_name', p.full_name, 'full_name_en', p.full_name_en, 'sex', p.sex, 'date_of_birth', p.date_of_birth,
                                  'blood_abo', p.blood_abo, 'blood_rh', p.blood_rh, 'blood_group_verified', p.blood_group_verified,
                                  'allergy_assertion', p.allergy_assertion),
    'allergies', coalesce((select jsonb_agg(jsonb_build_object('substance', a.substance, 'category', a.category, 'reaction', a.reaction, 'severity', a.severity)
                                             order by a.substance)
                             from public.allergies a
                            where a.patient_id = p.id and a.status = 'active' and a.record_status = 'active' and a.certainty <> 'refuted'), '[]'),
    'conditions', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'severity', x.severity) order by x.name)
                              from public.conditions x
                             where x.patient_id = p.id and x.record_status = 'active' and x.certainty <> 'refuted'
                               and x.category in ('chronic', 'congenital', 'genetic', 'disability')
                               and x.clinical_status in ('active', 'recurrence', 'inactive', 'remission')
                               and (not x.sensitive or coalesce(c.include_sensitive, false))), '[]'),
    'medications', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(m.name_generic, m.name_brand), 'strength', m.strength,
                                                                 'dose', m.dose, 'frequency', m.frequency) order by coalesce(m.name_generic, m.name_brand))
                               from public.medications m
                              where m.patient_id = p.id and m.record_status = 'active' and m.status in ('active', 'on_hold') and m.long_term
                                and (not m.sensitive or coalesce(c.include_sensitive, false))), '[]'),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('kind', d.kind, 'name', d.name, 'body_site', d.body_site, 'mri_safety', d.mri_safety)
                                          order by d.implanted_on desc nulls last)
                           from public.patient_devices d
                          where d.patient_id = p.id and d.record_status = 'active' and d.status = 'in_place'), '[]'),
    'assertions', coalesce((select jsonb_build_object('none_chronic_conditions', h.none_chronic_conditions,
                                                      'none_long_term_medications', h.none_long_term_medications, 'none_devices', h.none_devices)
                              from public.patient_health_profile h where h.patient_id = p.id),
                           jsonb_build_object('none_chronic_conditions', false, 'none_long_term_medications', false, 'none_devices', false)),
    'contacts', case when coalesce(c.include_contacts, true) then coalesce((select jsonb_agg(jsonb_build_object('full_name', e.full_name, 'relation', e.relation,
                                                                                               'phone', e.phone, 'is_legal_representative', e.is_legal_representative)
                                                                            order by e.is_legal_representative desc, e.created_at)
                                                              from public.emergency_contacts e where e.patient_id = p.id), '[]')
                    else '[]'::jsonb end,
    'include_sensitive', coalesce(c.include_sensitive, false))
    from public.patients p left join public.emergency_cards c on c.patient_id = p.id
   where p.id = p_patient
$$;

-- The owner's own view of the card as it stands now (same content as the link), for the page and the printable PDF.
create function public.emergency_preview(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not app.has_patient_access(p_patient, 'read') then raise exception 'forbidden' using errcode = '42501'; end if;
  return app.emergency_card_json(p_patient);
end $$;

-- The public side (web server only). Answers with the card or with {"status": "unavailable" | "throttled"}: a wrong, disabled,
-- regenerated or deleted-file link all look the same. 10 wrong tries or 60 requests per client address in 15 minutes throttle it.
create function public.emergency_view(p_token text, p_ip_hash text, p_user_agent text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ip text := left(coalesce(p_ip_hash, '-'), 128);
  v_fail int; v_all int;
  c public.emergency_cards; p public.patients;
begin
  delete from public.emergency_attempts where at < now() - interval '1 day';
  select count(*) filter (where not a.ok), count(*) into v_fail, v_all
    from public.emergency_attempts a where a.ip_hash = v_ip and a.at > now() - interval '15 minutes';
  if v_fail >= 10 or v_all >= 60 then return jsonb_build_object('status', 'throttled'); end if;

  if p_token is null or length(p_token) < 20 or length(p_token) > 128 then
    insert into public.emergency_attempts (ip_hash, ok) values (v_ip, false);
    return jsonb_build_object('status', 'unavailable');
  end if;
  select * into c from public.emergency_cards where token_hash = app.sha256(p_token);
  if not found then
    insert into public.emergency_attempts (ip_hash, ok) values (v_ip, false);
    return jsonb_build_object('status', 'unavailable');
  end if;
  select * into p from public.patients where id = c.patient_id;
  if not c.enabled or p.deletion_requested_at is not null then
    insert into public.emergency_attempts (ip_hash, ok) values (v_ip, false);
    insert into public.emergency_access_logs (patient_id, event, ip_hash, user_agent) values (c.patient_id, 'blocked', v_ip, left(p_user_agent, 300));
    return jsonb_build_object('status', 'unavailable');
  end if;

  insert into public.emergency_attempts (ip_hash, ok) values (v_ip, true);
  insert into public.emergency_access_logs (patient_id, event, ip_hash, user_agent) values (c.patient_id, 'viewed', v_ip, left(p_user_agent, 300));
  return jsonb_build_object('status', 'ok', 'card', app.emergency_card_json(c.patient_id));
end $$;

revoke all on function app.care_require_manager(uuid) from public, anon, authenticated;
revoke all on function public.emergency_enable(uuid, boolean, boolean) from public, anon;
revoke all on function public.emergency_regenerate(uuid) from public, anon;
revoke all on function public.emergency_disable(uuid) from public, anon;
revoke all on function public.emergency_set_options(uuid, boolean, boolean) from public, anon;
revoke all on function public.emergency_token_ok(uuid, text) from public, anon;
revoke all on function app.emergency_card_json(uuid) from public, anon, authenticated;
revoke all on function public.emergency_preview(uuid) from public, anon;
grant execute on function public.emergency_preview(uuid) to authenticated;
revoke all on function public.emergency_view(text, text, text) from public, anon, authenticated;
grant execute on function public.emergency_enable(uuid, boolean, boolean) to authenticated;
grant execute on function public.emergency_regenerate(uuid) to authenticated;
grant execute on function public.emergency_disable(uuid) to authenticated;
grant execute on function public.emergency_set_options(uuid, boolean, boolean) to authenticated;
grant execute on function public.emergency_token_ok(uuid, text) to authenticated;
grant execute on function public.emergency_view(text, text, text) to service_role;

-- ================================================================================================================ 4. members by invite
create table public.patient_invites (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  invited_email text not null check (invited_email = lower(btrim(invited_email)) and invited_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(invited_email) <= 254),
  -- viewer: reads the file. editor: reads and writes records. Neither can share, manage members or delete the file.
  access text not null check (access in ('viewer', 'editor')),
  -- SHA-256 of the one-time link token (shown once, never stored)
  token_hash bytea not null unique,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id),
  unique (id, patient_id),
  check (expires_at > created_at and expires_at <= created_at + interval '7 days'),
  check (accepted_at is null or revoked_at is null)
);
create unique index patient_invites_pending_idx on public.patient_invites (patient_id, invited_email) where accepted_at is null and revoked_at is null;
create index patient_invites_patient_idx on public.patient_invites (patient_id, created_at desc);
create trigger patient_invites_audit after insert or update on public.patient_invites for each row execute function app.audit_row('token_hash');
alter table public.patient_invites enable row level security;
create policy patient_invites_sel on public.patient_invites for select to authenticated using (app.has_patient_access(patient_id, 'manage'));
grant select (id, patient_id, invited_email, access, created_by, created_at, expires_at, accepted_at, accepted_by, revoked_at, revoked_by)
  on public.patient_invites to authenticated;
grant all on public.patient_invites to service_role;

create function public.member_invite_create(p_patient uuid, p_email text, p_access text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_token text := app.b64url(extensions.gen_random_bytes(24)); v_user uuid;
begin
  perform app.care_require_manager(p_patient);
  if p_access not in ('viewer', 'editor') then raise exception 'invalid access' using errcode = '22023'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'invalid_email' using errcode = '22023'; end if;
  select u.id into v_user from auth.users u where lower(u.email) = v_email;
  if v_user is not null and exists (select 1 from public.patient_members m where m.patient_id = p_patient and m.user_id = v_user and m.revoked_at is null) then
    raise exception 'already_member' using errcode = '22023';
  end if;
  if (select count(*) from public.patient_invites i where i.patient_id = p_patient and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()) >= 20 then
    raise exception 'too_many_invites' using errcode = '22023';
  end if;
  -- a new invite to the same address replaces the one still waiting
  update public.patient_invites set revoked_at = now(), revoked_by = auth.uid()
   where patient_id = p_patient and invited_email = v_email and accepted_at is null and revoked_at is null;
  insert into public.patient_invites (patient_id, invited_email, access, token_hash, expires_at)
  values (p_patient, v_email, p_access, app.sha256(v_token), now() + interval '7 days');
  return v_token;
end $$;

create function public.member_invite_revoke(p_invite uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_patient uuid;
begin
  select patient_id into v_patient from public.patient_invites where id = p_invite;
  if v_patient is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app.care_require_manager(v_patient);
  update public.patient_invites set revoked_at = now(), revoked_by = auth.uid() where id = p_invite and accepted_at is null and revoked_at is null;
  if not found then raise exception 'invite_unavailable' using errcode = '22023'; end if;
end $$;

-- What the page shows before accepting. The file's name is shown only to the account the invite was written for.
create function public.member_invite_preview(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i public.patient_invites; v_email text; p public.patients;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_token is null or length(p_token) < 20 or length(p_token) > 128 then return jsonb_build_object('status', 'unavailable'); end if;
  select * into i from public.patient_invites where token_hash = app.sha256(p_token);
  if not found or i.accepted_at is not null or i.revoked_at is not null or i.expires_at <= now() then return jsonb_build_object('status', 'unavailable'); end if;
  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  if v_email is distinct from i.invited_email then return jsonb_build_object('status', 'email_mismatch'); end if;
  select * into p from public.patients where id = i.patient_id;
  if p.deletion_requested_at is not null then return jsonb_build_object('status', 'unavailable'); end if;
  return jsonb_build_object('status', 'ok', 'access', i.access, 'patient_name', p.full_name, 'patient_name_en', p.full_name_en, 'expires_at', i.expires_at);
end $$;

create function public.member_invite_accept(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare i public.patient_invites; v_email text; v_n int; v_pending timestamptz;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_token is null or length(p_token) < 20 or length(p_token) > 128 then raise exception 'invite_unavailable' using errcode = '22023'; end if;
  select * into i from public.patient_invites where token_hash = app.sha256(p_token) for update;
  if not found or i.accepted_at is not null or i.revoked_at is not null or i.expires_at <= now() then raise exception 'invite_unavailable' using errcode = '22023'; end if;
  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  if v_email is distinct from i.invited_email then raise exception 'email_mismatch' using errcode = '42501'; end if;
  select p.deletion_requested_at into v_pending from public.patients p where p.id = i.patient_id;
  if v_pending is not null then raise exception 'invite_unavailable' using errcode = '22023'; end if;
  -- a member who was revoked comes back with the new access; an active member (any role) is never touched
  insert into public.patient_members as pm (patient_id, user_id, role, can_write, can_share, invited_by)
  values (i.patient_id, auth.uid(), 'caregiver', i.access = 'editor', false, i.created_by)
  on conflict (patient_id, user_id) do update
     set role = 'caregiver', can_write = excluded.can_write, can_share = false, invited_by = excluded.invited_by, revoked_at = null, created_at = now()
   where pm.revoked_at is not null;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'already_member' using errcode = '22023'; end if;
  update public.patient_invites set accepted_at = now(), accepted_by = auth.uid() where id = i.id;
  return i.patient_id;
end $$;

-- The members of a file with their names and e-mail addresses: owners and guardians only.
create function public.member_list(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not app.has_patient_access(p_patient, 'manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
            'user_id', m.user_id, 'full_name', coalesce(nullif(btrim(pr.full_name), ''), split_part(u.email, '@', 1)), 'email', u.email,
            'role', m.role, 'can_write', m.can_write, 'can_share', m.can_share, 'joined_at', m.created_at, 'revoked_at', m.revoked_at)
            order by (m.revoked_at is not null), (m.role in ('owner', 'guardian')) desc, m.created_at)
       from public.patient_members m
       join auth.users u on u.id = m.user_id
       left join public.profiles pr on pr.id = m.user_id
      where m.patient_id = p_patient), '[]'::jsonb);
end $$;

-- Revokes a caregiver or clinician member (never an owner or guardian, never oneself): access ends at once, because every
-- policy asks patient_members.
create function public.member_revoke(p_patient uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.patient_members;
begin
  perform app.care_require_manager(p_patient);
  select * into m from public.patient_members where patient_id = p_patient and user_id = p_user and revoked_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if m.role in ('owner', 'guardian') or p_user = auth.uid() then raise exception 'cannot_revoke_manager' using errcode = '42501'; end if;
  update public.patient_members set revoked_at = now() where patient_id = p_patient and user_id = p_user;
end $$;

-- A caregiver leaves a file they were invited to.
create function public.member_leave(p_patient uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  update public.patient_members set revoked_at = now()
   where patient_id = p_patient and user_id = auth.uid() and revoked_at is null and role in ('caregiver', 'clinician');
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

revoke all on function public.member_invite_create(uuid, text, text) from public, anon;
revoke all on function public.member_invite_revoke(uuid) from public, anon;
revoke all on function public.member_invite_preview(text) from public, anon;
revoke all on function public.member_invite_accept(text) from public, anon;
revoke all on function public.member_list(uuid) from public, anon;
revoke all on function public.member_revoke(uuid, uuid) from public, anon;
revoke all on function public.member_leave(uuid) from public, anon;
grant execute on function public.member_invite_create(uuid, text, text) to authenticated;
grant execute on function public.member_invite_revoke(uuid) to authenticated;
grant execute on function public.member_invite_preview(text) to authenticated;
grant execute on function public.member_invite_accept(text) to authenticated;
grant execute on function public.member_list(uuid) to authenticated;
grant execute on function public.member_revoke(uuid, uuid) to authenticated;
grant execute on function public.member_leave(uuid) to authenticated;

-- ================================================================================================================ the full export
-- Same as 0028, but the invite and emergency-link tables (hashes of secrets, access logs) are not part of a patient's export.
create or replace function public.patient_export_data(p_patient uuid) returns jsonb
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
                             'medical_share_sessions', 'medical_share_access_logs', 'share_notes', 'share_attempts', 'share_contributors',
                             'patient_invites', 'emergency_cards', 'emergency_access_logs')
     order by c.relname
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x where x.patient_id = $1', t) into v_part using p_patient;
    v_out := v_out || jsonb_build_object(t, v_part);
  end loop;
  v_out := v_out || jsonb_build_object('catalogs', jsonb_build_object(
    'observation_types', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'category', x.category, 'value_kind', x.value_kind,
                                                                      'name_ar', x.name_ar, 'name_en', x.name_en, 'default_unit', x.default_unit)), '[]')
                            from public.observation_types x),
    'medical_specialties', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'name_ar', x.name_ar, 'name_en', x.name_en)), '[]')
                              from public.medical_specialties x)));
  return v_out;
end $$;
