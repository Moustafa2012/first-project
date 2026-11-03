-- 0013: catalogue gaps found while transcribing real reports, partial / unknown dates, suggested vs. ordered tests.
--
-- 1) Lab catalogue: full CBC indices (RDW, platelet indices, 5-part and 3-part differentials as absolute counts and %),
--    complete urinalysis (colour, appearance, bilirubin, urobilinogen, epithelium, casts, crystals, mucus, bacteria),
--    cardiac markers, lipids beyond the basic panel, and common screening serologies. Units printed by labs that are
--    equivalent to the default unit become accepted conversions (e.g. FT4 in ng/L, counts in 10^9/L).
-- 2) Date precision: a history often says "around 2003" or "in March". The date column keeps a real date (the first
--    day of the month / year) and date_precision says how much of it is known, so it is never shown as an exact day.
--    Imaging and procedure dates may be unknown altogether (a photo of a film without a date).
-- 3) Test requests: "suggested" (proposed by a report or the patient, nobody ordered it yet) is distinct from
--    "requested" (ordered by a clinician), and the ordering clinician can be named.

-- ---------------------------------------------------------------- 1) catalogue
create temp table _ot2 (code text, category text, lab_group text, name_ar text, name_en text, kind text, unit text,
                        conv jsonb, dec int, pmin numeric, pmax numeric, spec text, sort int);
