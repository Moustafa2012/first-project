-- 0020: treatment.
--
-- A local catalogue of dental procedures (no licensed codes), treatment plans with versions and alternatives, and the
-- planned treatments themselves with a life cycle enforced here:
--   proposed → planned → accepted → scheduled → in progress → completed, or referred / deferred / cancelled.
-- Nothing is completed before it was accepted, and a surgical treatment (an extraction, an implant…) is accepted and
-- completed only with an explicit confirmation. Completing a treatment records the procedure, updates the tooth chart
-- (a filling, a crown, an extracted tooth…), marks the problems it treated as treated, and closes the diagnosis once
-- nothing else is planned for it. Every change of status is kept in status_history.
-- A cost can be noted against a treatment: it is private. The patient sees every cost; a clinician adding through a
-- share sees only the costs they entered themselves; costs are never part of a shared bundle.

-- ---------------------------------------------------------------- catalogue
create table public.procedure_catalog (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  specialty_code text not null default 'dentistry',
  category text not null check (category in ('diagnostic', 'preventive', 'restorative', 'endodontic', 'periodontal', 'prosthodontic',
                                             'surgical', 'implant', 'orthodontic', 'other')),
  name_ar text not null check (length(btrim(name_ar)) >= 2),
  name_en text not null check (length(btrim(name_en)) >= 2),
  -- what it applies to: one tooth, surfaces of a tooth, several teeth, an arch, or the whole mouth
  scope text not null default 'tooth' check (scope in ('tooth', 'surfaces', 'teeth', 'arch', 'mouth')),
  surgical boolean not null default false,
  -- what completing it leaves on the chart: a finding on each tooth, and / or a new state of the tooth
  finding_kind text check (finding_kind in ('filling', 'sealant', 'inlay_onlay', 'veneer', 'crown', 'bridge_abutment', 'bridge_pontic',
                                            'root_canal', 'post_core', 'implant', 'denture', 'ortho_appliance')),
  material text check (material in ('amalgam', 'composite', 'glass_ionomer', 'ceramic', 'metal', 'zirconia', 'gold', 'temporary', 'other')),
  tooth_state text check (tooth_state in ('extracted')),
  -- the problems on the treated teeth (or surfaces) that it treats
  resolves text[] not null default '{}' check (resolves <@ array['caries', 'secondary_caries', 'fracture', 'crack', 'wear',
    'defective_restoration', 'periapical_lesion', 'abscess', 'recession', 'mobility', 'discoloration', 'hypoplasia']::text[]),
  local_code text check (length(local_code) <= 20),
  sort int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.procedure_catalog (code, category, name_ar, name_en, scope, surgical, finding_kind, material, tooth_state, resolves, sort) values
  ('exam_comprehensive',   'diagnostic',    'فحص شامل',                              'Comprehensive exam',                    'mouth',    false, null, null, null, '{}', 10),
  ('exam_periodic',        'diagnostic',    'فحص دوري',                              'Periodic exam',                         'mouth',    false, null, null, null, '{}', 11),
  ('exam_limited',         'diagnostic',    'فحص طارئ محدود',                        'Limited / emergency exam',              'tooth',    false, null, null, null, '{}', 12),
  ('xray_periapical',      'diagnostic',    'صورة أشعة ذروية',                       'Periapical X-ray',                      'tooth',    false, null, null, null, '{}', 13),
  ('xray_bitewing',        'diagnostic',    'صور أشعة مجنّحة',                       'Bitewing X-rays',                       'mouth',    false, null, null, null, '{}', 14),
  ('xray_panoramic',       'diagnostic',    'صورة أشعة بانورامية',                   'Panoramic X-ray',                       'mouth',    false, null, null, null, '{}', 15),
  ('cbct',                 'diagnostic',    'تصوير مقطعي مخروطي (CBCT)',             'CBCT scan',                             'mouth',    false, null, null, null, '{}', 16),
  ('vitality_test',        'diagnostic',    'اختبار حيوية اللب',                     'Pulp vitality test',                    'tooth',    false, null, null, null, '{}', 17),
  ('scaling',              'preventive',    'تنظيف الجير وتلميع',                    'Scaling & polishing',                   'mouth',    false, null, null, null, '{}', 20),
  ('fluoride',             'preventive',    'تطبيق الفلورايد',                       'Fluoride application',                  'mouth',    false, null, null, null, '{}', 21),
  ('sealant',              'preventive',    'سد الشقوق',                             'Fissure sealant',                       'tooth',    false, 'sealant', null, null, '{}', 22),
  ('hygiene_instruction',  'preventive',    'تعليمات العناية بالفم',                 'Oral hygiene instruction',              'mouth',    false, null, null, null, '{}', 23),
  ('night_guard',          'preventive',    'واقٍ ليلي',                             'Night guard',                           'arch',     false, null, null, null, '{}', 24),
  ('filling_composite',    'restorative',   'حشوة تجميلية (كومبوزيت)',              'Composite filling',                     'surfaces', false, 'filling', 'composite', null, '{caries,secondary_caries,defective_restoration,fracture}', 30),
  ('filling_amalgam',      'restorative',   'حشوة أملغم',                            'Amalgam filling',                       'surfaces', false, 'filling', 'amalgam', null, '{caries,secondary_caries,defective_restoration,fracture}', 31),
  ('filling_gic',          'restorative',   'حشوة زجاجية أيونومرية',                 'Glass-ionomer filling',                 'surfaces', false, 'filling', 'glass_ionomer', null, '{caries,secondary_caries,defective_restoration}', 32),
  ('filling_temporary',    'restorative',   'حشوة مؤقتة',                            'Temporary filling',                     'surfaces', false, 'filling', 'temporary', null, '{}', 33),
  ('inlay_onlay',          'restorative',   'حشوة ترصيعية (إنلاي / أونلاي)',         'Inlay / onlay',                         'surfaces', false, 'inlay_onlay', 'ceramic', null, '{caries,secondary_caries,defective_restoration,fracture}', 34),
  ('veneer',               'restorative',   'قشرة تجميلية',                          'Veneer',                                'tooth',    false, 'veneer', 'ceramic', null, '{discoloration,wear,fracture}', 35),
  ('bonding',              'restorative',   'ترميم تجميلي بالربط',                   'Cosmetic bonding',                      'surfaces', false, 'filling', 'composite', null, '{fracture,wear,discoloration}', 36),
  ('core_buildup',         'restorative',   'بناء قلب السن',                         'Core build-up',                         'tooth',    false, 'post_core', null, null, '{}', 37),
  ('post_core',            'restorative',   'وتد وقلب',                              'Post & core',                           'tooth',    false, 'post_core', null, null, '{}', 38),
  ('pulpotomy',            'endodontic',    'بتر اللب',                              'Pulpotomy',                             'tooth',    false, null, null, null, '{}', 40),
  ('pulpectomy',           'endodontic',    'استئصال اللب (سن لبني)',                'Pulpectomy (primary tooth)',            'tooth',    false, 'root_canal', null, null, '{abscess}', 41),
  ('root_canal',           'endodontic',    'علاج عصب (قناة الجذر)',                 'Root canal treatment',                  'tooth',    false, 'root_canal', null, null, '{abscess}', 42),
  ('root_canal_retreat',   'endodontic',    'إعادة علاج العصب',                      'Root canal retreatment',                'tooth',    false, 'root_canal', null, null, '{abscess}', 43),
  ('apicoectomy',          'endodontic',    'قطع ذروة الجذر',                        'Apicoectomy',                           'tooth',    true,  null, null, null, '{periapical_lesion,abscess}', 44),
  ('abscess_drainage',     'endodontic',    'تصريف خراج',                            'Abscess drainage',                      'tooth',    true,  null, null, null, '{abscess}', 45),
  ('root_planing',         'periodontal',   'تنظيف عميق وتسوية الجذور',             'Scaling & root planing',                'teeth',    false, null, null, null, '{}', 50),
  ('gum_graft',            'periodontal',   'ترقيع اللثة',                           'Gum graft',                             'teeth',    true,  null, null, null, '{recession}', 51),
  ('gingivectomy',         'periodontal',   'قصّ اللثة',                             'Gingivectomy',                          'teeth',    true,  null, null, null, '{}', 52),
  ('crown_lengthening',    'periodontal',   'إطالة التاج',                           'Crown lengthening',                     'tooth',    true,  null, null, null, '{}', 53),
  ('splinting',            'periodontal',   'تجبير الأسنان المتحركة',                'Splinting of mobile teeth',             'teeth',    false, null, null, null, '{mobility}', 54),
  ('perio_maintenance',    'periodontal',   'صيانة اللثة الدورية',                   'Periodontal maintenance',               'mouth',    false, null, null, null, '{}', 55),
  ('crown_ceramic',        'prosthodontic', 'تاج خزفي',                              'Ceramic crown',                         'tooth',    false, 'crown', 'ceramic', null, '{caries,secondary_caries,fracture,crack,wear,defective_restoration}', 60),
  ('crown_zirconia',       'prosthodontic', 'تاج زركونيا',                           'Zirconia crown',                        'tooth',    false, 'crown', 'zirconia', null, '{caries,secondary_caries,fracture,crack,wear,defective_restoration}', 61),
  ('crown_pfm',            'prosthodontic', 'تاج خزف على معدن',                      'Porcelain-fused-to-metal crown',        'tooth',    false, 'crown', 'metal', null, '{caries,secondary_caries,fracture,crack,wear,defective_restoration}', 62),
  ('crown_temporary',      'prosthodontic', 'تاج مؤقت',                              'Temporary crown',                       'tooth',    false, 'crown', 'temporary', null, '{}', 63),
  ('crown_stainless',      'prosthodontic', 'تاج ستانلس (للأطفال)',                  'Stainless-steel crown (children)',      'tooth',    false, 'crown', 'metal', null, '{caries,secondary_caries,fracture}', 64),
  ('bridge',               'prosthodontic', 'جسر ثابت',                              'Fixed bridge',                          'teeth',    false, null, null, null, '{}', 65),
  ('denture_complete',     'prosthodontic', 'طقم أسنان كامل',                        'Complete denture',                      'arch',     false, null, null, null, '{}', 66),
  ('denture_partial',      'prosthodontic', 'طقم أسنان جزئي',                        'Partial denture',                       'arch',     false, null, null, null, '{}', 67),
  ('denture_reline',       'prosthodontic', 'تبطين الطقم',                           'Denture reline',                        'arch',     false, null, null, null, '{}', 68),
  ('recement_crown',       'prosthodontic', 'إعادة تثبيت تاج',                       'Re-cement a crown',                     'tooth',    false, null, null, null, '{}', 69),
  ('extraction_simple',    'surgical',      'خلع بسيط',                              'Simple extraction',                     'tooth',    true,  null, null, 'extracted', '{caries,secondary_caries,fracture,crack,wear,defective_restoration,periapical_lesion,abscess,recession,mobility,discoloration,hypoplasia}', 70),
  ('extraction_surgical',  'surgical',      'خلع جراحي',                             'Surgical extraction',                   'tooth',    true,  null, null, 'extracted', '{caries,secondary_caries,fracture,crack,wear,defective_restoration,periapical_lesion,abscess,recession,mobility,discoloration,hypoplasia}', 71),
  ('wisdom_extraction',    'surgical',      'خلع ضرس العقل المطمور',                 'Impacted wisdom tooth removal',         'tooth',    true,  null, null, 'extracted', '{caries,secondary_caries,fracture,crack,wear,defective_restoration,periapical_lesion,abscess,recession,mobility,discoloration,hypoplasia}', 72),
  ('biopsy_oral',          'surgical',      'خزعة من الفم',                          'Oral biopsy',                           'mouth',    true,  null, null, null, '{}', 73),
  ('frenectomy',           'surgical',      'قصّ اللجام',                            'Frenectomy',                            'mouth',    true,  null, null, null, '{}', 74),
  ('alveoloplasty',        'surgical',      'تسوية العظم السنخي',                    'Alveoloplasty',                         'teeth',    true,  null, null, null, '{}', 75),
  ('implant_placement',    'implant',       'زرع غرسة سنية',                         'Implant placement',                     'tooth',    true,  'implant', null, null, '{}', 80),
  ('implant_crown',        'implant',       'تاج على الزرعة',                        'Implant crown',                         'tooth',    false, 'crown', 'zirconia', null, '{}', 81),
  ('bone_graft',           'implant',       'ترقيع العظم',                           'Bone graft',                            'teeth',    true,  null, null, null, '{}', 82),
  ('sinus_lift',           'implant',       'رفع الجيب الفكي',                       'Sinus lift',                            'teeth',    true,  null, null, null, '{}', 83),
  ('ortho_fixed',          'orthodontic',   'تقويم ثابت',                            'Fixed braces',                          'mouth',    false, null, null, null, '{}', 90),
  ('ortho_aligners',       'orthodontic',   'تقويم شفاف',                            'Clear aligners',                        'mouth',    false, null, null, null, '{}', 91),
  ('ortho_retainer',       'orthodontic',   'مثبّت بعد التقويم',                     'Retainer',                              'arch',     false, null, null, null, '{}', 92),
  ('space_maintainer',     'orthodontic',   'حافظ مسافة',                            'Space maintainer',                      'tooth',    false, null, null, null, '{}', 93),
  ('whitening',            'other',         'تبييض الأسنان',                         'Tooth whitening',                       'mouth',    false, null, null, null, '{discoloration}', 95),
  ('desensitizing',        'other',         'علاج حساسية الأسنان',                   'Desensitizing treatment',               'teeth',    false, null, null, null, '{}', 96),
  ('occlusal_adjustment',  'other',         'تعديل الإطباق',                         'Occlusal adjustment',                   'teeth',    false, null, null, null, '{}', 97),
  ('referral',             'other',         'استشارة أو تحويل لأخصائي',              'Consultation / specialist referral',    'mouth',    false, null, null, null, '{}', 98),
  ('other',                'other',         'إجراء آخر',                             'Other procedure',                       'tooth',    false, null, null, null, '{}', 99);

alter table public.procedure_catalog enable row level security;
create policy procedure_catalog_sel on public.procedure_catalog for select to authenticated using (true);
create policy procedure_catalog_admin_ins on public.procedure_catalog for insert to authenticated with check (app.is_admin());
create policy procedure_catalog_admin_upd on public.procedure_catalog for update to authenticated using (app.is_admin()) with check (app.is_admin());
grant select, insert, update on public.procedure_catalog to authenticated;
grant all on public.procedure_catalog to service_role;

-- ---------------------------------------------------------------- plans
create table public.treatment_plans (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  specialty_id uuid references public.medical_specialties (id),
  title text not null check (length(btrim(title)) between 2 and 200),
  status text not null default 'draft' check (status in
    ('draft', 'proposed', 'accepted', 'in_progress', 'completed', 'declined', 'cancelled', 'superseded')),
  version int not null default 1 check (version between 1 and 500),
  group_id uuid,                 -- a plan and its alternatives share the group (the first plan's id)
  previous_id uuid,              -- the version this one replaces
  alternative_of uuid,           -- the plan this one is an alternative to
  presented_by text check (length(presented_by) <= 200),
  presented_on date,
  accepted_on date,
  status_reason text check (length(status_reason) <= 500),
  notes text check (length(notes) <= 4000),
  unique (id, patient_id),
  foreign key (previous_id, patient_id) references public.treatment_plans (id, patient_id),
  foreign key (alternative_of, patient_id) references public.treatment_plans (id, patient_id)
);
create index treatment_plans_patient_idx on public.treatment_plans (patient_id, status);
create index treatment_plans_group_idx on public.treatment_plans (group_id);

-- ---------------------------------------------------------------- planned treatments
create table public.treatment_items (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  plan_id uuid not null,
  catalog_code text references public.procedure_catalog (code),
  name text not null check (length(btrim(name)) between 2 and 200),
  teeth smallint[] check (app.valid_teeth(teeth)),
  surfaces text[] not null default '{}' check (app.valid_surfaces(surfaces)),
  condition_id uuid,             -- the problem it treats
  phase smallint not null default 1 check (phase between 1 and 20),
  status text not null default 'proposed' check (status in
    ('proposed', 'planned', 'accepted', 'scheduled', 'in_progress', 'completed', 'referred', 'cancelled', 'deferred')),
  surgical boolean not null default false,
  scheduled_for date,
  completed_on date,
  procedure_id uuid,             -- the procedure recorded when it was completed
  exam_id uuid,                  -- the chart update recorded when it was completed
  status_reason text check (length(status_reason) <= 500),
  notes text check (length(notes) <= 2000),
  sort int not null default 0,
  unique (id, patient_id),
  foreign key (plan_id, patient_id) references public.treatment_plans (id, patient_id),
  foreign key (condition_id, patient_id) references public.conditions (id, patient_id),
  foreign key (procedure_id, patient_id) references public.procedures (id, patient_id),
  foreign key (exam_id, patient_id) references public.dental_exams (id, patient_id),
  check (status <> 'completed' or completed_on is not null)
);
create index treatment_items_plan_idx on public.treatment_items (plan_id, phase, sort);
create index treatment_items_patient_idx on public.treatment_items (patient_id, status);
create index treatment_items_teeth_idx on public.treatment_items using gin (teeth) where teeth is not null;
create index treatment_items_condition_idx on public.treatment_items (condition_id) where condition_id is not null;

-- ---------------------------------------------------------------- private costs
create table public.treatment_costs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  item_id uuid not null,
  amount numeric(12, 2) not null check (amount >= 0 and amount < 10000000000),
  currency text not null default 'SAR' check (currency ~ '^[A-Z]{3}$'),
  kind text not null default 'estimate' check (kind in ('estimate', 'quoted', 'final')),
  note text check (length(note) <= 300),
  unique (id, patient_id),
  foreign key (item_id, patient_id) references public.treatment_items (id, patient_id)
);
create index treatment_costs_item_idx on public.treatment_costs (item_id);

-- provenance + lifecycle as on the other clinical tables, the clinician link, guards, audit and access
do $$
declare t text;
begin
  foreach t in array array['treatment_plans', 'treatment_items', 'treatment_costs'] loop
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
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
-- a clinician's plan stays theirs: the patient accepts or declines it, and follows its treatments, but does not rewrite it
create trigger treatment_plans_contrib_guard before insert or update on public.treatment_plans
  for each row execute function app.contribution_guard('status', 'status_reason', 'accepted_on');
create trigger treatment_items_contrib_guard before insert or update on public.treatment_items
  for each row execute function app.contribution_guard('status', 'status_reason', 'scheduled_for', 'completed_on', 'procedure_id', 'exam_id');
create trigger treatment_costs_contrib_guard before insert or update on public.treatment_costs
  for each row execute function app.contribution_guard();

-- ---------------------------------------------------------------- life cycle
create function app.treatment_item_next(p_from text) returns text[]
language sql immutable as $$
  select case p_from
    when 'proposed'    then array['planned', 'accepted', 'cancelled', 'deferred', 'referred']
    when 'planned'     then array['accepted', 'scheduled', 'cancelled', 'deferred', 'referred']
    when 'accepted'    then array['scheduled', 'in_progress', 'completed', 'cancelled', 'deferred', 'referred']
    when 'scheduled'   then array['accepted', 'in_progress', 'completed', 'cancelled', 'deferred', 'referred']
    when 'in_progress' then array['completed', 'cancelled', 'referred']
    when 'deferred'    then array['proposed', 'planned', 'accepted', 'cancelled']
    else '{}'::text[] end
$$;
create function app.treatment_plan_next(p_from text) returns text[]
language sql immutable as $$
  select case p_from
    when 'draft'       then array['proposed', 'accepted', 'declined', 'cancelled', 'superseded']
    when 'proposed'    then array['draft', 'accepted', 'declined', 'cancelled', 'superseded']
    when 'accepted'    then array['in_progress', 'completed', 'cancelled', 'superseded']
    when 'in_progress' then array['completed', 'cancelled', 'superseded']
    else '{}'::text[] end
$$;
grant execute on function app.treatment_item_next(text) to authenticated, service_role;
grant execute on function app.treatment_plan_next(text) to authenticated, service_role;

create function app.treatment_plan_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare g uuid;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'proposed') then raise exception 'a new plan starts as a draft or a proposal' using errcode = '22023'; end if;
    if new.alternative_of is not null then
      select coalesce(group_id, id) into g from public.treatment_plans where id = new.alternative_of and patient_id = new.patient_id;
      new.group_id := g;
    elsif new.previous_id is not null then
      select coalesce(group_id, id), version + 1 into g, new.version from public.treatment_plans where id = new.previous_id and patient_id = new.patient_id;
      new.group_id := g;
    else
      new.group_id := new.id; new.version := 1;
    end if;
    return new;
  end if;
  if new.group_id is distinct from old.group_id or new.version <> old.version or new.previous_id is distinct from old.previous_id
     or new.alternative_of is distinct from old.alternative_of then
    raise exception 'immutable fields cannot be changed' using errcode = '42501';
  end if;
  if new.status <> old.status then
    if not (new.status = any (app.treatment_plan_next(old.status))) then
      raise exception 'invalid_transition' using errcode = '22023', detail = old.status || ' → ' || new.status;
    end if;
    if new.status = 'accepted' then new.accepted_on := coalesce(new.accepted_on, nullif(current_setting('app.status_date', true), '')::date, current_date); end if;
  end if;
  return new;
