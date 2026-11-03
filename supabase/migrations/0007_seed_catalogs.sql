-- 0007_seed_catalogs: specialties, measurement/lab catalog, screening bands, specialty form definitions.
-- Reference data only: it contains no patient information. Safe to re-run (on conflict do nothing).

-- ---------------------------------------------------------------- specialties
insert into public.medical_specialties (code, name_ar, name_en, icon, kind, sort) values
  ('family_medicine',       'الطب العام وطب الأسرة',              'Family medicine & general practice', 'stethoscope',     'clinical', 10),
  ('internal_medicine',     'الطب الباطني',                       'Internal medicine',                  'activity',        'clinical', 20),
  ('pediatrics',            'طب الأطفال',                         'Pediatrics',                         'baby',            'clinical', 30),
  ('emergency',             'طب الطوارئ',                         'Emergency medicine',                 'siren',           'clinical', 40),
  ('general_surgery',       'الجراحة العامة',                     'General surgery',                    'scissors',        'clinical', 50),
  ('obgyn',                 'النساء والولادة',                    'Obstetrics & gynecology',            'venus',           'clinical', 60),
  ('dentistry',             'طب الأسنان',                         'Dentistry',                          'smile',           'clinical', 70),
  ('ophthalmology',         'طب العيون',                          'Ophthalmology',                      'eye',             'clinical', 80),
  ('ent',                   'الأنف والأذن والحنجرة',              'Ear, nose & throat (ENT)',           'ear',             'clinical', 90),
  ('cardiology',            'أمراض القلب والأوعية الدموية',       'Cardiology',                         'heart-pulse',     'clinical', 100),
  ('endocrinology',         'الغدد الصماء والسكري',               'Endocrinology & diabetes',           'droplets',        'clinical', 110),
  ('nephrology',            'أمراض الكلى',                        'Nephrology',                         'bean',            'clinical', 120),
  ('gastroenterology',      'الجهاز الهضمي والكبد',               'Gastroenterology & hepatology',      'soup',            'clinical', 130),
  ('pulmonology',           'الجهاز التنفسي والصدر',              'Pulmonology & chest',                'wind',            'clinical', 140),
  ('neurology',             'طب الأعصاب',                         'Neurology',                          'brain',           'clinical', 150),
  ('orthopedics',           'جراحة العظام',                       'Orthopedic surgery',                 'bone',            'clinical', 160),
  ('rheumatology',          'الروماتيزم',                         'Rheumatology',                       'hand',            'clinical', 170),
  ('dermatology',           'الأمراض الجلدية',                    'Dermatology',                        'scan-face',       'clinical', 180),
  ('psychiatry',            'الطب النفسي والصحة النفسية',         'Psychiatry & mental health',         'brain-circuit',   'clinical', 190),
  ('hematology',            'أمراض الدم',                         'Hematology',                         'droplet',         'clinical', 200),
  ('oncology',              'الأورام',                            'Oncology',                           'ribbon',          'clinical', 210),
  ('infectious_disease',    'الأمراض المعدية',                    'Infectious diseases',                'bug',             'clinical', 220),
  ('urology',               'المسالك البولية',                    'Urology',                            'milestone',       'clinical', 230),
  ('reproductive_health',   'العقم والصحة الإنجابية',             'Fertility & reproductive health',    'flower',          'clinical', 240),
  ('physiotherapy',         'العلاج الطبيعي وإعادة التأهيل',      'Physiotherapy & rehabilitation',     'person-standing', 'clinical', 250),
  ('clinical_nutrition',    'التغذية العلاجية',                   'Clinical nutrition',                 'apple',           'clinical', 260),
  ('allergy_immunology',    'الحساسية والمناعة',                  'Allergy & immunology',               'shield',          'clinical', 270),
  ('medical_genetics',      'الوراثة الطبية',                     'Medical genetics',                   'dna',             'clinical', 280),
  ('anesthesia_icu',        'التخدير والرعاية المركزة',           'Anesthesia & intensive care',        'bed',             'clinical', 290),
  ('geriatrics',            'طب الشيخوخة',                        'Geriatrics',                         'users',           'clinical', 300),
  ('occupational_medicine', 'الطب المهني',                        'Occupational medicine',              'hard-hat',        'clinical', 310),
  ('cardiovascular_surgery','جراحة القلب والأوعية',               'Cardiovascular surgery',             'heart',           'clinical', 320),
  ('neurosurgery',          'جراحة المخ والأعصاب',                'Neurosurgery',                       'brain-cog',       'clinical', 330),
  ('laboratory',            'المختبرات الطبية',                   'Medical laboratory',                 'flask-conical',   'support',  500),
  ('radiology',             'الأشعة والتصوير الطبي',              'Radiology & imaging',                'scan',            'support',  510),
  ('pharmacy',              'الصيدلية والأدوية',                  'Pharmacy & medications',             'pill',            'support',  520),
  ('immunization',          'التطعيمات',                          'Immunizations',                      'syringe',         'support',  530),
  ('preventive',            'الفحوصات الوقائية',                  'Preventive screening',               'shield-check',    'support',  540),
  ('home_care',             'التأهيل والرعاية المنزلية',          'Rehabilitation & home care',         'house',           'support',  550),
  ('medical_reports',       'التقارير الطبية',                    'Medical reports',                    'file-text',       'support',  560),
  ('external_records',      'المستندات والسجلات الخارجية',        'External documents & records',       'folder-open',     'support',  570)
