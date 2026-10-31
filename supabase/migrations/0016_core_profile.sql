-- 0016: the core file (الملف الأساسي) — what every section needs to know about the patient, entered once.
--
-- * Height and weight stay measurements (observations): the core file shows the latest of each and BMI is derived,
--   so there is one source and no copy to drift.
-- * Long-term medications are flagged on the medication itself.
-- * Devices and implants (valves, pacemakers, stents, joint replacements…) get their own table.
-- * Lifestyle (tobacco with amounts, alcohol, activity, occupation, exposures) and pregnancy / breastfeeding live in one
--   health-profile row per patient instead of being typed in as "diseases".
-- * What matters to each specialty (e.g. anticoagulants or a heart valve for the dentist) is data in
--   public.context_highlights, matched by the application against the record and shown as a reminder — never a diagnosis.
-- * share_context gives the clinician the same core context the patient sees.

-- ---------------------------------------------------------------- long-term medications
alter table public.medications add column long_term boolean not null default false;

-- ---------------------------------------------------------------- devices and implants
create table public.patient_devices (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  encounter_id uuid,
  kind text not null check (kind in (
    'prosthetic_heart_valve', 'pacemaker', 'icd', 'coronary_stent', 'vascular_graft', 'joint_replacement', 'spinal_hardware',
    'fracture_hardware', 'cochlear_implant', 'breast_implant', 'neurostimulator', 'shunt', 'insulin_pump', 'iud', 'dental_implant',
    'other')),
  name text check (length(name) <= 200),
  body_site text check (length(body_site) <= 200),
  implanted_on date,
  date_precision text not null default 'day' check (date_precision in ('day', 'month', 'year', 'approx')),
  status text not null default 'in_place' check (status in ('in_place', 'removed')),
  removed_on date,
  mri_safety text not null default 'unknown' check (mri_safety in ('safe', 'conditional', 'unsafe', 'unknown')),
  manufacturer text check (length(manufacturer) <= 200),
  notes text check (length(notes) <= 2000),
  unique (id, patient_id),
  foreign key (encounter_id, patient_id) references public.encounters (id, patient_id),
  check (removed_on is null or implanted_on is null or removed_on >= implanted_on),
  check (status = 'removed' or removed_on is null)
);
create index patient_devices_patient_idx on public.patient_devices (patient_id, status);

alter table public.patient_devices
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
  add constraint patient_devices_invalid_reason_chk check (record_status = 'active' or length(btrim(coalesce(invalidated_reason, ''))) > 0);
create trigger patient_devices_guard before insert or update on public.patient_devices for each row execute function app.clinical_guard();
create trigger patient_devices_sex_guard before insert or update on public.patient_devices for each row execute function app.sex_guard();
create trigger patient_devices_audit after insert or update on public.patient_devices for each row execute function app.audit_row();

-- ---------------------------------------------------------------- lifestyle + pregnancy (one row per patient)
create table public.patient_health_profile (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null unique references public.patients (id) on delete restrict,
  tobacco_status text not null default 'unknown' check (tobacco_status in ('unknown', 'never', 'former', 'current')),
  tobacco_types text[] not null default '{}'
    check (tobacco_types <@ array['cigarettes', 'waterpipe', 'cigars', 'pipe', 'smokeless', 'e_cigarette']::text[]),
  cigarettes_per_day numeric(5, 1) check (cigarettes_per_day between 0 and 200),
  waterpipe_per_week numeric(5, 1) check (waterpipe_per_week between 0 and 100),
  tobacco_start_year int check (tobacco_start_year between 1900 and 2100),
  tobacco_quit_year int check (tobacco_quit_year between 1900 and 2100),
  alcohol_status text not null default 'unknown' check (alcohol_status in ('unknown', 'none', 'occasional', 'regular', 'former')),
  alcohol_units_per_week numeric(5, 1) check (alcohol_units_per_week between 0 and 300),
  activity_level text check (activity_level in ('sedentary', 'light', 'moderate', 'active')),
  occupation text check (length(occupation) <= 200),
  exposures text check (length(exposures) <= 1000),
  diet text check (length(diet) <= 500),
  pregnancy_status text not null default 'unknown' check (pregnancy_status in ('unknown', 'not_pregnant', 'pregnant', 'not_applicable')),
  pregnancy_edd date,
  breastfeeding boolean,
  -- explicit "none known" statements: an empty list is never read as "none" (as with allergies)
  none_chronic_conditions boolean not null default false,
  none_long_term_medications boolean not null default false,
  none_devices boolean not null default false,
  notes text check (length(notes) <= 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) default auth.uid(),
  check (tobacco_quit_year is null or tobacco_start_year is null or tobacco_quit_year >= tobacco_start_year),
  check (tobacco_status in ('former', 'current') or (cardinality(tobacco_types) = 0 and cigarettes_per_day is null and waterpipe_per_week is null)),
  check (tobacco_status = 'former' or tobacco_quit_year is null),
  check (pregnancy_status = 'pregnant' or pregnancy_edd is null)
);