insert into _ot2 values
 -- hematology: indices and differential
 ('rdw_cv',          'lab','hematology','تفاوت حجم الكريات RDW-CV',        'RDW-CV',                          'numeric','%',       '{}', 1, 5, 40, 'hematology', 1075),
 ('rdw_sd',          'lab','hematology','تفاوت حجم الكريات RDW-SD',        'RDW-SD',                          'numeric','fL',      '{}', 1, 10, 150, 'hematology', 1076),
 ('mpv',             'lab','hematology','متوسط حجم الصفيحات MPV',          'Mean platelet volume (MPV)',      'numeric','fL',      '{}', 1, 3, 25, 'hematology', 1082),
 ('pdw',             'lab','hematology','تباين حجم الصفيحات PDW',          'Platelet distribution width (PDW)','numeric','fL',     '{}', 1, 3, 40, 'hematology', 1083),
 ('pct',             'lab','hematology','الصفيحات الحجمية PCT',            'Plateletcrit (PCT)',              'numeric','%',       '{}', 2, 0, 5, 'hematology', 1084),
 ('p_lcr',           'lab','hematology','نسبة الصفيحات الكبيرة P-LCR',     'Platelet large cell ratio (P-LCR)','numeric','%',      '{}', 1, 0, 100, 'hematology', 1085),
 ('p_lcc',           'lab','hematology','عدد الصفيحات الكبيرة P-LCC',      'Platelet large cell count (P-LCC)','numeric','10^3/µL','{"10^9/L":1}', 0, 0, 2000, 'hematology', 1086),
 ('neutrophils_abs', 'lab','hematology','العدلات (عدد مطلق)',              'Neutrophils (absolute)',          'numeric','10^3/µL', '{"10^9/L":1}', 2, 0, 500, 'hematology', 1091),
 ('lymphocytes_abs', 'lab','hematology','اللمفاويات (عدد مطلق)',           'Lymphocytes (absolute)',          'numeric','10^3/µL', '{"10^9/L":1}', 2, 0, 500, 'hematology', 1101),
 ('monocytes_pct',   'lab','hematology','الوحيدات %',                      'Monocytes %',                     'numeric','%',       '{}', 1, 0, 100, 'hematology', 1102),
 ('monocytes_abs',   'lab','hematology','الوحيدات (عدد مطلق)',             'Monocytes (absolute)',            'numeric','10^3/µL', '{"10^9/L":1}', 2, 0, 100, 'hematology', 1103),
 ('eosinophils_pct', 'lab','hematology','الحمضات %',                       'Eosinophils %',                   'numeric','%',       '{}', 1, 0, 100, 'hematology', 1104),
 ('eosinophils_abs', 'lab','hematology','الحمضات (عدد مطلق)',              'Eosinophils (absolute)',          'numeric','10^3/µL', '{"10^9/L":1}', 2, 0, 100, 'hematology', 1105),
 ('basophils_pct',   'lab','hematology','القعدات %',                       'Basophils %',                     'numeric','%',       '{}', 1, 0, 100, 'hematology', 1106),
 ('basophils_abs',   'lab','hematology','القعدات (عدد مطلق)',              'Basophils (absolute)',            'numeric','10^3/µL', '{"10^9/L":1}', 2, 0, 50, 'hematology', 1107),
 ('mid_pct',         'lab','hematology','الخلايا المتوسطة MID % (جهاز ثلاثي)','Mid-sized cells MID % (3-part)','numeric','%',       '{}', 1, 0, 100, 'hematology', 1108),
 ('mid_abs',         'lab','hematology','الخلايا المتوسطة MID # (جهاز ثلاثي)','Mid-sized cells MID # (3-part)','numeric','10^3/µL', '{"10^9/L":1}', 2, 0, 100, 'hematology', 1109),
 ('gran_pct',        'lab','hematology','المحببات GRAN % (جهاز ثلاثي)',    'Granulocytes GRAN % (3-part)',    'numeric','%',       '{}', 1, 0, 100, 'hematology', 1110),
 ('gran_abs',        'lab','hematology','المحببات GRAN # (جهاز ثلاثي)',    'Granulocytes GRAN # (3-part)',    'numeric','10^3/µL', '{"10^9/L":1}', 2, 0, 500, 'hematology', 1111),
 ('hs_crp',          'lab','inflammation','CRP عالي الحساسية (hs-CRP)',    'High-sensitivity CRP (hs-CRP)',   'numeric','mg/L',    '{"mg/dL":10}', 2, 0, 500, 'cardiology', 1125),
 -- glucose metabolism
 ('c_peptide',       'lab','chemistry','الببتيد سي C-peptide',              'C-peptide',                       'numeric','ng/mL',   '{"nmol/L":3.02}', 2, 0, 50, 'endocrinology', 1235),
 -- lipids and cardiac markers
 ('apob',            'lab','lipids',  'أبو ليبوبروتين B (ApoB)',            'Apolipoprotein B (ApoB)',         'numeric','mg/dL',   '{"g/L":100}', 0, 0, 500, 'cardiology', 1640),
 ('lipoprotein_a',   'lab','lipids',  'ليبوبروتين (أ) Lp(a)',               'Lipoprotein(a)',                  'numeric','mg/dL',   '{}', 0, 0, 1000, 'cardiology', 1650),
 ('nt_probnp',       'lab','cardiac', 'NT-proBNP',                          'NT-proBNP',                       'numeric','pg/mL',   '{"ng/L":1}', 0, 0, 100000, 'cardiology', 1660),
 ('troponin_hs',     'lab','cardiac', 'تروبونين عالي الحساسية',             'High-sensitivity troponin',       'numeric','ng/L',    '{"pg/mL":1}', 0, 0, 100000, 'cardiology', 1665),
 -- hormones
 ('acth',            'lab','hormones','ACTH',                               'ACTH',                            'numeric','pg/mL',   '{"pmol/L":4.54}', 1, 0, 5000, 'endocrinology', 1735),
 ('shbg',            'lab','hormones','SHBG',                               'Sex hormone-binding globulin (SHBG)','numeric','nmol/L','{}', 1, 0, 500, 'endocrinology', 1755),
 ('testosterone_free','lab','hormones','التستوستيرون الحر',                 'Free testosterone',               'numeric','pg/mL',   '{}', 1, 0, 1000, 'endocrinology', 1756),
 -- vitamins, minerals, iron studies
 ('tsat',            'lab','vitamins','تشبع الترانسفرين TSAT',              'Transferrin saturation (TSAT)',   'numeric','%',       '{}', 0, 0, 100, 'hematology', 1855),
 ('zinc',            'lab','vitamins','الزنك',                              'Zinc',                            'numeric','µg/dL',   '{"µmol/L":6.54}', 0, 0, 1000, 'clinical_nutrition', 1860),
 ('homocysteine',    'lab','vitamins','الهوموسيستين',                       'Homocysteine',                    'numeric','µmol/L',  '{}', 1, 0, 500, 'cardiology', 1870),
 -- urinalysis: physical and microscopic findings
 ('urine_color',     'lab','urinalysis','لون البول',                        'Urine colour',                    'text',   null,      '{}', 0, null, null, 'nephrology', 1995),
 ('urine_appearance','lab','urinalysis','مظهر البول (الصفاء)',              'Urine appearance (clarity)',      'text',   null,      '{}', 0, null, null, 'nephrology', 1996),
 ('urine_bilirubin', 'lab','urinalysis','البيليروبين في البول',             'Urine bilirubin',                 'text',   null,      '{}', 0, null, null, 'gastroenterology', 2045),
 ('urine_urobilinogen','lab','urinalysis','اليوروبيلينوجين في البول',       'Urine urobilinogen',              'text',   null,      '{}', 0, null, null, 'gastroenterology', 2046),
 ('urine_epithelial','lab','urinalysis','الخلايا الظهارية في البول',        'Urine epithelial cells',          'text',   null,      '{}', 0, null, null, 'urology', 2091),
 ('urine_casts',     'lab','urinalysis','الأسطوانات في البول',              'Urine casts',                     'text',   null,      '{}', 0, null, null, 'nephrology', 2092),
 ('urine_crystals',  'lab','urinalysis','البلورات في البول',                'Urine crystals',                  'text',   null,      '{}', 0, null, null, 'urology', 2093),
 ('urine_mucus',     'lab','urinalysis','المخاط في البول',                  'Urine mucus',                     'text',   null,      '{}', 0, null, null, 'urology', 2094),
 ('urine_bacteria',  'lab','urinalysis','الجراثيم في البول',                'Urine bacteria',                  'text',   null,      '{}', 0, null, null, 'urology', 2096),
 -- stool
 ('stool_elastase',  'lab','stool',   'إيلاستاز البراز',                    'Fecal elastase-1',                'numeric','µg/g',    '{}', 0, 0, 2000, 'gastroenterology', 2125),
 ('stool_c_difficile','lab','stool',  'فحص المطثية العسيرة C. difficile',  'C. difficile (toxin / GDH)',      'text',   null,      '{}', 0, null, null, 'gastroenterology', 2135),
 -- immunology and infection screening
 ('igg',             'lab','immunology','الغلوبولين المناعي IgG',           'Immunoglobulin G (IgG)',          'numeric','mg/dL',   '{"g/L":100}', 0, 0, 10000, 'allergy_immunology', 2231),
 ('iga',             'lab','immunology','الغلوبولين المناعي IgA',           'Immunoglobulin A (IgA)',          'numeric','mg/dL',   '{"g/L":100}', 0, 0, 5000, 'allergy_immunology', 2232),
 ('igm',             'lab','immunology','الغلوبولين المناعي IgM',           'Immunoglobulin M (IgM)',          'numeric','mg/dL',   '{"g/L":100}', 0, 0, 5000, 'allergy_immunology', 2233),
 ('ttg_iga',         'lab','immunology','أضداد الغلوتين tTG-IgA',           'Anti-tTG IgA',                    'numeric','U/mL',    '{}', 1, 0, 10000, 'gastroenterology', 2236),
 ('anti_hbs',        'lab','infection','أضداد سطح التهاب الكبد B (Anti-HBs)','Anti-HBs',                       'numeric','mIU/mL',  '{"IU/L":1}', 0, 0, 100000, 'infectious_disease', 2241),
 ('anti_hbc',        'lab','infection','أضداد لب التهاب الكبد B (Anti-HBc)','Anti-HBc (total)',               'text',   null,      '{}', 0, null, null, 'infectious_disease', 2242),
 ('syphilis',        'lab','infection','الزهري (RPR / TPHA)',               'Syphilis (RPR / TPHA)',           'text',   null,      '{}', 0, null, null, 'infectious_disease', 2255),
 ('quantiferon',     'lab','infection','كوانتيفيرون للسل (IGRA)',           'QuantiFERON-TB (IGRA)',           'text',   null,      '{}', 0, null, null, 'infectious_disease', 2265),
 ('afb_smear',       'lab','microbiology','بحث عصيات السل في القشع (AFB)', 'AFB smear (sputum)',              'text',   null,      '{}', 0, null, null, 'pulmonology', 2272);