on conflict (code) do nothing;

-- ---------------------------------------------------------------- observation types
-- columns: code, category, lab_group, name_ar, name_en, kind, unit, conversions, decimals, min, max, default specialty, sort
create temp table _ot (code text, category text, lab_group text, name_ar text, name_en text, kind text, unit text,
                       conv jsonb, dec int, pmin numeric, pmax numeric, spec text, sort int);
insert into _ot values
 -- vital signs and home measurements
 ('blood_pressure',   'vital', null, 'ضغط الدم',                  'Blood pressure',          'bp',      'mmHg',  '{}', 0, 40, 300, 'cardiology',   10),
 ('heart_rate',       'vital', null, 'معدل ضربات القلب',          'Heart rate',              'numeric', 'bpm',   '{}', 0, 20, 300, 'cardiology',   20),
 ('blood_glucose',    'vital', null, 'سكر الدم',                  'Blood glucose',           'numeric', 'mg/dL', '{"mmol/L":18.0182}', 0, 10, 1500, 'endocrinology', 30),
 ('cgm_glucose',      'vital', null, 'سكر الدم المستمر (CGM)',    'Continuous glucose (CGM)','numeric', 'mg/dL', '{"mmol/L":18.0182}', 0, 10, 1500, 'endocrinology', 35),
 ('weight',           'vital', null, 'الوزن',                     'Weight',                  'numeric', 'kg',    '{"lb":0.45359237}', 1, 0.3, 700, null, 40),
 ('height',           'vital', null, 'الطول',                     'Height',                  'numeric', 'cm',    '{"m":100,"in":2.54}', 1, 20, 260, null, 50),
 ('body_temperature', 'vital', null, 'درجة حرارة الجسم',          'Body temperature',        'numeric', '°C',    '{}', 1, 25, 45, null, 60),
 ('spo2',             'vital', null, 'تشبع الأكسجين SpO2',        'Oxygen saturation (SpO2)','numeric', '%',     '{}', 0, 30, 100, 'pulmonology',  70),
 ('respiratory_rate', 'vital', null, 'معدل التنفس',               'Respiratory rate',        'numeric', '/min',  '{}', 0, 4, 80, 'pulmonology',    80),
 ('waist_circumference','vital', null, 'محيط الخصر',              'Waist circumference',     'numeric', 'cm',    '{"in":2.54}', 1, 20, 300, 'endocrinology', 90),
 ('peak_flow',        'vital', null, 'ذروة تدفق الزفير',          'Peak expiratory flow',    'numeric', 'L/min', '{}', 0, 20, 900, 'pulmonology',  100),
 ('pain_score',       'vital', null, 'درجة الألم (0-10)',         'Pain score (0-10)',       'numeric', '/10',   '{}', 0, 0, 10, null, 110),
 ('sleep_duration',   'activity', null, 'مدة النوم',              'Sleep duration',          'numeric', 'h',     '{}', 1, 0, 24, null, 120),
 ('daily_steps',      'activity', null, 'عدد الخطوات اليومية',    'Daily steps',             'numeric', 'steps', '{}', 0, 0, 200000, null, 130),
 ('other_measurement','other', null, 'قياس آخر',                  'Other measurement',       'numeric', null,    '{}', 2, null, null, null, 190),
 -- hematology
 ('wbc',        'lab', 'hematology', 'كريات الدم البيضاء WBC',   'White blood cells (WBC)',  'numeric', '10^3/µL', '{}', 2, 0, 1000, 'hematology', 1010),
 ('rbc',        'lab', 'hematology', 'كريات الدم الحمراء RBC',   'Red blood cells (RBC)',    'numeric', '10^6/µL', '{}', 2, 0, 15, 'hematology', 1020),
 ('hemoglobin', 'lab', 'hematology', 'الهيموغلوبين Hb',          'Hemoglobin (Hb)',          'numeric', 'g/dL',    '{"g/L":0.1}', 1, 1, 30, 'hematology', 1030),
 ('hematocrit', 'lab', 'hematology', 'الهيماتوكريت Hct',         'Hematocrit (Hct)',         'numeric', '%',       '{}', 1, 3, 80, 'hematology', 1040),
 ('mcv',        'lab', 'hematology', 'حجم الكرية المتوسط MCV',   'Mean corpuscular volume (MCV)','numeric','fL',  '{}', 1, 30, 200, 'hematology', 1050),
 ('mch',        'lab', 'hematology', 'MCH',                      'Mean corpuscular hemoglobin (MCH)','numeric','pg','{}', 1, 5, 80, 'hematology', 1060),
 ('mchc',       'lab', 'hematology', 'MCHC',                     'MCHC',                     'numeric', 'g/dL',    '{}', 1, 10, 50, 'hematology', 1070),
 ('platelets',  'lab', 'hematology', 'الصفائح الدموية PLT',      'Platelets (PLT)',          'numeric', '10^3/µL', '{}', 0, 0, 3000, 'hematology', 1080),
 ('neutrophils_pct','lab','hematology','العدلات %',              'Neutrophils %',            'numeric', '%',       '{}', 1, 0, 100, 'hematology', 1090),
 ('lymphocytes_pct','lab','hematology','اللمفاويات %',           'Lymphocytes %',            'numeric', '%',       '{}', 1, 0, 100, 'hematology', 1100),
 ('esr',        'lab', 'inflammation','سرعة الترسب ESR',         'Erythrocyte sedimentation rate (ESR)','numeric','mm/h','{}', 0, 0, 300, 'rheumatology', 1110),
 ('crp',        'lab', 'inflammation','البروتين التفاعلي CRP',   'C-reactive protein (CRP)', 'numeric', 'mg/L',    '{"mg/dL":10}', 1, 0, 1000, 'rheumatology', 1120),
 ('blood_group','lab', 'hematology', 'فصيلة الدم وعامل Rh',      'Blood group & Rh',         'text',    null,      '{}', 0, null, null, 'hematology', 1130),
 -- glucose control, kidney, electrolytes
 ('glucose_fasting_lab','lab','chemistry','سكر الدم الصائم (مختبر)','Fasting glucose (lab)', 'numeric', 'mg/dL', '{"mmol/L":18.0182}', 0, 10, 1500, 'endocrinology', 1200),
 ('glucose_random_lab', 'lab','chemistry','سكر الدم العشوائي (مختبر)','Random glucose (lab)','numeric', 'mg/dL', '{"mmol/L":18.0182}', 0, 10, 1500, 'endocrinology', 1210),
 ('glucose_postprandial_lab','lab','chemistry','سكر الدم بعد الوجبة (مختبر)','Post-meal glucose (lab)','numeric','mg/dL','{"mmol/L":18.0182}',0,10,1500,'endocrinology',1220),
 ('hba1c',      'lab', 'chemistry', 'السكر التراكمي HbA1c',      'HbA1c',                    'numeric', '%',       '{}', 1, 2, 25, 'endocrinology', 1230),
 ('urea',       'lab', 'kidney',    'اليوريا',                   'Urea',                     'numeric', 'mg/dL',   '{"mmol/L":6.006}', 1, 1, 500, 'nephrology', 1300),
 ('bun',        'lab', 'kidney',    'نيتروجين اليوريا BUN',      'Blood urea nitrogen (BUN)','numeric', 'mg/dL',   '{"mmol/L":2.8}', 1, 1, 300, 'nephrology', 1310),
 ('creatinine', 'lab', 'kidney',    'الكرياتينين',               'Creatinine',               'numeric', 'mg/dL',   '{"µmol/L":0.011312}', 2, 0.05, 30, 'nephrology', 1320),
 ('egfr',       'lab', 'kidney',    'معدل الترشيح الكبيبي eGFR', 'eGFR',                     'numeric', 'mL/min/1.73m²','{}', 0, 0, 200, 'nephrology', 1330),
 ('uric_acid',  'lab', 'kidney',    'حمض اليوريك',               'Uric acid',                'numeric', 'mg/dL',   '{"µmol/L":0.016812}', 1, 0.5, 30, 'rheumatology', 1340),
 ('sodium',     'lab', 'electrolytes','الصوديوم',                'Sodium',                   'numeric', 'mmol/L',  '{"mEq/L":1}', 0, 80, 200, 'nephrology', 1350),
 ('potassium',  'lab', 'electrolytes','البوتاسيوم',              'Potassium',                'numeric', 'mmol/L',  '{"mEq/L":1}', 1, 1, 12, 'nephrology', 1360),
 ('chloride',   'lab', 'electrolytes','الكلوريد',                'Chloride',                 'numeric', 'mmol/L',  '{"mEq/L":1}', 0, 50, 150, 'nephrology', 1370),
 ('calcium',    'lab', 'electrolytes','الكالسيوم',               'Calcium',                  'numeric', 'mg/dL',   '{"mmol/L":4.008}', 1, 2, 20, 'endocrinology', 1380),
 ('magnesium',  'lab', 'electrolytes','المغنيسيوم',              'Magnesium',                'numeric', 'mg/dL',   '{"mmol/L":2.43}', 1, 0.3, 10, 'nephrology', 1390),
 ('phosphate',  'lab', 'electrolytes','الفوسفات',                'Phosphate',                'numeric', 'mg/dL',   '{"mmol/L":3.097}', 1, 0.3, 20, 'nephrology', 1400),
 -- liver
 ('alt',        'lab', 'liver', 'ALT (ناقلة أمين الألانين)',     'ALT',                      'numeric', 'U/L',     '{}', 0, 0, 10000, 'gastroenterology', 1500),
 ('ast',        'lab', 'liver', 'AST (ناقلة أمين الأسبارتات)',   'AST',                      'numeric', 'U/L',     '{}', 0, 0, 10000, 'gastroenterology', 1510),
 ('alp',        'lab', 'liver', 'الفوسفاتاز القلوي ALP',         'Alkaline phosphatase (ALP)','numeric','U/L',     '{}', 0, 0, 5000, 'gastroenterology', 1520),
 ('ggt',        'lab', 'liver', 'GGT',                           'GGT',                      'numeric', 'U/L',     '{}', 0, 0, 5000, 'gastroenterology', 1530),
 ('bilirubin_total','lab','liver','البيليروبين الكلي',           'Total bilirubin',          'numeric', 'mg/dL',   '{"µmol/L":0.05847}', 1, 0, 60, 'gastroenterology', 1540),
 ('bilirubin_direct','lab','liver','البيليروبين المباشر',        'Direct bilirubin',         'numeric', 'mg/dL',   '{"µmol/L":0.05847}', 1, 0, 60, 'gastroenterology', 1550),
 ('albumin',    'lab', 'liver', 'الألبومين',                     'Albumin',                  'numeric', 'g/dL',    '{"g/L":0.1}', 1, 0.5, 8, 'gastroenterology', 1560),
 ('total_protein','lab','liver','البروتين الكلي',                'Total protein',            'numeric', 'g/dL',    '{"g/L":0.1}', 1, 1, 15, 'gastroenterology', 1570),
 -- lipids
 ('cholesterol_total','lab','lipids','الكوليسترول الكلي',        'Total cholesterol',        'numeric', 'mg/dL',   '{"mmol/L":38.67}', 0, 30, 1500, 'cardiology', 1600),
 ('ldl',        'lab', 'lipids', 'الكوليسترول الضار LDL',        'LDL cholesterol',          'numeric', 'mg/dL',   '{"mmol/L":38.67}', 0, 5, 1000, 'cardiology', 1610),
 ('hdl',        'lab', 'lipids', 'الكوليسترول النافع HDL',       'HDL cholesterol',          'numeric', 'mg/dL',   '{"mmol/L":38.67}', 0, 3, 300, 'cardiology', 1620),
 ('triglycerides','lab','lipids','الدهون الثلاثية',              'Triglycerides',            'numeric', 'mg/dL',   '{"mmol/L":88.57}', 0, 10, 10000, 'cardiology', 1630),
 -- thyroid and hormones
 ('tsh',        'lab', 'thyroid', 'TSH',                         'TSH',                      'numeric', 'mIU/L',   '{}', 2, 0, 500, 'endocrinology', 1700),
 ('ft4',        'lab', 'thyroid', 'FT4',                         'Free T4 (FT4)',            'numeric', 'ng/dL',   '{"pmol/L":0.0777}', 2, 0, 20, 'endocrinology', 1710),
 ('ft3',        'lab', 'thyroid', 'FT3',                         'Free T3 (FT3)',            'numeric', 'pg/mL',   '{"pmol/L":0.651}', 2, 0, 30, 'endocrinology', 1720),
 ('cortisol',   'lab', 'hormones','الكورتيزول',                  'Cortisol',                 'numeric', 'µg/dL',   '{"nmol/L":0.03625}', 1, 0, 100, 'endocrinology', 1730),
 ('insulin',    'lab', 'hormones','الإنسولين',                   'Insulin',                  'numeric', 'µIU/mL',  '{}', 1, 0, 1000, 'endocrinology', 1740),
 ('testosterone','lab','hormones','التستوستيرون',                'Testosterone',             'numeric', 'ng/dL',   '{"nmol/L":28.84}', 0, 0, 3000, 'endocrinology', 1750),
 ('prolactin',  'lab', 'hormones','البرولاكتين',                 'Prolactin',                'numeric', 'ng/mL',   '{}', 1, 0, 2000, 'endocrinology', 1760),
 ('fsh',        'lab', 'hormones','FSH',                         'FSH',                      'numeric', 'mIU/mL',  '{}', 1, 0, 500, 'reproductive_health', 1770),
 ('lh',         'lab', 'hormones','LH',                          'LH',                       'numeric', 'mIU/mL',  '{}', 1, 0, 500, 'reproductive_health', 1780),
 ('estradiol',  'lab', 'hormones','استراديول',                   'Estradiol',                'numeric', 'pg/mL',   '{}', 0, 0, 10000, 'reproductive_health', 1790),
 -- vitamins and minerals
 ('vitamin_d',  'lab', 'vitamins','فيتامين د (25-OH)',           'Vitamin D (25-OH)',        'numeric', 'ng/mL',   '{"nmol/L":0.4006}', 1, 0, 400, 'endocrinology', 1800),
 ('vitamin_b12','lab', 'vitamins','فيتامين ب12',                 'Vitamin B12',              'numeric', 'pg/mL',   '{"pmol/L":1.355}', 0, 0, 10000, 'hematology', 1810),
 ('folate',     'lab', 'vitamins','الفولات',                     'Folate',                   'numeric', 'ng/mL',   '{"nmol/L":0.4414}', 1, 0, 200, 'hematology', 1820),
 ('ferritin',   'lab', 'vitamins','الفيريتين',                   'Ferritin',                 'numeric', 'ng/mL',   '{"µg/L":1}', 0, 0, 100000, 'hematology', 1830),
 ('iron',       'lab', 'vitamins','الحديد',                      'Serum iron',               'numeric', 'µg/dL',   '{"µmol/L":5.585}', 0, 0, 1000, 'hematology', 1840),
 ('tibc',       'lab', 'vitamins','سعة ارتباط الحديد TIBC',      'TIBC',                     'numeric', 'µg/dL',   '{"µmol/L":5.585}', 0, 0, 1000, 'hematology', 1850),
 -- coagulation
 ('pt',         'lab', 'coagulation','زمن البروثرومبين PT',      'Prothrombin time (PT)',    'numeric', 's',       '{}', 1, 3, 200, 'hematology', 1900),
 ('inr',        'lab', 'coagulation','INR',                      'INR',                      'numeric', 'ratio',   '{}', 2, 0.3, 20, 'hematology', 1910),
 ('aptt',       'lab', 'coagulation','aPTT',                     'aPTT',                     'numeric', 's',       '{}', 1, 5, 300, 'hematology', 1920),
 ('d_dimer',    'lab', 'coagulation','D-dimer',                  'D-dimer',                  'numeric', 'ng/mL FEU','{}', 0, 0, 100000, 'hematology', 1930),
 -- urinalysis
 ('urine_ph',   'lab', 'urinalysis','pH البول',                  'Urine pH',                 'numeric', 'pH',      '{}', 1, 3, 10, 'nephrology', 2000),
 ('urine_specific_gravity','lab','urinalysis','الكثافة النوعية للبول','Urine specific gravity','numeric','SG',   '{}', 3, 0.99, 1.06, 'nephrology', 2010),
 ('urine_protein','lab','urinalysis','بروتين البول',             'Urine protein',            'text',    null,      '{}', 0, null, null, 'nephrology', 2020),
 ('urine_glucose','lab','urinalysis','سكر البول',                'Urine glucose',            'text',    null,      '{}', 0, null, null, 'endocrinology', 2030),
 ('urine_ketones','lab','urinalysis','كيتونات البول',            'Urine ketones',            'text',    null,      '{}', 0, null, null, 'endocrinology', 2040),
 ('urine_blood','lab', 'urinalysis','دم في البول',               'Urine blood',              'text',    null,      '{}', 0, null, null, 'urology', 2050),
 ('urine_leukocytes','lab','urinalysis','كريات بيضاء في البول',  'Urine leukocytes',         'text',    null,      '{}', 0, null, null, 'urology', 2060),
 ('urine_nitrite','lab','urinalysis','نتريت البول',              'Urine nitrite',            'text',    null,      '{}', 0, null, null, 'urology', 2070),
 ('urine_rbc',  'lab', 'urinalysis','كريات حمراء في البول (مجهري)','Urine RBC (microscopy)', 'text',    null,      '{}', 0, null, null, 'urology', 2080),
 ('urine_wbc',  'lab', 'urinalysis','كريات بيضاء في البول (مجهري)','Urine WBC (microscopy)', 'text',    null,      '{}', 0, null, null, 'urology', 2090),
 ('urine_albumin_creatinine','lab','urinalysis','نسبة الألبومين/الكرياتينين في البول','Urine albumin/creatinine ratio','numeric','mg/g','{}',1,0,100000,'nephrology',2095),
 -- stool
 ('stool_occult_blood','lab','stool','دم خفي في البراز',        'Stool occult blood',       'text',    null,      '{}', 0, null, null, 'gastroenterology', 2100),
 ('stool_parasites','lab','stool','طفيليات البراز',              'Stool parasites',          'text',    null,      '{}', 0, null, null, 'gastroenterology', 2110),
 ('stool_calprotectin','lab','stool','كالبروتكتين البراز',       'Fecal calprotectin',       'numeric', 'µg/g',    '{}', 0, 0, 10000, 'gastroenterology', 2120),
 ('stool_pylori_antigen','lab','stool','مستضد جرثومة المعدة في البراز','H. pylori stool antigen','text', null,    '{}', 0, null, null, 'gastroenterology', 2130),
 -- immunology, infection, microbiology
 ('rheumatoid_factor','lab','immunology','العامل الرثواني RF',  'Rheumatoid factor (RF)',   'numeric', 'IU/mL',   '{}', 1, 0, 10000, 'rheumatology', 2200),
 ('anti_ccp',   'lab', 'immunology','Anti-CCP',                  'Anti-CCP',                 'numeric', 'U/mL',    '{}', 1, 0, 10000, 'rheumatology', 2210),
 ('ana',        'lab', 'immunology','الأجسام المضادة للنواة ANA','Antinuclear antibodies (ANA)','text', null,      '{}', 0, null, null, 'rheumatology', 2220),
 ('ige_total',  'lab', 'immunology','IgE الكلي',                 'Total IgE',                'numeric', 'IU/mL',   '{}', 0, 0, 100000, 'allergy_immunology', 2230),
 ('hbsag',      'lab', 'infection', 'HBsAg',                     'HBsAg',                    'text',    null,      '{}', 0, null, null, 'infectious_disease', 2240),
 ('hcv_ab',     'lab', 'infection', 'Anti-HCV',                  'Anti-HCV',                 'text',    null,      '{}', 0, null, null, 'infectious_disease', 2250),
 ('hiv_ag_ab',  'lab', 'infection', 'HIV Ag/Ab',                 'HIV Ag/Ab',                'text',    null,      '{}', 0, null, null, 'infectious_disease', 2260),
 ('culture_result','lab','microbiology','نتيجة المزرعة البكتيرية','Culture result',          'text',    null,      '{}', 0, null, null, 'infectious_disease', 2270),
 ('genetic_result','lab','genetics','نتيجة فحص وراثي',          'Genetic test result',      'text',    null,      '{}', 0, null, null, 'medical_genetics', 2280),
 ('beta_hcg',   'lab', 'pregnancy', 'هرمون الحمل β-hCG (كمي)',   'β-hCG (quantitative)',     'numeric', 'mIU/mL',  '{}', 1, 0, 1000000, 'obgyn', 2290),
 ('pregnancy_test','lab','pregnancy','فحص الحمل (نوعي)',         'Pregnancy test (qualitative)','text', null,      '{}', 0, null, null, 'obgyn', 2295),
 ('other_lab_numeric','lab','other','تحليل آخر (رقمي)',          'Other lab test (numeric)', 'numeric', null,      '{}', 2, null, null, null, 2900),
 ('other_lab_text','lab','other','تحليل آخر (نصي)',              'Other lab test (text)',    'text',    null,      '{}', 0, null, null, null, 2910);