end $$;
create trigger treatment_plans_lifecycle before insert or update on public.treatment_plans for each row execute function app.treatment_plan_guard();

create function app.treatment_item_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_plan text; v_surg boolean;
begin
  if tg_op = 'INSERT' then
    select status into v_plan from public.treatment_plans where id = new.plan_id and patient_id = new.patient_id and record_status = 'active';
    if v_plan is null or v_plan not in ('draft', 'proposed', 'accepted', 'in_progress') then
      raise exception 'plan_closed' using errcode = '22023', hint = 'Treatments are added to an open plan.';
    end if;
    if new.status not in ('proposed', 'planned') then raise exception 'a new treatment starts as proposed or planned' using errcode = '22023'; end if;
    if new.catalog_code is not null then
      select surgical into v_surg from public.procedure_catalog where code = new.catalog_code;
      new.surgical := coalesce(v_surg, false) or new.surgical;
    end if;
    return new;
  end if;
  -- the plan, and whether it is surgical, are fixed (a surgical treatment cannot be made "non-surgical" to skip the confirmation)
  if new.plan_id <> old.plan_id or new.surgical <> old.surgical then
    raise exception 'immutable fields cannot be changed' using errcode = '42501';
  end if;
  if new.status <> old.status then
    if not (new.status = any (app.treatment_item_next(old.status))) then
      raise exception 'invalid_transition' using errcode = '22023', detail = old.status || ' → ' || new.status;
    end if;
    -- a surgical treatment is consented to and completed only with an explicit confirmation
    if new.surgical and new.status in ('accepted', 'completed') and coalesce(current_setting('app.surgical_confirmed', true), '') <> 'on' then
      raise exception 'surgical_confirmation_required' using errcode = '22023';
    end if;
    -- completion goes through treatment_item_set_status (it records the procedure and updates the chart)
    if new.status = 'completed' and coalesce(current_setting('app.treatment_completing', true), '') <> 'on' then
      raise exception 'complete_through_function' using errcode = '22023';
    end if;
  elsif old.status in ('completed', 'referred', 'cancelled') and new.record_status = old.record_status
        and (new.completed_on is distinct from old.completed_on or new.teeth is distinct from old.teeth or new.name <> old.name) then
    raise exception 'a closed treatment cannot be changed' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger treatment_items_lifecycle before insert or update on public.treatment_items for each row execute function app.treatment_item_guard();