-- pregnancy and breastfeeding do not apply to a patient recorded as male (and a recorded pregnancy blocks that change)
create function app.health_profile_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_sex text;
begin
  select p.sex into v_sex from public.patients p where p.id = new.patient_id;
  if v_sex = 'male' and (new.pregnancy_status = 'pregnant' or coalesce(new.breastfeeding, false)) then
    raise exception 'pregnancy_not_applicable' using errcode = '22023',
      hint = 'Pregnancy and breastfeeding do not apply to the sex recorded for this patient.';
  end if;
  return new;
end $$;
create trigger patient_health_profile_touch before insert or update on public.patient_health_profile for each row execute function app.touch_row();
create trigger patient_health_profile_guard before insert or update on public.patient_health_profile for each row execute function app.health_profile_guard();
create trigger patient_health_profile_audit after insert or update on public.patient_health_profile for each row execute function app.audit_row();

create function app.patients_pregnancy_sex_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.sex = 'male' and exists (select 1 from public.patient_health_profile h where h.patient_id = new.id
                                    and (h.pregnancy_status = 'pregnant' or coalesce(h.breastfeeding, false))) then
    raise exception 'pregnancy_recorded' using errcode = '22023',
      hint = 'A pregnancy or breastfeeding is recorded for this patient; update it first.';
  end if;
  return new;
end $$;
create trigger patients_pregnancy_sex before update of sex on public.patients for each row execute function app.patients_pregnancy_sex_guard();

-- ---------------------------------------------------------------- what matters to each specialty (reviewable data)
create table public.context_highlights (
  id uuid primary key default gen_random_uuid(),
  specialty_code text references public.medical_specialties (code) on update cascade on delete cascade,   -- null = every specialty
  source text not null check (source in ('condition', 'medication', 'allergy', 'device', 'pregnancy', 'tobacco')),
  -- condition / medication / allergy: keywords (Arabic and English), matched without diacritics against the record's name
  keywords text[] not null default '{}',
  -- device: device kinds
  device_kinds text[] not null default '{}',
  level text not null default 'warn' check (level in ('info', 'warn', 'bad')),
  message_ar text not null check (length(message_ar) between 3 and 300),
  message_en text not null check (length(message_en) between 3 and 300),
  sort int not null default 0,
  is_active boolean not null default true,
  reviewed_by_clinician boolean not null default false,
  check (source not in ('condition', 'medication', 'allergy') or cardinality(keywords) > 0),
  check (source <> 'device' or cardinality(device_kinds) > 0)
);
create index context_highlights_spec_idx on public.context_highlights (specialty_code) where is_active;