insert into public.observation_types (code, category, lab_group, name_ar, name_en, value_kind, default_unit, unit_conversions,
                                      decimals, plausible_min, plausible_max, default_specialty_id, sort)
select o.code, o.category, o.lab_group, o.name_ar, o.name_en, o.kind, o.unit, o.conv, o.dec, o.pmin, o.pmax,
       (select s.id from public.medical_specialties s where s.code = o.spec), o.sort
  from _ot2 o
on conflict (code) do nothing;
drop table _ot2;

-- units printed by labs that are the same quantity as the default unit (or a fixed multiple of it)
update public.observation_types set unit_conversions = unit_conversions || v.conv
  from (values
    ('wbc',       '{"10^9/L":1}'::jsonb),
    ('platelets', '{"10^9/L":1}'::jsonb),
    ('rbc',       '{"10^12/L":1}'::jsonb),
    ('ft4',       '{"ng/L":0.1}'::jsonb),
    ('tsh',       '{"µIU/mL":1,"uIU/mL":1}'::jsonb),
    ('insulin',   '{"mIU/L":1,"pmol/L":0.144}'::jsonb),
    ('mchc',      '{"g/L":0.1}'::jsonb)
  ) as v(code, conv)
 where observation_types.code = v.code;

-- ---------------------------------------------------------------- 2) date precision
-- day = exact date; month / year = only that much is known (stored as the 1st of the month / 1 January);
-- approx = "around <year>". An unknown date is simply null.
alter table public.conditions      add column date_precision text not null default 'day' check (date_precision in ('day', 'month', 'year', 'approx'));
alter table public.medications     add column date_precision text not null default 'day' check (date_precision in ('day', 'month', 'year', 'approx'));
alter table public.procedures      add column date_precision text not null default 'day' check (date_precision in ('day', 'month', 'year', 'approx'));
alter table public.imaging_studies add column date_precision text not null default 'day' check (date_precision in ('day', 'month', 'year', 'approx'));
alter table public.immunizations   add column date_precision text not null default 'day' check (date_precision in ('day', 'month', 'year', 'approx'));
comment on column public.conditions.date_precision is 'Precision of onset_date.';
comment on column public.medications.date_precision is 'Precision of start_date.';
comment on column public.procedures.date_precision is 'Precision of performed_on.';
comment on column public.imaging_studies.date_precision is 'Precision of performed_on.';
comment on column public.immunizations.date_precision is 'Precision of administered_on.';