-- a plan follows its treatments; its treatments follow a plan that is closed or invalidated
create function app.treatment_item_sync_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.treatment_plans; v_open int; v_done int;
begin
  select * into p from public.treatment_plans where id = new.plan_id;
  if p.status not in ('accepted', 'in_progress') or p.record_status <> 'active' then return null; end if;
  select count(*) filter (where status not in ('completed', 'referred', 'cancelled')),
         count(*) filter (where status in ('completed', 'referred'))
    into v_open, v_done
    from public.treatment_items where plan_id = p.id and record_status = 'active';
  if v_open = 0 and v_done > 0 then
    update public.treatment_plans set status = 'completed' where id = p.id;
  elsif p.status = 'accepted' and exists (select 1 from public.treatment_items where plan_id = p.id and record_status = 'active'
                                           and status in ('in_progress', 'completed', 'referred')) then
    update public.treatment_plans set status = 'in_progress' where id = p.id;
  end if;
  return null;
end $$;
create trigger treatment_items_sync_plan after update of status on public.treatment_items for each row execute function app.treatment_item_sync_plan();

create function app.treatment_plan_cascade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.record_status = 'entered_in_error' and old.record_status = 'active' then
    update public.treatment_items set record_status = 'entered_in_error',
           invalidated_reason = left('أُبطل مع الخطة / invalidated with the plan: ' || coalesce(new.invalidated_reason, ''), 500)
     where plan_id = new.id and record_status = 'active';
  elsif new.status <> old.status and new.status in ('cancelled', 'declined', 'superseded') then
    perform set_config('app.status_reason', case new.status
      when 'superseded' then 'نُقل إلى نسخة جديدة من الخطة / moved to a new version of the plan'
      when 'declined' then 'لم تُعتمد الخطة / the plan was declined'
      else coalesce('أُلغيت الخطة / the plan was cancelled' || coalesce(': ' || new.status_reason, ''), '') end, true);
    update public.treatment_items set status = 'cancelled', status_reason = left(current_setting('app.status_reason', true), 500)
     where plan_id = new.id and record_status = 'active' and status in ('proposed', 'planned', 'accepted', 'scheduled', 'in_progress', 'deferred');
  end if;
  return null;