insert into public.observation_types (code, category, lab_group, name_ar, name_en, value_kind, default_unit, unit_conversions,
                                      decimals, plausible_min, plausible_max, default_specialty_id, sort)
select o.code, o.category, o.lab_group, o.name_ar, o.name_en, o.kind, o.unit, o.conv, o.dec, o.pmin, o.pmax,
       (select s.id from public.medical_specialties s where s.code = o.spec), o.sort
  from _ot o
on conflict (code) do nothing;

-- ---------------------------------------------------------------- screening bands (adult, default unit)
-- Common adult screening thresholds, seeded as DATA so a clinician can review and change them.
-- They flag "worth a professional look"; they never diagnose. reviewed_by_clinician stays false until someone signs off.
create temp table _bd (code text, comp smallint, ctx text, excl text[], band text, lo numeric, hi numeric, rule_set text, why text);
insert into _bd values
 ('blood_pressure', 1, null, '{}', 'critical_low',  null, 70,   'bp_adult_v1', 'Systolic <70 mmHg'),
 ('blood_pressure', 1, null, '{}', 'low',           70,   90,   'bp_adult_v1', 'Systolic 70-89 mmHg'),
 ('blood_pressure', 1, null, '{}', 'normal',        90,   120,  'bp_adult_v1', 'Systolic 90-119 mmHg'),
 ('blood_pressure', 1, null, '{}', 'borderline',    120,  130,  'bp_adult_v1', 'Elevated: systolic 120-129 mmHg (AHA/ACC 2017 style)'),
 ('blood_pressure', 1, null, '{}', 'high',          130,  180,  'bp_adult_v1', 'Hypertension range: systolic 130-179 mmHg'),
 ('blood_pressure', 1, null, '{}', 'critical_high', 180,  null, 'bp_adult_v1', 'Systolic >=180 mmHg: needs prompt assessment'),
 ('blood_pressure', 2, null, '{}', 'critical_low',  null, 40,   'bp_adult_v1', 'Diastolic <40 mmHg'),
 ('blood_pressure', 2, null, '{}', 'low',           40,   60,   'bp_adult_v1', 'Diastolic 40-59 mmHg'),
 ('blood_pressure', 2, null, '{}', 'normal',        60,   80,   'bp_adult_v1', 'Diastolic 60-79 mmHg'),
 ('blood_pressure', 2, null, '{}', 'high',          80,   120,  'bp_adult_v1', 'Hypertension range: diastolic 80-119 mmHg'),
 ('blood_pressure', 2, null, '{}', 'critical_high', 120,  null, 'bp_adult_v1', 'Diastolic >=120 mmHg: needs prompt assessment'),
 ('heart_rate', 1, null, '{exertion,after_exercise}', 'critical_low',  null, 40,  'hr_adult_v1', 'Resting HR <40 bpm'),
 ('heart_rate', 1, null, '{exertion,after_exercise}', 'low',           40,   60,  'hr_adult_v1', 'Resting HR 40-59 bpm (can be normal in athletes)'),
 ('heart_rate', 1, null, '{exertion,after_exercise}', 'normal',        60,   100, 'hr_adult_v1', 'Resting HR 60-99 bpm'),
 ('heart_rate', 1, null, '{exertion,after_exercise}', 'high',          100,  150, 'hr_adult_v1', 'Resting HR 100-149 bpm'),
 ('heart_rate', 1, null, '{exertion,after_exercise}', 'critical_high', 150,  null,'hr_adult_v1', 'Resting HR >=150 bpm'),
 ('blood_glucose', 1, null,          '{}', 'critical_low', null, 54,  'glucose_adult_v1', 'Glucose <54 mg/dL (any context)'),
 ('blood_glucose', 1, null,          '{}', 'low',          54,   70,  'glucose_adult_v1', 'Glucose 54-69 mg/dL (any context)'),
 ('blood_glucose', 1, 'fasting',     '{}', 'normal',       70,   100, 'glucose_adult_v1', 'Fasting 70-99 mg/dL'),
 ('blood_glucose', 1, 'fasting',     '{}', 'borderline',   100,  126, 'glucose_adult_v1', 'Fasting 100-125 mg/dL'),
 ('blood_glucose', 1, 'fasting',     '{}', 'high',         126,  null,'glucose_adult_v1', 'Fasting >=126 mg/dL'),
 ('blood_glucose', 1, 'post_meal_2h','{}', 'normal',       70,   140, 'glucose_adult_v1', '2 h after a meal <140 mg/dL'),
 ('blood_glucose', 1, 'post_meal_2h','{}', 'borderline',   140,  200, 'glucose_adult_v1', '2 h after a meal 140-199 mg/dL'),
 ('blood_glucose', 1, 'post_meal_2h','{}', 'high',         200,  null,'glucose_adult_v1', '2 h after a meal >=200 mg/dL'),
 ('blood_glucose', 1, 'random',      '{}', 'normal',       70,   200, 'glucose_adult_v1', 'Random 70-199 mg/dL'),
 ('blood_glucose', 1, 'random',      '{}', 'high',         200,  null,'glucose_adult_v1', 'Random >=200 mg/dL'),
 ('spo2', 1, null, '{exertion,after_exercise}', 'critical_low', null, 90, 'spo2_adult_v1', 'SpO2 <90%'),
 ('spo2', 1, null, '{exertion,after_exercise}', 'low',          90,   95, 'spo2_adult_v1', 'SpO2 90-94%'),
 ('spo2', 1, null, '{exertion,after_exercise}', 'normal',       95,   null,'spo2_adult_v1', 'SpO2 >=95%'),
 ('body_temperature', 1, null, '{}', 'critical_low',  null, 35,   'temp_adult_v1', 'Temperature <35 C'),
 ('body_temperature', 1, null, '{}', 'low',           35,   36.1, 'temp_adult_v1', 'Temperature 35.0-36.0 C'),
 ('body_temperature', 1, null, '{}', 'normal',        36.1, 37.6, 'temp_adult_v1', 'Temperature 36.1-37.5 C'),
 ('body_temperature', 1, null, '{}', 'borderline',    37.6, 38,   'temp_adult_v1', 'Temperature 37.6-37.9 C'),
 ('body_temperature', 1, null, '{}', 'high',          38,   39.5, 'temp_adult_v1', 'Temperature 38.0-39.4 C'),
 ('body_temperature', 1, null, '{}', 'critical_high', 39.5, null, 'temp_adult_v1', 'Temperature >=39.5 C'),
 ('respiratory_rate', 1, null, '{exertion,after_exercise}', 'critical_low',  null, 8,  'rr_adult_v1', 'RR <8/min'),
 ('respiratory_rate', 1, null, '{exertion,after_exercise}', 'low',           8,    12, 'rr_adult_v1', 'RR 8-11/min'),
 ('respiratory_rate', 1, null, '{exertion,after_exercise}', 'normal',        12,   20, 'rr_adult_v1', 'RR 12-19/min'),
 ('respiratory_rate', 1, null, '{exertion,after_exercise}', 'high',          20,   25, 'rr_adult_v1', 'RR 20-24/min'),
 ('respiratory_rate', 1, null, '{exertion,after_exercise}', 'critical_high', 25,   null,'rr_adult_v1', 'RR >=25/min');

