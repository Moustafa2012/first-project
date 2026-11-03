-- 0019: which medical specialties a file actually uses.
--
-- The side menu and the specialties page show the specialties in use first (by number of records), with "open another
-- specialty" for the rest. One round trip instead of a query per table. SECURITY INVOKER: it counts only what the
-- caller can read (RLS), so it reveals nothing new.

create or replace function public.patient_specialty_usage(p_patient uuid)
returns table (specialty_id uuid, code text, name_ar text, name_en text, icon text, n bigint)
language sql stable security invoker set search_path = '' as $$
  with used as (
    select x.specialty_id from public.encounters x where x.patient_id = p_patient and x.record_status = 'active' and x.specialty_id is not null
    union all select x.specialty_id from public.conditions x where x.patient_id = p_patient and x.record_status = 'active' and x.specialty_id is not null
    union all select x.specialty_id from public.procedures x where x.patient_id = p_patient and x.record_status = 'active' and x.specialty_id is not null
    union all select x.specialty_id from public.imaging_studies x where x.patient_id = p_patient and x.record_status = 'active' and x.specialty_id is not null
    union all select x.specialty_id from public.medical_documents x where x.patient_id = p_patient and x.record_status = 'active' and x.specialty_id is not null
    union all select x.specialty_id from public.specialty_records x where x.patient_id = p_patient and x.record_status = 'active' and x.specialty_id is not null
    union all select x.specialty_id from public.clinical_notes x where x.patient_id = p_patient and x.record_status = 'active' and x.specialty_id is not null
    union all select x.specialty_id from public.care_plans x where x.patient_id = p_patient and x.record_status = 'active' and x.specialty_id is not null
    union all select x.specialty_id from public.medications x where x.patient_id = p_patient and x.record_status = 'active' and x.specialty_id is not null
    union all select x.specialty_id from public.observations x where x.patient_id = p_patient and x.status in ('final', 'preliminary') and x.specialty_id is not null
    -- the dental file: exams and findings, and diagnoses / procedures / images that name teeth, all belong to dentistry
    union all select m.id from public.dental_exams x cross join public.medical_specialties m
      where m.code = 'dentistry' and x.patient_id = p_patient and x.record_status = 'active'
    union all select m.id from public.dental_findings x cross join public.medical_specialties m
      where m.code = 'dentistry' and x.patient_id = p_patient and x.record_status = 'active' and x.exam_id is null
    union all select m.id from public.conditions x cross join public.medical_specialties m
      where m.code = 'dentistry' and x.patient_id = p_patient and x.record_status = 'active' and x.teeth is not null and x.specialty_id is null
  )
  select s.id, s.code, s.name_ar, s.name_en, s.icon, count(*)::bigint
  from used u join public.medical_specialties s on s.id = u.specialty_id
  group by s.id, s.code, s.name_ar, s.name_en, s.icon
  order by count(*) desc, s.name_ar
$$;

revoke all on function public.patient_specialty_usage(uuid) from public, anon;
grant execute on function public.patient_specialty_usage(uuid) to authenticated;