end $$;
create trigger treatment_plans_cascade after update on public.treatment_plans for each row execute function app.treatment_plan_cascade();

-- every change of status is kept, like those of diagnoses and medications
alter table public.status_history drop constraint status_history_table_name_check;
alter table public.status_history add constraint status_history_table_name_check
  check (table_name in ('conditions', 'medications', 'allergies', 'treatment_plans', 'treatment_items'));
create trigger treatment_plans_status_history after insert or update on public.treatment_plans
  for each row execute function app.track_status('status');
create trigger treatment_items_status_history after insert or update on public.treatment_items
  for each row execute function app.track_status('status');

-- ---------------------------------------------------------------- writing plans (caller's rights)
-- From an account RLS and the guards apply; from the share functions below it writes for the clinician.
create function app.treatment_plan_write(p_patient uuid, p_plan jsonb, p_items jsonb, p_contributor uuid default null, p_source_detail text default null)
returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid; x jsonb; v_cat public.procedure_catalog; v_surf text[]; v_teeth smallint[]; v_name text; n int := 0;
  v_dent uuid := (select id from public.medical_specialties where code = 'dentistry');
  v_src text := case when p_contributor is null then 'self' else 'clinic' end;
  v_ver text := case when p_contributor is null then 'reported' else 'confirmed' end;
begin
  if jsonb_typeof(coalesce(p_plan, 'null')) <> 'object' or jsonb_typeof(coalesce(p_items, '[]')) <> 'array'
     or jsonb_array_length(coalesce(p_items, '[]')) > 60 then
    raise exception 'invalid plan' using errcode = '22023';
  end if;
  insert into public.treatment_plans (patient_id, specialty_id, title, status, previous_id, alternative_of, presented_by, presented_on, notes,
                                      source, source_detail, verification, contributed_by)
  values (p_patient, v_dent, btrim(p_plan ->> 'title'), case when p_contributor is null then coalesce(nullif(p_plan ->> 'status', ''), 'draft') else 'proposed' end,
          nullif(p_plan ->> 'previous_id', '')::uuid, nullif(p_plan ->> 'alternative_of', '')::uuid,
          nullif(btrim(p_plan ->> 'presented_by'), ''), nullif(p_plan ->> 'presented_on', '')::date, nullif(btrim(p_plan ->> 'notes'), ''),
          v_src, p_source_detail, v_ver, p_contributor)
  returning id into v_id;
  for x in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    n := n + 1;
    v_cat := null;
    if nullif(x ->> 'catalog_code', '') is not null then
      select * into v_cat from public.procedure_catalog where code = x ->> 'catalog_code' and is_active;
      if v_cat.code is null then raise exception 'unknown_procedure' using errcode = '22023'; end if;
    end if;
    v_name := coalesce(nullif(btrim(x ->> 'name'), ''), case when p_plan ->> 'lang' = 'en' then v_cat.name_en else v_cat.name_ar end);
    select array_agg(t::smallint order by t::smallint) into v_teeth from jsonb_array_elements_text(coalesce(x -> 'teeth', '[]')) t;
    select coalesce(array_agg(s order by s), '{}') into v_surf from jsonb_array_elements_text(coalesce(x -> 'surfaces', '[]')) s;
    insert into public.treatment_items (patient_id, plan_id, catalog_code, name, teeth, surfaces, condition_id, phase, status, scheduled_for, notes, sort,
                                        source, source_detail, verification, contributed_by)
    values (p_patient, v_id, v_cat.code, v_name, v_teeth, v_surf, nullif(x ->> 'condition_id', '')::uuid,
            coalesce(nullif(x ->> 'phase', '')::smallint, 1), 'proposed', nullif(x ->> 'scheduled_for', '')::date, nullif(btrim(x ->> 'notes'), ''),
            n, v_src, p_source_detail, v_ver, p_contributor);
  end loop;
  return v_id;
end $$;
grant execute on function app.treatment_plan_write(uuid, jsonb, jsonb, uuid, text) to authenticated, service_role;

create function public.treatment_plan_create(p_patient uuid, p_plan jsonb, p_items jsonb default '[]') returns uuid
language plpgsql set search_path = '' as $$
begin
  if not app.has_patient_access(p_patient, 'write') then raise exception 'forbidden' using errcode = '42501'; end if;
  return app.treatment_plan_write(p_patient, p_plan, p_items);
end $$;

-- ---------------------------------------------------------------- moving a treatment along (caller's rights)
create function app.treatment_item_transition(p_item uuid, p_status text, p_date date, p_reason text, p_confirm boolean,
                                              p_contributor uuid default null, p_source_detail text default null)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  i public.treatment_items; c public.procedure_catalog;
  v_date date := coalesce(p_date, current_date);
  v_dent uuid := (select id from public.medical_specialties where code = 'dentistry');
  v_proc uuid; v_exam uuid; v_states jsonb := '[]'; v_findings jsonb := '[]'; t smallint; n_res int := 0; v_cond boolean := false;
  v_src text := case when p_contributor is null then 'self' else 'clinic' end;
  v_ver text := case when p_contributor is null then 'reported' else 'confirmed' end;
begin
  if p_date is not null and p_date > current_date + 1 and p_status <> 'scheduled' then raise exception 'date_in_future' using errcode = '22023'; end if;
  select * into i from public.treatment_items where id = p_item and record_status = 'active' for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if i.status = p_status then return jsonb_build_object('status', 'ok', 'unchanged', true); end if;
  perform set_config('app.status_reason', coalesce(btrim(p_reason), ''), true);
  perform set_config('app.status_date', v_date::text, true);
  perform set_config('app.surgical_confirmed', case when coalesce(p_confirm, false) then 'on' else '' end, true);
  if p_status <> 'completed' then
    update public.treatment_items set status = p_status, status_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), ''),
           scheduled_for = case when p_status = 'scheduled' then coalesce(p_date, scheduled_for) else scheduled_for end
     where id = p_item;
    return jsonb_build_object('status', 'ok');
  end if;

  -- completion: the procedure, the chart, the problems it treated
  if not (p_status = any (app.treatment_item_next(i.status))) then raise exception 'invalid_transition' using errcode = '22023'; end if;
  if i.surgical and not coalesce(p_confirm, false) then raise exception 'surgical_confirmation_required' using errcode = '22023'; end if;
  select * into c from public.procedure_catalog where code = i.catalog_code;
  insert into public.procedures (patient_id, specialty_id, kind, name, performed_on, date_precision, teeth, condition_id, notes,
                                 source, source_detail, verification, contributed_by)
  values (i.patient_id, v_dent, 'dental', i.name, v_date, 'day', i.teeth, i.condition_id,
          left('من خطة العلاج / from the treatment plan' || coalesce(' — ' || nullif(btrim(p_reason), ''), ''), 2000),
          v_src, p_source_detail, v_ver, p_contributor)
  returning id into v_proc;

  if i.teeth is not null and (c.finding_kind is not null or c.tooth_state is not null) then
    foreach t in array i.teeth loop
      if c.tooth_state is not null then
        v_states := v_states || jsonb_build_object('tooth', t, 'status', c.tooth_state, 'note', left(i.name, 200));
      end if;
      if c.finding_kind is not null then
        v_findings := v_findings || jsonb_build_object('tooth', t, 'kind', c.finding_kind, 'material', c.material,
          'surfaces', case when c.scope = 'surfaces' then to_jsonb(i.surfaces) else '[]'::jsonb end,
          'evidence', case when p_contributor is null then 'patient_reported' else 'clinical' end,
          'condition_id', i.condition_id, 'notes', left(i.name, 200));
      end if;
    end loop;
    v_exam := app.dental_exam_write(i.patient_id,
      jsonb_build_object('exam_date', v_date, 'kind', 'limited', 'notes', left('إنجاز علاج / treatment completed: ' || i.name, 4000)),
      v_states, v_findings, v_dent, p_contributor, p_source_detail);
  end if;

  -- the problems on the treated teeth that this treatment treats (or that belong to the diagnosis it treats)
  if i.teeth is not null then
    update public.dental_findings f set resolved_on = greatest(v_date, f.observed_on), resolved_note = left('عولج / treated: ' || i.name, 500)
     where f.patient_id = i.patient_id and f.record_status = 'active' and f.resolved_on is null and f.tooth = any (i.teeth)
       and f.kind in ('caries', 'secondary_caries', 'fracture', 'crack', 'wear', 'defective_restoration', 'periapical_lesion', 'abscess',
                      'recession', 'mobility', 'discoloration', 'hypoplasia')
       and ((i.condition_id is not null and f.condition_id = i.condition_id)
            or (f.kind = any (coalesce(c.resolves, '{}'))
                and (c.scope <> 'surfaces' or cardinality(i.surfaces) = 0 or cardinality(f.surfaces) = 0 or f.surfaces && i.surfaces)));
    get diagnostics n_res = row_count;
  end if;

  perform set_config('app.treatment_completing', 'on', true);
  update public.treatment_items set status = 'completed', completed_on = v_date, procedure_id = v_proc, exam_id = v_exam,
         status_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), '')
   where id = p_item;
  perform set_config('app.treatment_completing', '', true);

  -- the diagnosis is treated once nothing else is planned for it
  if i.condition_id is not null and not exists (
       select 1 from public.treatment_items x where x.condition_id = i.condition_id and x.id <> i.id and x.record_status = 'active'
          and x.status not in ('completed', 'referred', 'cancelled')) then
    perform set_config('app.status_reason', left('عولج / treated: ' || i.name, 500), true);
    update public.conditions set clinical_status = 'resolved', resolved_date = v_date
     where id = i.condition_id and record_status = 'active' and clinical_status in ('active', 'recurrence', 'inactive');
    v_cond := found;
  end if;
  return jsonb_build_object('status', 'ok', 'procedure_id', v_proc, 'exam_id', v_exam, 'findings_resolved', n_res, 'condition_resolved', v_cond);