insert into public.context_highlights (specialty_code, source, keywords, device_kinds, level, message_ar, message_en, sort)
select v.spec, v.src, v.kw, v.dk, v.lvl, v.ar, v.en, v.srt
  from (values
  ('dentistry', 'medication', array['warfarin','وارفارين','apixaban','أبيكسابان','eliquis','rivaroxaban','ريفاروكسابان','xarelto','dabigatran','دابيغاتران','edoxaban',
     'clopidogrel','كلوبيدوجريل','plavix','ticagrelor','prasugrel','aspirin','أسبرين','اسبرين','heparin','هيبارين','enoxaparin','إينوكسابارين','clexane'],
     '{}'::text[], 'bad', 'يتناول مضاد تخثر أو مضاد صفيحات: خطر نزف في الخلع والجراحة — راجع الطبيب المعالج قبل الإجراء.',
     'On an anticoagulant or antiplatelet: bleeding risk with extractions and surgery — check with the treating physician first.', 10),
  ('dentistry', 'medication', array['alendronate','ألندرونات','fosamax','risedronate','ريزدرونات','ibandronate','zoledron','زوليدرون','denosumab','دينوسوماب','prolia','xgeva'],
     '{}'::text[], 'bad', 'بايفوسفونات أو دينوسوماب: خطر تنخّر عظم الفك بعد الخلع.', 'Bisphosphonate or denosumab: risk of jaw osteonecrosis after extraction.', 20),
  ('dentistry', 'condition', array['aortic stenosis','تضيق الابهر','تضيق خلقي في الشريان الابهر','الشريان الابهر','valve','صمام','endocarditis','التهاب الشغاف',
     'congenital heart','قلب خلقي','قلبي خلقي','rheumatic heart','روماتيزم القلب','حمى روماتيزمية'],
     '{}'::text[], 'warn', 'مرض قلبي أو صمامي: راجع الحاجة لوقاية بالمضاد الحيوي قبل الإجراءات التي تسبب نزفاً.',
     'Heart or valve disease: review the need for antibiotic prophylaxis before procedures that cause bleeding.', 30),
  ('dentistry', 'device', '{}'::text[], array['prosthetic_heart_valve'], 'bad', 'صمام قلب صناعي: الوقاية من التهاب الشغاف قبل الإجراءات التي تسبب نزفاً.',
     'Prosthetic heart valve: endocarditis prophylaxis before procedures that cause bleeding.', 31),
  ('dentistry', 'device', '{}'::text[], array['pacemaker','icd'], 'warn', 'منظم أو مزيل رجفان قلبي: انتبه للأجهزة الكهربائية (الكي الكهربائي، بعض أجهزة التنظيف).',
     'Pacemaker or ICD: take care with electrical devices (electrosurgery, some scalers).', 32),
  ('dentistry', 'condition', array['diabet','سكري','السكري'], '{}'::text[], 'warn', 'سكري: التئام أبطأ وخطر عدوى أعلى؛ تحقق من ضبط السكر.',
     'Diabetes: slower healing and higher infection risk; check glucose control.', 40),
  ('dentistry', 'condition', array['hemophilia','هيموفيليا','ناعور','von willebrand','فون ويلبراند','thrombocytopenia','نقص الصفيحات','bleeding disorder','اضطراب نزف','تخثر'],
     '{}'::text[], 'bad', 'اضطراب نزف أو تخثر: خطر نزف في الإجراءات.', 'Bleeding or clotting disorder: bleeding risk with procedures.', 50),
  ('dentistry', 'allergy', array['penicillin','بنسلين','البنسلين','amoxicillin','اموكسيسيلين','أموكسيسيلين','augmentin','اوجمنتين'],
     '{}'::text[], 'bad', 'حساسية البنسلين: اختر مضاداً حيوياً بديلاً.', 'Penicillin allergy: choose an alternative antibiotic.', 60),
  ('dentistry', 'allergy', array['lidocaine','ليدوكائين','articaine','ارتيكائين','أرتيكائين','mepivacaine','anesthe','anaesthe','مخدر','بنج','تخدير'],
     '{}'::text[], 'bad', 'حساسية من مخدر موضعي: راجع نوع المخدر قبل الحقن.', 'Local anaesthetic allergy: check the anaesthetic before injecting.', 61),
  ('dentistry', 'allergy', array['latex','لاتكس','مطاط'], '{}'::text[], 'warn', 'حساسية اللاتكس: استخدم قفازات وأدوات خالية منه.', 'Latex allergy: use latex-free gloves and materials.', 62),
  ('dentistry', 'pregnancy', '{}'::text[], '{}'::text[], 'warn', 'حامل: راجع الحاجة للأشعة واختيار الأدوية.', 'Pregnant: review the need for X-rays and the choice of medicines.', 70),
  ('dentistry', 'tobacco', '{}'::text[], '{}'::text[], 'info', 'مدخّن: التئام أبطأ وخطر أعلى لجفاف السنخ بعد الخلع ولأمراض اللثة.',
     'Smoker: slower healing, higher risk of dry socket after extraction and of gum disease.', 80),
  ('radiology', 'pregnancy', '{}'::text[], '{}'::text[], 'bad', 'حامل: راجع مبررات الأشعة المؤينة والبدائل.', 'Pregnant: review the justification for ionising imaging and alternatives.', 10),
  ('radiology', 'device', '{}'::text[], array['pacemaker','icd','cochlear_implant','neurostimulator','insulin_pump'], 'bad',
     'جهاز مزروع: تحقق من أمانه في الرنين المغناطيسي قبل الحجز.', 'Implanted device: check its MRI safety before booking.', 20),
  ('radiology', 'allergy', array['iodine','يود','contrast','صبغة','gadolinium','غادولينيوم'], '{}'::text[], 'bad',
     'حساسية من الصبغة أو اليود: راجع قبل التصوير بالصبغة.', 'Contrast or iodine allergy: review before contrast imaging.', 30)
  ) v(spec, src, kw, dk, lvl, ar, en, srt)
 where exists (select 1 from public.medical_specialties m where m.code = v.spec);

-- ---------------------------------------------------------------- access
do $$
declare t text;
begin
  foreach t in array array['patient_devices', 'patient_health_profile'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app.has_patient_access(patient_id))', t || '_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.has_patient_access(patient_id, ''write''))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.has_patient_access(patient_id, ''write'')) with check (app.has_patient_access(patient_id, ''write''))', t || '_upd', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
alter table public.context_highlights enable row level security;
create policy context_highlights_read on public.context_highlights for select to authenticated using (true);
create policy context_highlights_admin on public.context_highlights for all to authenticated using (app.is_admin()) with check (app.is_admin());
grant select, insert, update, delete on public.context_highlights to authenticated;
grant all on public.context_highlights to service_role;

