type R = Record<string, unknown>;
export interface Bundle {
  status: "ok";
  meta: { title: string; recipient_label: string | null; scope_kind: string; specialties: { code: string; name_ar: string; name_en: string }[]; include: string[];
          date_from: string | null; date_to: string | null; expires_at: string; allow_download: boolean; allow_print: boolean; allow_notes: boolean; generated_at: string };
  patient: { mrn: string; full_name: string; full_name_en: string | null; date_of_birth: string; age_years: number; sex: string; nationality: string | null; blood_group: string | null; blood_group_verified: boolean; phone?: string | null };
  allergy_assertion: string;
  allergies: R[]; chronic_conditions: R[]; medications: R[];
  emergency_contacts?: R[]; other_conditions?: R[]; encounters?: R[]; procedures?: R[]; imaging?: R[]; family_history?: R[]; immunizations?: R[];
  care_plans?: R[]; notes?: R[]; specialty_records?: R[]; observations?: R[]; documents?: R[]; specialties: { id: string; code: string; name_ar: string; name_en: string }[];
}

/** The dental chart a dentistry share shows (public.share_dental). */
export interface ShareDental {
  status: string;
  profile: Record<string, unknown> | null;
  exams: import("@/lib/dental").ExamRow[];
  findings: import("@/lib/dental").FindingRow[];
  diagnoses: { id: string; name: string; icd10_code: string | null; teeth: number[] | null; evidence: string | null; certainty: string | null; clinical_status: string | null; onset_date: string | null; date_precision: string | null; resolved_date?: string | null; contributed_by?: string | null }[];
  procedures?: import("@/lib/dental").ToothProcedure[];
  imaging?: import("@/lib/dental").ToothImage[];
  /** current treatment plans (never with costs) and the costs this clinician entered themselves */
  plans?: import("@/lib/treatment").TreatmentPlan[];
  my_costs?: import("@/lib/treatment").TreatmentCost[];
  /** pulp tests per exam id */
  pulp?: Record<string, import("@/lib/dental-exam").PulpTest[]>;
}

export interface ShareNoteAmendment { body: string; reason: string; amended_at: string; amended_name: string | null }
/** dental details of visits and signatures of notes in the shared scope (keyed by record id) */
export interface ShareExtras {
  encounters: Record<string, { teeth: number[] | null; anesthesia_kind: string | null; anesthetic: string | null; materials: string | null; complications: string | null; instructions: string | null; follow_up_date: string | null }>;
  notes: Record<string, { status: string; signed_name: string | null; signed_at: string | null; amendments: ShareNoteAmendment[] }>;
}
export interface ShareMyNote { id: string; title: string | null; body: string; noted_at: string; signed_name: string | null; signed_at: string | null; record_status: string; amendments: ShareNoteAmendment[] }
export interface ShareRecall { kind: string; label: string | null; interval_months: number; due_on: string; last_done_on: string | null; status: string }