end $$;
grant execute on function app.treatment_item_transition(uuid, text, date, text, boolean, uuid, text) to authenticated, service_role;

create function public.treatment_item_set_status(p_item uuid, p_status text, p_date date default null, p_reason text default null,
                                                 p_confirm boolean default false) returns jsonb
language plpgsql set search_path = '' as $$
begin
  return app.treatment_item_transition(p_item, p_status, p_date, p_reason, p_confirm);
end $$;

-- a plan: propose, accept (its treatments with it; the other options are declined), decline, cancel
create function app.treatment_plan_transition(p_plan uuid, p_status text, p_reason text, p_confirm boolean) returns void
language plpgsql set search_path = '' as $$
declare p public.treatment_plans;
begin
  select * into p from public.treatment_plans where id = p_plan and record_status = 'active' for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p.status = p_status then return; end if;
  if p_status = 'superseded' then raise exception 'invalid_transition' using errcode = '22023'; end if;
  perform set_config('app.status_reason', coalesce(btrim(p_reason), ''), true);
  perform set_config('app.status_date', current_date::text, true);
  perform set_config('app.surgical_confirmed', case when coalesce(p_confirm, false) then 'on' else '' end, true);
  update public.treatment_plans set status = p_status, status_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), '') where id = p_plan;
  if p_status = 'accepted' then
    update public.treatment_items set status = 'accepted'
     where plan_id = p_plan and record_status = 'active' and status in ('proposed', 'planned', 'deferred');
    perform set_config('app.status_reason', 'اختير خيار آخر / another option was chosen', true);
    update public.treatment_plans set status = 'declined', status_reason = 'اختير خيار آخر / another option was chosen'
     where group_id = p.group_id and id <> p.id and record_status = 'active' and status in ('draft', 'proposed');
  end if;
end $$;
grant execute on function app.treatment_plan_transition(uuid, text, text, boolean) to authenticated, service_role;

create function public.treatment_plan_set_status(p_plan uuid, p_status text, p_reason text default null, p_confirm boolean default false) returns void
language plpgsql set search_path = '' as $$
begin
  perform app.treatment_plan_transition(p_plan, p_status, p_reason, p_confirm);
end $$;

-- a new version: the open treatments are carried over as proposals; the old version is kept, superseded
create function public.treatment_plan_new_version(p_plan uuid, p_reason text default null) returns uuid
language plpgsql set search_path = '' as $$
declare p public.treatment_plans; v_id uuid;
begin
  select * into p from public.treatment_plans where id = p_plan and record_status = 'active' for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p.status not in ('draft', 'proposed', 'accepted', 'in_progress') then raise exception 'plan_closed' using errcode = '22023'; end if;
  insert into public.treatment_plans (patient_id, specialty_id, title, status, previous_id, presented_by, presented_on, notes)
  values (p.patient_id, p.specialty_id, p.title, 'draft', p.id, p.presented_by, p.presented_on, p.notes)
  returning id into v_id;
  insert into public.treatment_items (patient_id, plan_id, catalog_code, name, teeth, surfaces, condition_id, phase, status, surgical, notes, sort)
  select x.patient_id, v_id, x.catalog_code, x.name, x.teeth, x.surfaces, x.condition_id, x.phase, 'proposed', x.surgical, x.notes, x.sort
    from public.treatment_items x
   where x.plan_id = p.id and x.record_status = 'active' and x.status in ('proposed', 'planned', 'accepted', 'scheduled', 'in_progress', 'deferred');
  perform set_config('app.status_reason', coalesce(nullif(btrim(p_reason), ''), 'نسخة جديدة / new version'), true);
  update public.treatment_plans set status = 'superseded', status_reason = left(coalesce(nullif(btrim(p_reason), ''), 'نسخة جديدة / new version'), 500)
   where id = p.id;
  return v_id;