-- ---------------------------------------------------------------- the clinician sees the same core context
create function public.share_context(p_session_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_share uuid; v_sid uuid; v_st text;
  s public.medical_shares;
  p public.patients;
  v_codes text[];
begin
  select a.o_share_id, a.o_session_id, a.o_status into v_share, v_sid, v_st from app.resolve_share_session(p_session_token) a;
  if v_st <> 'ok' then return jsonb_build_object('status', 'expired'); end if;
  select * into s from public.medical_shares where id = v_share;
  select * into p from public.patients where id = s.patient_id;
  select coalesce(array_agg(m.code), '{}') into v_codes from public.medical_specialties m where m.id = any (s.specialty_ids);
  return jsonb_build_object(
    'status', 'ok',
    'specialties', to_jsonb(case when s.scope_kind = 'specialty' then v_codes else null end),
    'patient', jsonb_build_object('date_of_birth', p.date_of_birth, 'sex', p.sex, 'blood_abo', p.blood_abo, 'blood_rh', p.blood_rh,
                                  'blood_group_verified', p.blood_group_verified, 'allergy_assertion', p.allergy_assertion),
    'body', (select jsonb_object_agg(x.code, jsonb_build_object('value', x.value_num, 'unit', x.unit, 'at', x.effective_at))
               from (select distinct on (t.code) t.code, o.value_num, o.unit, o.effective_at
                       from public.observations o join public.observation_types t on t.id = o.type_id
                      where o.patient_id = p.id and t.code in ('height', 'weight') and o.status in ('final', 'preliminary', 'amended')
                      order by t.code, o.effective_at desc) x),
    'allergies', coalesce((select jsonb_agg(jsonb_build_object('substance', a.substance, 'category', a.category, 'reaction', a.reaction,
                                                                'severity', a.severity, 'certainty', a.certainty) order by a.substance)
      from public.allergies a where a.patient_id = p.id and a.status = 'active' and a.record_status = 'active' and a.certainty <> 'refuted'), '[]'),
    'conditions', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'category', c.category, 'clinical_status', c.clinical_status,
                                                                 'certainty', c.certainty) order by c.name)
      from public.conditions c
      where c.patient_id = p.id and c.record_status = 'active' and c.certainty <> 'refuted'
        and c.category in ('chronic', 'congenital', 'genetic', 'disability')
        and c.clinical_status in ('active', 'recurrence', 'inactive', 'remission')
        and (not c.sensitive or s.include_sensitive)), '[]'),
    'medications', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(m.name_generic, m.name_brand), 'strength', m.strength,
                                                                  'dose', m.dose, 'frequency', m.frequency, 'long_term', m.long_term, 'status', m.status)
                                               order by m.long_term desc, coalesce(m.name_generic, m.name_brand))
      from public.medications m
      where m.patient_id = p.id and m.record_status = 'active' and m.status in ('active', 'on_hold') and (not m.sensitive or s.include_sensitive)), '[]'),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('kind', d.kind, 'name', d.name, 'body_site', d.body_site, 'implanted_on', d.implanted_on,
                                                              'date_precision', d.date_precision, 'mri_safety', d.mri_safety) order by d.implanted_on desc nulls last)
      from public.patient_devices d where d.patient_id = p.id and d.record_status = 'active' and d.status = 'in_place'), '[]'),
    'lifestyle', (select jsonb_build_object('tobacco_status', h.tobacco_status, 'tobacco_types', to_jsonb(h.tobacco_types),
                                            'cigarettes_per_day', h.cigarettes_per_day, 'waterpipe_per_week', h.waterpipe_per_week,
                                            'tobacco_start_year', h.tobacco_start_year, 'tobacco_quit_year', h.tobacco_quit_year,
                                            'alcohol_status', case when s.include_sensitive then h.alcohol_status end,
                                            'activity_level', h.activity_level,
                                            'pregnancy_status', case when p.sex <> 'male' then h.pregnancy_status end,
                                            'pregnancy_edd', case when p.sex <> 'male' then h.pregnancy_edd end,
                                            'breastfeeding', case when p.sex <> 'male' then h.breastfeeding end,
                                            'none_chronic_conditions', h.none_chronic_conditions,
                                            'none_long_term_medications', h.none_long_term_medications, 'none_devices', h.none_devices)
                    from public.patient_health_profile h where h.patient_id = p.id),
    'highlights', coalesce((select jsonb_agg(to_jsonb(r) - 'id' - 'is_active' order by r.sort)
      from public.context_highlights r
      where r.is_active and (r.specialty_code is null or s.scope_kind = 'full' or r.specialty_code = any (v_codes))), '[]'));
end $$;
revoke all on function public.share_context(text) from public;
grant execute on function public.share_context(text) to service_role;