alter table public.imaging_studies alter column performed_on drop not null;
alter table public.procedures alter column performed_on drop not null;

-- ---------------------------------------------------------------- 3) suggested vs. requested tests
alter table public.test_orders drop constraint if exists test_orders_status_check;
alter table public.test_orders add constraint test_orders_status_check check (status in ('suggested', 'requested', 'done', 'cancelled'));
alter table public.test_orders add column ordered_by text check (ordered_by is null or length(ordered_by) <= 200);
comment on column public.test_orders.ordered_by is 'Clinician who ordered the test (free text).';

-- ---------------------------------------------------------------- shared view: precision travels with the dates;
-- imaging and procedures without a known date are still shared (a date filter cannot exclude what has no date).
create or replace function public.share_bundle(p_session_token text, p_ip_hash text default null, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_share uuid; v_sid uuid; v_status text;
  s public.medical_shares;
  p public.patients;
  v_spec uuid[];
  v_from date; v_to date;
  v_specs jsonb;
  r jsonb;
begin
  select o_share_id, o_session_id, o_status into v_share, v_sid, v_status from app.resolve_share_session(p_session_token);
  if v_status <> 'ok' then return jsonb_build_object('status', 'expired'); end if;
  select * into s from public.medical_shares where id = v_share;
  select * into p from public.patients where id = s.patient_id;

  v_spec := case when s.scope_kind = 'specialty' then s.specialty_ids else null end;
  v_from := coalesce(s.date_from, '-infinity'::date);
  v_to := coalesce(s.date_to, 'infinity'::date);

  select coalesce(jsonb_agg(jsonb_build_object('code', m.code, 'name_ar', m.name_ar, 'name_en', m.name_en) order by m.sort), '[]')
    into v_specs from public.medical_specialties m where m.id = any(s.specialty_ids);

  r := jsonb_build_object(
    'status', 'ok',
    'meta', jsonb_build_object(
      'title', s.title, 'recipient_label', s.recipient_label, 'scope_kind', s.scope_kind, 'specialties', v_specs,
      'include', to_jsonb(s.include), 'date_from', s.date_from, 'date_to', s.date_to,
      'expires_at', s.expires_at, 'allow_download', s.allow_download, 'allow_print', s.allow_print,
      'allow_notes', s.allow_notes, 'generated_at', now()),
    'patient', jsonb_build_object(
      'mrn', p.mrn, 'full_name', p.full_name, 'full_name_en', p.full_name_en, 'date_of_birth', p.date_of_birth,
      'age_years', date_part('year', age(current_date, p.date_of_birth))::int, 'sex', p.sex, 'nationality', p.nationality,
      'blood_group', case when p.blood_abo is null then null else p.blood_abo || coalesce(p.blood_rh, '') end,
      'blood_group_verified', p.blood_group_verified,
      'phone', case when 'contact' = any(s.include) then p.phone end),
    'allergy_assertion', p.allergy_assertion,
    'allergies', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'substance', a.substance, 'category', a.category, 'reaction', a.reaction, 'severity', a.severity,
        'certainty', a.certainty, 'onset_date', a.onset_date, 'notes', a.notes) order by a.substance)
      from public.allergies a
      where a.patient_id = p.id and a.status = 'active' and a.record_status = 'active' and a.certainty <> 'refuted'), '[]'),
    'chronic_conditions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'icd10_code', c.icd10_code, 'category', c.category, 'clinical_status', c.clinical_status,
        'certainty', c.certainty, 'severity', c.severity, 'onset_date', c.onset_date, 'date_precision', c.date_precision, 'notes', c.notes) order by c.name)
      from public.conditions c
      where c.patient_id = p.id and c.record_status = 'active'
        and c.category in ('chronic', 'congenital', 'genetic', 'disability')
        and c.clinical_status in ('active', 'recurrence', 'inactive', 'remission')
        and c.certainty <> 'refuted'
        and (not c.sensitive or s.include_sensitive or exists (
              select 1 from public.medical_share_items i where i.share_id = s.id and i.table_name = 'conditions' and i.record_id = c.id))), '[]'),
    'medications', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name_brand', m.name_brand, 'name_generic', m.name_generic, 'strength', m.strength, 'form', m.form,
        'dose', m.dose, 'route', m.route, 'frequency', m.frequency, 'as_needed', m.as_needed, 'origin', m.origin,
        'status', m.status, 'start_date', m.start_date, 'date_precision', m.date_precision, 'indication', m.indication, 'instructions', m.instructions)
        order by coalesce(m.name_generic, m.name_brand))
      from public.medications m
      where m.patient_id = p.id and m.record_status = 'active' and m.status in ('active', 'on_hold')
        and (not m.sensitive or s.include_sensitive)), '[]')
  );

  if 'contact' = any(s.include) then
    r := r || jsonb_build_object('emergency_contacts', coalesce((select jsonb_agg(jsonb_build_object(
        'full_name', e.full_name, 'relation', e.relation, 'phone', e.phone, 'is_legal_representative', e.is_legal_representative))
      from public.emergency_contacts e where e.patient_id = p.id), '[]'));
  end if;

  if 'other_conditions' = any(s.include) then
    r := r || jsonb_build_object('other_conditions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'icd10_code', c.icd10_code, 'category', c.category, 'clinical_status', c.clinical_status,
        'certainty', c.certainty, 'onset_date', c.onset_date, 'date_precision', c.date_precision, 'resolved_date', c.resolved_date, 'specialty_id', c.specialty_id)
        order by c.onset_date desc nulls last)
      from public.conditions c
      where c.patient_id = p.id and c.record_status = 'active'
        and c.category not in ('chronic', 'congenital', 'genetic', 'disability')
        and (v_spec is null or c.specialty_id = any(v_spec))
        and (not c.sensitive or s.include_sensitive)
        and (s.scope_kind <> 'custom' or exists (select 1 from public.medical_share_items i
              where i.share_id = s.id and i.table_name = 'conditions' and i.record_id = c.id))), '[]'));
  end if;

  if 'encounters' = any(s.include) then
    r := r || jsonb_build_object('encounters', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'status', e.status, 'started_at', e.started_at, 'ended_at', e.ended_at,
        'facility_name', e.facility_name, 'practitioner_name', e.practitioner_name, 'reason', e.reason,
        'symptoms', e.symptoms, 'examination', e.examination, 'assessment', e.assessment, 'plan', e.plan,
        'summary', e.summary, 'discharge_summary', e.discharge_summary, 'specialty_id', e.specialty_id)
        order by e.started_at desc)
      from public.encounters e
      where e.patient_id = p.id and e.record_status = 'active'
        and (v_spec is null or e.specialty_id = any(v_spec))
        and e.started_at::date between v_from and v_to
        and (s.scope_kind <> 'custom' or exists (select 1 from public.medical_share_items i
              where i.share_id = s.id and i.table_name = 'encounters' and i.record_id = e.id))), '[]'));
  end if;

  if 'procedures' = any(s.include) then
    r := r || jsonb_build_object('procedures', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'kind', x.kind, 'name', x.name, 'performed_on', x.performed_on, 'date_precision', x.date_precision, 'body_site', x.body_site,
        'facility_name', x.facility_name, 'operator_name', x.operator_name, 'indication', x.indication,
        'outcome', x.outcome, 'complications', x.complications, 'notes', x.notes, 'specialty_id', x.specialty_id)
        order by x.performed_on desc nulls last)
      from public.procedures x
      where x.patient_id = p.id and x.record_status = 'active'
        and (v_spec is null or x.specialty_id = any(v_spec))
        and (x.performed_on is null or x.performed_on between v_from and v_to)
        and (s.scope_kind <> 'custom' or exists (select 1 from public.medical_share_items i
              where i.share_id = s.id and i.table_name = 'procedures' and i.record_id = x.id))), '[]'));
  end if;

  if 'imaging' = any(s.include) then
    r := r || jsonb_build_object('imaging', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'modality', x.modality, 'body_site', x.body_site, 'performed_on', x.performed_on, 'date_precision', x.date_precision,
        'facility_name', x.facility_name, 'radiologist_name', x.radiologist_name, 'findings', x.findings,
        'impression', x.impression, 'document_id', x.document_id, 'specialty_id', x.specialty_id)
        order by x.performed_on desc nulls last)
      from public.imaging_studies x
      where x.patient_id = p.id and x.record_status = 'active'
        and (v_spec is null or x.specialty_id = any(v_spec))
        and (x.performed_on is null or x.performed_on between v_from and v_to)
        and (s.scope_kind <> 'custom' or exists (select 1 from public.medical_share_items i
              where i.share_id = s.id and i.table_name = 'imaging_studies' and i.record_id = x.id))), '[]'));
  end if;

  if 'family_history' = any(s.include) then
    r := r || jsonb_build_object('family_history', coalesce((select jsonb_agg(jsonb_build_object(
        'relation', f.relation, 'condition_name', f.condition_name, 'age_at_onset', f.age_at_onset,
        'deceased', f.deceased, 'certainty', f.certainty, 'notes', f.notes))
      from public.family_history f where f.patient_id = p.id and f.record_status = 'active'), '[]'));
  end if;

  if 'immunizations' = any(s.include) then
    r := r || jsonb_build_object('immunizations', coalesce((select jsonb_agg(jsonb_build_object(
        'vaccine_name', x.vaccine_name, 'dose_number', x.dose_number, 'status', x.status,
        'administered_on', x.administered_on, 'date_precision', x.date_precision, 'next_due_on', x.next_due_on) order by x.administered_on desc nulls last)
      from public.immunizations x where x.patient_id = p.id and x.record_status = 'active'), '[]'));
  end if;

  if 'care_plans' = any(s.include) then
    r := r || jsonb_build_object('care_plans', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'title', x.title, 'status', x.status, 'start_date', x.start_date, 'end_date', x.end_date,
        'goals', x.goals, 'instructions', x.instructions, 'specialty_id', x.specialty_id))
      from public.care_plans x
      where x.patient_id = p.id and x.record_status = 'active'
        and (v_spec is null or x.specialty_id = any(v_spec))
        and (s.scope_kind <> 'custom' or exists (select 1 from public.medical_share_items i
              where i.share_id = s.id and i.table_name = 'care_plans' and i.record_id = x.id))), '[]'));
  end if;

  if 'notes' = any(s.include) then
    r := r || jsonb_build_object('notes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'kind', x.kind, 'title', x.title, 'body', x.body, 'author_name', x.author_name,
        'noted_at', x.noted_at, 'specialty_id', x.specialty_id) order by x.noted_at desc)
      from public.clinical_notes x
      where x.patient_id = p.id and x.record_status = 'active'
        and (v_spec is null or x.specialty_id = any(v_spec))
        and x.noted_at::date between v_from and v_to
        and (s.scope_kind <> 'custom' or exists (select 1 from public.medical_share_items i
              where i.share_id = s.id and i.table_name = 'clinical_notes' and i.record_id = x.id))), '[]'));
  end if;

  if 'specialty_records' = any(s.include) then
    r := r || jsonb_build_object('specialty_records', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'specialty_id', x.specialty_id, 'record_type_code', t.code, 'record_type_name_ar', t.name_ar,
        'record_type_name_en', t.name_en, 'fields', t.fields, 'occurred_on', x.occurred_on, 'data', x.data, 'notes', x.notes)
        order by x.occurred_on desc)
      from public.specialty_records x
      join public.specialty_record_types t on t.id = x.record_type_id
      where x.patient_id = p.id and x.record_status = 'active'
        and (v_spec is null or x.specialty_id = any(v_spec))
        and x.occurred_on between v_from and v_to
        and (s.scope_kind <> 'custom' or exists (select 1 from public.medical_share_items i
              where i.share_id = s.id and i.table_name = 'specialty_records' and i.record_id = x.id))), '[]'));
  end if;

  if 'observations' = any(s.include) then
    r := r || jsonb_build_object('observations', coalesce((select jsonb_agg(row_to_json(q)::jsonb order by q.effective_at desc) from (
        select o.id, t.code as type_code, t.name_ar, t.name_en, t.category, t.lab_group, t.value_kind,
               o.custom_name, o.value_num, o.value_num2, o.value_text, o.unit, o.effective_at, o.setting, o.context,
               o.interpretation, o.ref_low, o.ref_high, o.ref_text, o.status, (o.supersedes_id is not null) as is_correction,
               o.report_id, o.notes
          from public.observations o
          join public.observation_types t on t.id = o.type_id
         where o.patient_id = p.id and o.status in ('preliminary', 'final')
           and o.effective_at::date between v_from and v_to
           and (case
                  when s.scope_kind = 'custom' then exists (select 1 from public.medical_share_items i
                         where i.share_id = s.id and i.table_name = 'observations' and i.record_id = o.id)
                  when cardinality(s.observation_type_ids) > 0 then o.type_id = any(s.observation_type_ids)
                  when v_spec is not null then coalesce(o.specialty_id, t.default_specialty_id) = any(v_spec)
                  else true
                end)
         order by o.effective_at desc
         limit 5000) q), '[]'));
  end if;

  if 'documents' = any(s.include) then
    r := r || jsonb_build_object('documents', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'title', d.title, 'doc_type', d.doc_type, 'document_date', d.document_date, 'mime_type', d.mime_type,
        'size_bytes', d.size_bytes, 'description', d.description, 'specialty_id', d.specialty_id)
        order by d.document_date desc nulls last)
      from public.medical_documents d
      where d.patient_id = p.id and d.record_status = 'active'
        and (v_spec is null or d.specialty_id = any(v_spec))
        and (d.document_date is null or d.document_date between v_from and v_to)
        and (case
               when s.scope_kind = 'custom' then exists (select 1 from public.medical_share_items i
                      where i.share_id = s.id and i.table_name = 'medical_documents' and i.record_id = d.id)
               else d.sensitivity <> 'restricted'
             end)), '[]'));
  end if;

  r := r || jsonb_build_object('specialties', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'code', m.code, 'name_ar', m.name_ar, 'name_en', m.name_en)) from public.medical_specialties m), '[]'));

  perform app.share_log(s.id, 'viewed', p_ip_hash, p_user_agent, jsonb_build_object('session', v_sid));
  return r;
end $$;