end $$;

revoke all on function public.treatment_plan_create(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.treatment_item_set_status(uuid, text, date, text, boolean) from public, anon;
revoke all on function public.treatment_plan_set_status(uuid, text, text, boolean) from public, anon;
revoke all on function public.treatment_plan_new_version(uuid, text) from public, anon;
grant execute on function public.treatment_plan_create(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.treatment_item_set_status(uuid, text, date, text, boolean) to authenticated;
grant execute on function public.treatment_plan_set_status(uuid, text, text, boolean) to authenticated;
grant execute on function public.treatment_plan_new_version(uuid, text) to authenticated;

-- ---------------------------------------------------------------- the share link
alter table public.medical_shares drop constraint if exists medical_shares_contribute_modules_check;
alter table public.medical_shares add constraint medical_shares_contribute_modules_check
  check (contribute_modules <@ array['encounters', 'conditions', 'procedures', 'clinical_notes', 'medications', 'appointments',
                                     'test_orders', 'imaging_studies', 'medical_documents', 'dental_exams', 'treatment_plans']::text[]);

-- the dental view now carries the treatment plans (without any cost) and the costs this clinician entered themselves
create or replace function public.share_dental(p_session_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_share uuid; v_sid uuid; v_st text;
  s public.medical_shares;
  v_from date; v_to date;
  v_dent uuid; v_ctr uuid;
begin
  select a.o_share_id, a.o_session_id, a.o_status into v_share, v_sid, v_st from app.resolve_share_session(p_session_token) a;
  if v_st <> 'ok' then return jsonb_build_object('status', 'expired'); end if;
  select * into s from public.medical_shares where id = v_share;
  if not app.share_covers_dentistry(s)
     or not ('specialty_records' = any (s.include)
             or (s.allow_contribute and ('dental_exams' = any (s.contribute_modules) or 'treatment_plans' = any (s.contribute_modules)))) then
    return jsonb_build_object('status', 'none');
  end if;
  select id into v_dent from public.medical_specialties where code = 'dentistry';
  select id into v_ctr from public.share_contributors where session_id = v_sid;
  v_from := coalesce(s.date_from, '-infinity'::date);
  v_to := coalesce(s.date_to, 'infinity'::date);
  return jsonb_build_object(
    'status', 'ok',
    'profile', (select to_jsonb(d) - 'id' - 'patient_id' - 'updated_by' from public.dental_profiles d where d.patient_id = s.patient_id),
    'exams', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'exam_date', e.exam_date, 'kind', e.kind, 'dentition', e.dentition, 'examiner_name', e.examiner_name,
        'facility_name', e.facility_name, 'chief_complaint', e.chief_complaint, 'oral_hygiene', e.oral_hygiene, 'notes', e.notes,
        'source', e.source, 'source_detail', e.source_detail, 'verification', e.verification, 'contributed_by', e.contributed_by,
        'states', coalesce((select jsonb_agg(jsonb_build_object('tooth', t.tooth, 'status', t.status, 'note', t.note) order by t.tooth)
                              from public.dental_tooth_states t where t.exam_id = e.id), '[]'))
        order by e.exam_date desc, e.recorded_at desc)
      from public.dental_exams e
      where e.patient_id = s.patient_id and e.record_status = 'active' and e.exam_date between v_from and v_to), '[]'),
    'findings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', f.id, 'exam_id', f.exam_id, 'condition_id', f.condition_id, 'tooth', f.tooth, 'surfaces', to_jsonb(f.surfaces), 'kind', f.kind,
        'evidence', f.evidence, 'severity', f.severity, 'material', f.material, 'observed_on', f.observed_on, 'date_precision', f.date_precision,
        'resolved_on', f.resolved_on, 'resolved_note', f.resolved_note, 'notes', f.notes, 'source', f.source, 'source_detail', f.source_detail,
        'verification', f.verification, 'contributed_by', f.contributed_by)
        order by f.observed_on desc, f.recorded_at desc)
      from public.dental_findings f
      where f.patient_id = s.patient_id and f.record_status = 'active' and f.observed_on <= v_to
        and (f.resolved_on is null or f.resolved_on >= v_from)), '[]'),
    'diagnoses', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'icd10_code', c.icd10_code, 'teeth', to_jsonb(c.teeth), 'evidence', c.evidence, 'certainty', c.certainty,
        'clinical_status', c.clinical_status, 'onset_date', c.onset_date, 'date_precision', c.date_precision, 'resolved_date', c.resolved_date,
        'contributed_by', c.contributed_by)
        order by c.onset_date desc nulls last)
      from public.conditions c
      where c.patient_id = s.patient_id and c.record_status = 'active' and (c.teeth is not null or c.specialty_id = v_dent)
        and (not c.sensitive or s.include_sensitive)), '[]'),
    'procedures', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'name', x.name, 'kind', x.kind, 'teeth', to_jsonb(x.teeth), 'performed_on', x.performed_on, 'date_precision', x.date_precision,
        'operator_name', x.operator_name, 'facility_name', x.facility_name, 'outcome', x.outcome, 'contributed_by', x.contributed_by)
        order by x.performed_on desc nulls last)
      from public.procedures x
      where x.patient_id = s.patient_id and x.record_status = 'active' and x.teeth is not null
        and (x.performed_on is null or x.performed_on between v_from and v_to)), '[]'),
    'imaging', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'modality', x.modality, 'body_site', x.body_site, 'teeth', to_jsonb(x.teeth), 'performed_on', x.performed_on,
        'date_precision', x.date_precision, 'impression', x.impression, 'contributed_by', x.contributed_by)
        order by x.performed_on desc nulls last)
      from public.imaging_studies x
      where x.patient_id = s.patient_id and x.record_status = 'active' and x.teeth is not null
        and (x.performed_on is null or x.performed_on between v_from and v_to)), '[]'),
    -- plans that are still current (no superseded versions, nothing invalidated); costs are never included here
    'plans', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'title', p.title, 'status', p.status, 'version', p.version, 'group_id', p.group_id, 'alternative_of', p.alternative_of,
        'presented_by', p.presented_by, 'presented_on', p.presented_on, 'accepted_on', p.accepted_on, 'notes', p.notes,
        'contributed_by', p.contributed_by, 'recorded_at', p.recorded_at,
        'items', coalesce((select jsonb_agg(jsonb_build_object(
            'id', i.id, 'catalog_code', i.catalog_code, 'name', i.name, 'teeth', to_jsonb(i.teeth), 'surfaces', to_jsonb(i.surfaces),
            'condition_id', i.condition_id, 'phase', i.phase, 'status', i.status, 'surgical', i.surgical, 'scheduled_for', i.scheduled_for,
            'completed_on', i.completed_on, 'status_reason', i.status_reason, 'notes', i.notes, 'contributed_by', i.contributed_by)
            order by i.phase, i.sort)
          from public.treatment_items i where i.plan_id = p.id and i.record_status = 'active'), '[]'))
        order by p.recorded_at desc)
      from public.treatment_plans p
      where p.patient_id = s.patient_id and p.record_status = 'active' and p.status <> 'superseded'), '[]'),
    'my_costs', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'item_id', k.item_id, 'amount', k.amount, 'currency', k.currency,
                                                              'kind', k.kind, 'note', k.note) order by k.recorded_at)
      from public.treatment_costs k
      where v_ctr is not null and k.contributed_by = v_ctr and k.patient_id = s.patient_id and k.record_status = 'active'), '[]'));
end $$;