insert into public.observation_bands (type_id, component, context, exclude_contexts, age_min_years, band, lo, hi, rule_set, rationale, reviewed_by_clinician)
select t.id, b.comp, b.ctx, b.excl, 18, b.band, b.lo, b.hi, b.rule_set,
       b.why || ' - adult screening aid, not a diagnosis; pending clinical review.', false
  from _bd b join public.observation_types t on t.code = b.code
 where not exists (select 1 from public.observation_bands x where x.type_id = t.id and x.rule_set = b.rule_set);

-- ---------------------------------------------------------------- specialty-specific form definitions
insert into public.specialty_record_types (specialty_id, code, name_ar, name_en, fields, sort)
select s.id, v.code, v.name_ar, v.name_en, v.fields::jsonb, v.sort
  from (values
  ('dentistry', 'dental_finding', 'تسجيل سني (سن / حالة / علاج)', 'Dental finding / treatment', 10, $j$[
     {"key":"tooth","type":"text","required":true,"label_ar":"رقم السن (FDI)","label_en":"Tooth number (FDI)"},
     {"key":"surface","type":"text","label_ar":"السطح","label_en":"Surface"},
     {"key":"finding","type":"select","required":true,"label_ar":"الحالة","label_en":"Finding","options":[
        {"value":"caries","label_ar":"تسوس","label_en":"Caries"},{"value":"filling","label_ar":"حشوة","label_en":"Filling"},
        {"value":"crown","label_ar":"تاج","label_en":"Crown"},{"value":"root_canal","label_ar":"علاج عصب","label_en":"Root canal"},
        {"value":"missing","label_ar":"مفقود","label_en":"Missing"},{"value":"implant","label_ar":"زرعة","label_en":"Implant"},
        {"value":"impacted","label_ar":"مطمور","label_en":"Impacted"},{"value":"periodontal","label_ar":"لثة / أنسجة داعمة","label_en":"Periodontal"},
        {"value":"extraction","label_ar":"خلع","label_en":"Extraction"},{"value":"other","label_ar":"أخرى","label_en":"Other"}]},
     {"key":"treatment","type":"textarea","label_ar":"العلاج المنفذ / المخطط","label_en":"Treatment done / planned"}]$j$),
  ('ophthalmology', 'eye_exam', 'فحص العيون', 'Eye examination', 10, $j$[
     {"key":"va_right","type":"text","label_ar":"حدة الإبصار - يمين","label_en":"Visual acuity - right"},
     {"key":"va_left","type":"text","label_ar":"حدة الإبصار - يسار","label_en":"Visual acuity - left"},
     {"key":"iop_right","type":"number","unit":"mmHg","label_ar":"ضغط العين - يمين","label_en":"IOP - right"},
     {"key":"iop_left","type":"number","unit":"mmHg","label_ar":"ضغط العين - يسار","label_en":"IOP - left"},
     {"key":"refraction","type":"textarea","label_ar":"الانكسار / النظارة","label_en":"Refraction / prescription"},
     {"key":"fundus","type":"textarea","label_ar":"قاع العين","label_en":"Fundus findings"}]$j$),
  ('ent', 'audiometry', 'فحص السمع', 'Audiometry', 10, $j$[
     {"key":"ear","type":"select","required":true,"label_ar":"الأذن","label_en":"Ear","options":[
        {"value":"right","label_ar":"يمين","label_en":"Right"},{"value":"left","label_ar":"يسار","label_en":"Left"},{"value":"both","label_ar":"الاثنتان","label_en":"Both"}]},
     {"key":"pta_db","type":"number","unit":"dB","label_ar":"متوسط العتبة السمعية","label_en":"Pure-tone average"},
     {"key":"loss_type","type":"select","label_ar":"نوع فقدان السمع","label_en":"Type of hearing loss","options":[
        {"value":"none","label_ar":"لا يوجد","label_en":"None"},{"value":"conductive","label_ar":"توصيلي","label_en":"Conductive"},
        {"value":"sensorineural","label_ar":"حسي عصبي","label_en":"Sensorineural"},{"value":"mixed","label_ar":"مختلط","label_en":"Mixed"}]},
     {"key":"tympanometry","type":"text","label_ar":"قياس الطبلة","label_en":"Tympanometry"}]$j$),
  ('cardiology', 'ecg', 'تخطيط القلب ECG', 'ECG', 10, $j$[
     {"key":"rhythm","type":"text","required":true,"label_ar":"النظم","label_en":"Rhythm"},
     {"key":"rate","type":"number","unit":"bpm","label_ar":"المعدل","label_en":"Rate"},
     {"key":"interpretation","type":"textarea","label_ar":"التفسير","label_en":"Interpretation"}]$j$),
  ('cardiology', 'echo', 'إيكو القلب', 'Echocardiogram', 20, $j$[
     {"key":"lvef","type":"number","unit":"%","label_ar":"الكسر القذفي LVEF","label_en":"LVEF"},
     {"key":"valves","type":"textarea","label_ar":"الصمامات","label_en":"Valves"},
     {"key":"findings","type":"textarea","required":true,"label_ar":"الموجودات","label_en":"Findings"}]$j$),
  ('pulmonology', 'spirometry', 'قياس التنفس (سبايرومتري)', 'Spirometry', 10, $j$[
     {"key":"fev1","type":"number","unit":"L","label_ar":"FEV1","label_en":"FEV1"},
     {"key":"fvc","type":"number","unit":"L","label_ar":"FVC","label_en":"FVC"},
     {"key":"ratio","type":"number","unit":"%","label_ar":"FEV1/FVC","label_en":"FEV1/FVC"},
     {"key":"interpretation","type":"textarea","label_ar":"التفسير","label_en":"Interpretation"}]$j$),
  ('obgyn', 'pregnancy', 'متابعة حمل', 'Pregnancy record', 10, $j$[
     {"key":"lmp","type":"date","label_ar":"أول يوم لآخر دورة","label_en":"Last menstrual period"},
     {"key":"edd","type":"date","label_ar":"موعد الولادة المتوقع","label_en":"Estimated due date"},
     {"key":"gravida","type":"number","label_ar":"عدد الحمول","label_en":"Gravida"},
     {"key":"para","type":"number","label_ar":"عدد الولادات","label_en":"Para"},
     {"key":"risk","type":"textarea","label_ar":"عوامل الخطورة","label_en":"Risk factors"}]$j$),
  ('pediatrics', 'growth', 'قياسات النمو', 'Growth measurements', 10, $j$[
     {"key":"head_circumference","type":"number","unit":"cm","label_ar":"محيط الرأس","label_en":"Head circumference"},
     {"key":"percentile","type":"text","label_ar":"المئين","label_en":"Percentile"},
     {"key":"development","type":"textarea","label_ar":"التطور الحركي واللغوي","label_en":"Developmental milestones"}]$j$),
  ('dermatology', 'skin_lesion', 'آفة جلدية', 'Skin lesion', 10, $j$[
     {"key":"site","type":"text","required":true,"label_ar":"الموضع","label_en":"Site"},
     {"key":"size_mm","type":"number","unit":"mm","label_ar":"الحجم","label_en":"Size"},
     {"key":"description","type":"textarea","required":true,"label_ar":"الوصف","label_en":"Description"},
     {"key":"biopsy","type":"select","label_ar":"خزعة","label_en":"Biopsy","options":[
        {"value":"none","label_ar":"لم تؤخذ","label_en":"Not taken"},{"value":"taken","label_ar":"أُخذت","label_en":"Taken"}]}]$j$),
  ('psychiatry', 'symptom_scale', 'مقياس أعراض نفسية', 'Symptom rating scale', 10, $j$[
     {"key":"scale","type":"select","required":true,"label_ar":"المقياس","label_en":"Scale","options":[
        {"value":"phq9","label_ar":"PHQ-9 (الاكتئاب)","label_en":"PHQ-9 (depression)"},{"value":"gad7","label_ar":"GAD-7 (القلق)","label_en":"GAD-7 (anxiety)"},
        {"value":"other","label_ar":"آخر","label_en":"Other"}]},
     {"key":"score","type":"number","required":true,"label_ar":"الدرجة","label_en":"Score"},
     {"key":"interpretation","type":"textarea","label_ar":"التفسير السريري","label_en":"Clinical interpretation"}]$j$)
  ) as v(spec, code, name_ar, name_en, sort, fields)
  join public.medical_specialties s on s.code = v.spec
on conflict (code) do nothing;

drop table _ot;
drop table _bd;
