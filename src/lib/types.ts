export type Id = string;

export interface Specialty {
  id: Id; code: string; name_ar: string; name_en: string; icon: string; kind: "clinical" | "support"; sort: number; is_active: boolean;
  description_ar?: string | null; description_en?: string | null; applicable_sex?: "male" | "female" | null;
}

export interface PatientRow {
  id: Id; mrn: string; full_name: string; full_name_en: string | null; date_of_birth: string; sex: string; nationality: string | null;
  blood_abo: string | null; blood_rh: string | null; blood_group_verified: boolean; phone: string | null; email: string | null;
  address_line: string | null; city: string | null; country: string | null; allergy_assertion: string;
  allergy_assertion_at: string | null; created_at: string; updated_at: string;
  photo_path?: string | null; deletion_requested_at?: string | null; deletion_scheduled_for?: string | null;
}

export interface ObservationType {
  id: Id; code: string; category: "vital" | "lab" | "activity" | "other"; lab_group: string | null; name_ar: string; name_en: string;
  value_kind: "numeric" | "bp" | "text"; default_unit: string | null; unit_conversions: Record<string, number>; decimals: number;
  plausible_min: number | null; plausible_max: number | null; default_specialty_id: Id | null; sort: number; is_active: boolean; applicable_sex?: "male" | "female" | null;
}

export interface ObservationRow {
  id: Id; patient_id: Id; type_id: Id; report_id: Id | null; encounter_id: Id | null; specialty_id: Id | null; custom_name: string | null;
  value_num: number | null; value_num2: number | null; value_text: string | null; unit: string | null; effective_at: string;
  setting: string; device: string | null; context: string | null; symptoms: string | null; notes: string | null;
  ref_low: number | null; ref_high: number | null; ref_text: string | null; interpretation: string; interpretation_basis: string | null;
  status: "preliminary" | "final" | "amended" | "entered_in_error"; supersedes_id: Id | null; amendment_reason: string | null;
  source: string; source_detail: string | null; verification: string; recorded_by: Id | null; recorded_at: string;
}

export interface LabReportRow {
  id: Id; patient_id: Id; title: string; lab_name: string | null; specimen_type: string | null; collected_at: string | null;
  performed_at: string | null; approved_at: string | null; approved_by_name: string | null; status: string; lab_notes: string | null;
  specialty_id: Id | null; document_id: Id | null; verification: string; recorded_at: string; record_status: string;
}

export type Row = Record<string, unknown> & { id: Id };