-- the clinician proposes a plan (it counts as one addition)
create function public.share_contribute_treatment_plan(p_session_token text, p_plan jsonb, p_items jsonb,
                                                       p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_used int; v_name text; v_id uuid; x jsonb; v_cond uuid;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  if not ('treatment_plans' = any ((c.o_share).contribute_modules)) or not app.share_covers_dentistry(c.o_share) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  select coalesce(sum(contribution_count), 0) into v_used from public.share_contributors where share_id = (c.o_share).id;
  if v_used >= (c.o_share).max_contributions then return jsonb_build_object('status', 'limit'); end if;
  if jsonb_typeof(coalesce(p_items, 'null')) <> 'array' or jsonb_array_length(p_items) = 0 then return jsonb_build_object('status', 'invalid'); end if;
  -- a treatment may point at a dental problem of this patient (one the clinician can see in the dental view)
  for x in select * from jsonb_array_elements(p_items) loop
    v_cond := nullif(x ->> 'condition_id', '')::uuid;
    if v_cond is not null and not exists (
         select 1 from public.conditions k where k.id = v_cond and k.patient_id = (c.o_share).patient_id and k.record_status = 'active'
            and (k.teeth is not null or k.specialty_id = (select id from public.medical_specialties where code = 'dentistry'))
            and (not k.sensitive or (c.o_share).include_sensitive)) then
      return jsonb_build_object('status', 'invalid');
    end if;
  end loop;
  if nullif(p_plan ->> 'alternative_of', '') is not null and not exists (
       select 1 from public.treatment_plans p where p.id = (p_plan ->> 'alternative_of')::uuid and p.patient_id = (c.o_share).patient_id
          and p.record_status = 'active') then
    return jsonb_build_object('status', 'invalid');
  end if;
  select left(full_name || coalesce(' — ' || facility, ''), 300) into v_name from public.share_contributors where id = c.o_contributor;
  perform set_config('app.share_contributor', c.o_contributor::text, true);
  v_id := app.treatment_plan_write((c.o_share).patient_id,
            (p_plan - 'status' - 'previous_id') || jsonb_build_object('presented_by', coalesce(nullif(btrim(p_plan ->> 'presented_by'), ''), v_name),
                                                                       'presented_on', current_date),
            p_items, c.o_contributor, v_name);
  update public.share_contributors set contribution_count = contribution_count + 1, last_contribution_at = now() where id = c.o_contributor;
  perform app.share_log((c.o_share).id, 'contribution_added', p_ip_hash, p_user_agent,
                        jsonb_build_object('contributor', c.o_contributor, 'table', 'treatment_plans', 'id', v_id));
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

-- the clinician adds a treatment to a plan proposed through this share that is still a proposal
create function public.share_add_treatment_item(p_session_token text, p_plan uuid, p_item jsonb, p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_name text; v_cat public.procedure_catalog; v_id uuid; v_cond uuid; v_teeth smallint[]; v_surf text[]; v_n int;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  if not ('treatment_plans' = any ((c.o_share).contribute_modules)) or not app.share_covers_dentistry(c.o_share) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if not exists (select 1 from public.treatment_plans p join public.share_contributors sc on sc.id = p.contributed_by
                  where p.id = p_plan and p.patient_id = (c.o_share).patient_id and sc.share_id = (c.o_share).id
                    and p.record_status = 'active' and p.status in ('draft', 'proposed')) then
    return jsonb_build_object('status', 'not_found');
  end if;
  select count(*) into v_n from public.treatment_items where plan_id = p_plan;
  if v_n >= 60 then return jsonb_build_object('status', 'limit'); end if;
  v_cond := nullif(p_item ->> 'condition_id', '')::uuid;
  if v_cond is not null and not exists (
       select 1 from public.conditions k where k.id = v_cond and k.patient_id = (c.o_share).patient_id and k.record_status = 'active'
          and (k.teeth is not null or k.specialty_id = (select id from public.medical_specialties where code = 'dentistry'))
          and (not k.sensitive or (c.o_share).include_sensitive)) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if nullif(p_item ->> 'catalog_code', '') is not null then
    select * into v_cat from public.procedure_catalog where code = p_item ->> 'catalog_code' and is_active;
    if v_cat.code is null then return jsonb_build_object('status', 'invalid'); end if;
  end if;
  select left(full_name || coalesce(' — ' || facility, ''), 300) into v_name from public.share_contributors where id = c.o_contributor;
  perform set_config('app.share_contributor', c.o_contributor::text, true);
  begin
    select array_agg(t::smallint order by t::smallint) into v_teeth from jsonb_array_elements_text(coalesce(p_item -> 'teeth', '[]')) t;
    select coalesce(array_agg(s order by s), '{}') into v_surf from jsonb_array_elements_text(coalesce(p_item -> 'surfaces', '[]')) s;
    insert into public.treatment_items (patient_id, plan_id, catalog_code, name, teeth, surfaces, condition_id, phase, status, notes, sort,
                                        source, source_detail, verification, contributed_by)
    values ((c.o_share).patient_id, p_plan, v_cat.code,
            coalesce(nullif(btrim(p_item ->> 'name'), ''), case when p_item ->> 'lang' = 'en' then v_cat.name_en else v_cat.name_ar end),
            v_teeth, v_surf, v_cond, coalesce(nullif(p_item ->> 'phase', '')::smallint, 1), 'proposed', nullif(btrim(p_item ->> 'notes'), ''), v_n + 1,
            'clinic', v_name, 'confirmed', c.o_contributor)
    returning id into v_id;
  exception when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('status', 'invalid');
  end;
  perform app.share_log((c.o_share).id, 'contribution_added', p_ip_hash, p_user_agent,
                        jsonb_build_object('contributor', c.o_contributor, 'table', 'treatment_items', 'id', v_id));
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

-- the clinician moves a treatment along (schedules it, starts it, completes it, refers it…). Accepting is the patient's.
create function public.share_treatment_item_status(p_session_token text, p_item uuid, p_status text, p_date date, p_reason text,
                                                   p_confirm boolean default false, p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_name text; v_res jsonb;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  if not ('treatment_plans' = any ((c.o_share).contribute_modules)) or not app.share_covers_dentistry(c.o_share) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if p_status = 'accepted' then return jsonb_build_object('status', 'patient_decides'); end if;
  if not exists (select 1 from public.treatment_items i join public.treatment_plans p on p.id = i.plan_id
                  where i.id = p_item and i.patient_id = (c.o_share).patient_id and i.record_status = 'active'
                    and p.status <> 'superseded' and p.record_status = 'active') then
    return jsonb_build_object('status', 'not_found');
  end if;
  select left(full_name || coalesce(' — ' || facility, ''), 300) into v_name from public.share_contributors where id = c.o_contributor;
  perform set_config('app.share_contributor', c.o_contributor::text, true);
  begin
    v_res := app.treatment_item_transition(p_item, p_status, p_date, p_reason, p_confirm, c.o_contributor, v_name);
  exception when sqlstate '22023' then
    return jsonb_build_object('status', 'invalid', 'reason', sqlerrm);
  end;
  perform app.share_log((c.o_share).id, 'contribution_added', p_ip_hash, p_user_agent,
                        jsonb_build_object('contributor', c.o_contributor, 'table', 'treatment_items', 'id', p_item, 'status', p_status));
  return v_res;
end $$;

-- the clinician notes their own cost for a treatment; only they (and the patient) ever see it
create function public.share_set_cost(p_session_token text, p_item uuid, p_amount numeric, p_currency text, p_kind text, p_note text,
                                      p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_name text; v_id uuid;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  if not ('treatment_plans' = any ((c.o_share).contribute_modules)) or not app.share_covers_dentistry(c.o_share) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if not exists (select 1 from public.treatment_items i where i.id = p_item and i.patient_id = (c.o_share).patient_id and i.record_status = 'active') then
    return jsonb_build_object('status', 'not_found');
  end if;
  select left(full_name || coalesce(' — ' || facility, ''), 300) into v_name from public.share_contributors where id = c.o_contributor;
  perform set_config('app.share_contributor', c.o_contributor::text, true);
  begin
    insert into public.treatment_costs (patient_id, item_id, amount, currency, kind, note, source, source_detail, verification, contributed_by)
    values ((c.o_share).patient_id, p_item, p_amount, upper(coalesce(nullif(btrim(p_currency), ''), 'SAR')), coalesce(nullif(p_kind, ''), 'estimate'),
            nullif(left(btrim(coalesce(p_note, '')), 300), ''), 'clinic', v_name, 'confirmed', c.o_contributor)
    returning id into v_id;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('status', 'invalid');
  end;
  perform app.share_log((c.o_share).id, 'contribution_added', p_ip_hash, p_user_agent,
                        jsonb_build_object('contributor', c.o_contributor, 'table', 'treatment_costs', 'id', v_id));
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

-- withdrawal, the clinician's own list, and the patient's "invalidate everything this clinician added" know the new tables
create or replace function public.share_retract(p_session_token text, p_table text, p_id uuid, p_reason text, p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_ok boolean;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  if c.o_contributor is null then return jsonb_build_object('status', 'identify_first'); end if;
  if p_table not in ('encounters', 'conditions', 'procedures', 'clinical_notes', 'medications', 'appointments', 'test_orders',
                     'imaging_studies', 'medical_documents', 'dental_exams', 'treatment_plans', 'treatment_costs') then
    return jsonb_build_object('status', 'invalid');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('status', 'reason_required'); end if;
  perform set_config('app.share_contributor', c.o_contributor::text, true);
  execute format('update public.%I x set record_status = ''entered_in_error'', invalidated_reason = $1
                   where x.id = $2 and x.patient_id = $3 and x.record_status = ''active''
                     and x.contributed_by in (select sc.id from public.share_contributors sc where sc.share_id = $4)
                  returning true', p_table)
    into v_ok using left('سحبه الطبيب / withdrawn by the clinician: ' || btrim(p_reason), 500), p_id, (c.o_share).patient_id, (c.o_share).id;
  if not coalesce(v_ok, false) then return jsonb_build_object('status', 'not_found'); end if;
  perform app.share_log((c.o_share).id, 'contribution_retracted', p_ip_hash, p_user_agent,
                        jsonb_build_object('contributor', c.o_contributor, 'table', p_table, 'id', p_id));
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.share_contrib_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; v_ctr jsonb; v_items jsonb; v_encs jsonb; v_conds jsonb; v_used int;
begin
  select * into c from app.share_contributor_context(p_session_token);
  if c.o_status <> 'ok' then return jsonb_build_object('status', c.o_status); end if;
  select to_jsonb(x) - 'ip_hash' - 'user_agent' - 'signature_path' - 'session_id' into v_ctr
    from public.share_contributors x where x.id = c.o_contributor;
  select coalesce(sum(contribution_count), 0) into v_used from public.share_contributors where share_id = (c.o_share).id;
  with mine as (
    select 'encounters' as tbl, e.id, coalesce(e.reason, e.kind) as label, e.started_at as at, e.record_status, e.contributed_by from public.encounters e
    union all select 'conditions', x.id, x.name, x.recorded_at, x.record_status, x.contributed_by from public.conditions x
    union all select 'procedures', x.id, x.name, x.recorded_at, x.record_status, x.contributed_by from public.procedures x
    union all select 'clinical_notes', x.id, coalesce(x.title, left(x.body, 80)), x.noted_at, x.record_status, x.contributed_by from public.clinical_notes x
    union all select 'medications', x.id, coalesce(x.name_generic, x.name_brand), x.recorded_at, x.record_status, x.contributed_by from public.medications x
    union all select 'appointments', x.id, coalesce(x.reason, ''), x.scheduled_at, x.record_status, x.contributed_by from public.appointments x
    union all select 'test_orders', x.id, x.name, x.recorded_at, x.record_status, x.contributed_by from public.test_orders x
    union all select 'imaging_studies', x.id, x.modality || coalesce(' — ' || x.body_site, ''), x.recorded_at, x.record_status, x.contributed_by from public.imaging_studies x
    union all select 'medical_documents', x.id, x.title, x.uploaded_at, x.record_status, x.contributed_by from public.medical_documents x
    union all select 'dental_exams', x.id, x.exam_date::text || ' · ' || x.kind, x.recorded_at, x.record_status, x.contributed_by from public.dental_exams x
    union all select 'treatment_plans', x.id, x.title, x.recorded_at, x.record_status, x.contributed_by from public.treatment_plans x
    union all select 'treatment_costs', x.id, x.amount::text || ' ' || x.currency, x.recorded_at, x.record_status, x.contributed_by from public.treatment_costs x
  )
  select coalesce(jsonb_agg(jsonb_build_object('table', m.tbl, 'id', m.id, 'label', m.label, 'at', m.at, 'record_status', m.record_status,
                                               'by', sc.full_name, 'mine', m.contributed_by = c.o_contributor) order by m.at desc), '[]')
    into v_items
    from mine m join public.share_contributors sc on sc.id = m.contributed_by
   where sc.share_id = (c.o_share).id;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'started_at', e.started_at, 'reason', e.reason, 'kind', e.kind) order by e.started_at desc), '[]')
    into v_encs
    from public.encounters e join public.share_contributors sc on sc.id = e.contributed_by
   where sc.share_id = (c.o_share).id and e.record_status = 'active';
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'teeth', to_jsonb(k.teeth)) order by k.recorded_at desc), '[]')
    into v_conds
    from public.conditions k join public.share_contributors sc on sc.id = k.contributed_by
   where sc.share_id = (c.o_share).id and k.record_status = 'active';
  return jsonb_build_object('status', 'ok', 'patient_id', (c.o_share).patient_id, 'modules', to_jsonb((c.o_share).contribute_modules), 'max', (c.o_share).max_contributions,
                            'used', v_used, 'contributor', v_ctr, 'items', v_items, 'encounters', v_encs, 'conditions', v_conds,
                            'covers_dentistry', app.share_covers_dentistry(c.o_share));
end $$;

create or replace function public.share_invalidate_contributions(p_contributor uuid, p_reason text) returns int
language plpgsql security definer set search_path = '' as $$
declare v_patient uuid; t text; n int; v_total int := 0;
begin
  select patient_id into v_patient from public.share_contributors where id = p_contributor;
  if v_patient is null or not app.has_patient_access(v_patient, 'write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required to mark a record as entered in error' using errcode = '22023'; end if;
  -- exams and plans first: what belongs to them follows (and is counted with them)
  foreach t in array array['dental_exams', 'treatment_plans', 'treatment_costs', 'encounters', 'conditions', 'procedures', 'clinical_notes',
                           'medications', 'appointments', 'test_orders', 'imaging_studies', 'medical_documents'] loop
    execute format('update public.%I set record_status = ''entered_in_error'', invalidated_reason = $1
                     where contributed_by = $2 and patient_id = $3 and record_status = ''active''', t)
      using left(btrim(p_reason), 500), p_contributor, v_patient;
    get diagnostics n = row_count;
    v_total := v_total + n;
  end loop;
  update public.share_contributors set reviewed_at = now(), reviewed_by = auth.uid() where id = p_contributor;
  return v_total;
end $$;

revoke all on function public.share_contribute_treatment_plan(text, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.share_treatment_item_status(text, uuid, text, date, text, boolean, text, text) from public, anon, authenticated;
revoke all on function public.share_set_cost(text, uuid, numeric, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.share_add_treatment_item(text, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.share_add_treatment_item(text, uuid, jsonb, text, text) to service_role;
grant execute on function public.share_contribute_treatment_plan(text, jsonb, jsonb, text, text) to service_role;
grant execute on function public.share_treatment_item_status(text, uuid, text, date, text, boolean, text, text) to service_role;
grant execute on function public.share_set_cost(text, uuid, numeric, text, text, text, text, text) to service_role;
