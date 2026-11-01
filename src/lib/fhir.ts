/**
 * The patient's record as a FHIR R4 Bundle (type "collection"), built from the rows of `public.patient_export_data`.
 * Pure functions, no I/O. It maps what the application stores to the resources that exist for it; what has no clean
 * counterpart is listed in {@link FHIR_NOT_MAPPED} (and written in the README of the export). Codes of licensed systems
 * (SNOMED CT, CPT, CDT) are never invented: such concepts carry text, and local codes use the `urn:shifa:` systems.
 */
type Row = Record<string, unknown>;
export type FhirResource = { resourceType: string; id: string; [k: string]: unknown };
export interface ExportRecord { [table: string]: unknown }
export interface FhirBundle { resourceType: "Bundle"; id: string; type: "collection"; timestamp: string; entry: { fullUrl: string; resource: FhirResource }[] }

const SYS = {
  mrn: "urn:shifa:mrn", obsType: "urn:shifa:observation-type", docType: "urn:shifa:document-type", kind: "urn:shifa:kind",
  icd10: "http://hl7.org/fhir/sid/icd-10", loinc: "http://loinc.org",
  condClinical: "http://terminology.hl7.org/CodeSystem/condition-clinical", condVerif: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
  condCat: "http://terminology.hl7.org/CodeSystem/condition-category",
  allergyClinical: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", allergyVerif: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
  obsCat: "http://terminology.hl7.org/CodeSystem/observation-category", interp: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
  actCode: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
};

/** Tables of the export that have no FHIR resource in this mapping (kept in record.json). */
export const FHIR_NOT_MAPPED: { table: string; why: string }[] = [
  { table: "lab_reports", why: "report headers (their results are exported as Observation)" },
  { table: "imaging_studies", why: "no DiagnosticReport / ImagingStudy mapping yet (impressions are in record.json)" },
  { table: "clinical_notes", why: "free-text notes and their amendments" },
  { table: "family_history", why: "FamilyMemberHistory not mapped yet" },
  { table: "appointments / test_orders / care_plans / recalls", why: "scheduling and orders" },
  { table: "patient_health_profile / patient_exposures / symptom_entries / patient_devices", why: "social history, symptoms and devices" },
  { table: "dental_* / perio_* / treatment_*", why: "dental charts, periodontal charts, treatment plans and costs" },
  { table: "immunizations with status scheduled", why: "a planned dose is not an Immunization event" },
  { table: "audit_logs, share links, members", why: "not part of the clinical record (the audit log is not exported)" },
];

const s = (v: unknown): string | undefined => (v == null || v === "" ? undefined : String(v));
const n = (v: unknown): number | undefined => { if (v == null || v === "") return undefined; const x = Number(v); return Number.isFinite(x) ? x : undefined; };
const rows = (rec: ExportRecord, table: string): Row[] => (Array.isArray(rec[table]) ? (rec[table] as Row[]) : []);
const compact = <T extends Record<string, unknown>>(o: T): T => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as T;
};
const text = (t: string | undefined) => (t ? { text: t } : undefined);
const note = (t: unknown) => (s(t) ? [{ text: s(t) }] : undefined);
const dateOnly = (v: unknown) => (s(v) ? String(v).slice(0, 10) : undefined);
const instant = (v: unknown) => { const x = s(v); if (!x) return undefined; const d = new Date(x); return Number.isNaN(+d) ? undefined : d.toISOString(); };
const cc = (system: string, code: string, display?: string) => ({ coding: [compact({ system, code, display })] });
const errored = (r: Row) => r.record_status === "entered_in_error";

const GENDER: Record<string, string> = { male: "male", female: "female", intersex: "other", unspecified: "unknown" };

function patientResource(p: Row): FhirResource {
  const id = String(p.id);
  return compact({
    resourceType: "Patient", id,
    identifier: [{ system: SYS.mrn, value: s(p.mrn) }],
    active: !p.deactivated_at,
    name: [compact({ use: "official", text: s(p.full_name) }), ...(s(p.full_name_en) ? [{ use: "usual", text: s(p.full_name_en) }] : [])],
    gender: GENDER[String(p.sex)] ?? "unknown",
    birthDate: dateOnly(p.date_of_birth),
    telecom: [...(s(p.phone) ? [{ system: "phone", value: s(p.phone) }] : []), ...(s(p.email) ? [{ system: "email", value: s(p.email) }] : [])],
    address: s(p.address_line) || s(p.city) || s(p.country) ? [compact({ line: s(p.address_line) ? [s(p.address_line)] : undefined, city: s(p.city), country: s(p.country) })] : undefined,
    extension: [
      ...(s(p.blood_abo) ? [{ url: "urn:shifa:blood-group", valueString: `${p.blood_abo}${s(p.blood_rh) ?? ""}` }] : []),
      ...(s(p.allergy_assertion) ? [{ url: "urn:shifa:allergy-assertion", valueString: String(p.allergy_assertion) }] : []),
    ],
  }) as FhirResource;
}

const COND_CLINICAL: Record<string, string> = { active: "active", recurrence: "recurrence", inactive: "inactive", remission: "remission", resolved: "resolved" };
const COND_VERIF: Record<string, string> = { confirmed: "confirmed", suspected: "unconfirmed", provisional: "provisional", unknown: "unconfirmed", refuted: "refuted" };
const LIST_ITEM = new Set(["chronic", "congenital", "genetic", "disability"]);

function conditionResource(r: Row, subject: string): FhirResource {
  return compact({
    resourceType: "Condition", id: String(r.id),
    clinicalStatus: cc(SYS.condClinical, COND_CLINICAL[String(r.clinical_status)] ?? "active"),
    verificationStatus: errored(r) ? cc(SYS.condVerif, "entered-in-error") : cc(SYS.condVerif, COND_VERIF[String(r.certainty)] ?? "unconfirmed"),
    category: [cc(SYS.condCat, LIST_ITEM.has(String(r.category)) ? "problem-list-item" : "encounter-diagnosis")],
    severity: text(s(r.severity)),
    code: compact({ coding: s(r.icd10_code) ? [{ system: SYS.icd10, code: s(r.icd10_code) }] : undefined, text: s(r.name) }),
    subject: { reference: subject },
    encounter: s(r.encounter_id) ? { reference: `urn:uuid:${r.encounter_id}` } : undefined,
    onsetDateTime: dateOnly(r.onset_date),
    abatementDateTime: dateOnly(r.resolved_date),
    recordedDate: instant(r.recorded_at),
    note: note(errored(r) ? `Entered in error: ${s(r.invalidated_reason) ?? ""}`.trim() : r.notes),
  }) as FhirResource;
}

const ALLERGY_CAT: Record<string, string> = { medication: "medication", food: "food", environment: "environment", biologic: "biologic", latex: "environment" };
function allergyResource(r: Row, subject: string): FhirResource {
  const sev = String(r.severity);
  return compact({
    resourceType: "AllergyIntolerance", id: String(r.id),
    clinicalStatus: cc(SYS.allergyClinical, ({ active: "active", inactive: "inactive", resolved: "resolved" } as Record<string, string>)[String(r.status)] ?? "active"),
    verificationStatus: errored(r) ? cc(SYS.allergyVerif, "entered-in-error") : cc(SYS.allergyVerif, ({ confirmed: "confirmed", refuted: "refuted" } as Record<string, string>)[String(r.certainty)] ?? "unconfirmed"),
    category: ALLERGY_CAT[String(r.category)] ? [ALLERGY_CAT[String(r.category)]] : undefined,
    criticality: sev === "life_threatening" ? "high" : sev === "unknown" ? "unable-to-assess" : "low",
    code: text(s(r.substance)),
    patient: { reference: subject },
    onsetDateTime: dateOnly(r.onset_date),
    recordedDate: instant(r.recorded_at),
    note: note(r.notes),
    reaction: s(r.reaction) || ["mild", "moderate", "severe", "life_threatening"].includes(sev)
      ? [compact({ manifestation: [{ text: s(r.reaction) ?? "unspecified" }], severity: sev === "life_threatening" ? "severe" : ["mild", "moderate", "severe"].includes(sev) ? sev : undefined })]
      : undefined,
  }) as FhirResource;
}

const MED_STATUS: Record<string, string> = { active: "active", on_hold: "on-hold", stopped: "stopped", completed: "completed" };
function medicationResource(r: Row, subject: string): FhirResource {
  const generic = s(r.name_generic), brand = s(r.name_brand);
  const dosageText = [s(r.strength), s(r.form), s(r.dose), s(r.frequency)].filter(Boolean).join(" ");
  return compact({
    resourceType: "MedicationStatement", id: String(r.id),
    status: errored(r) ? "entered-in-error" : MED_STATUS[String(r.status)] ?? "unknown",
    medicationCodeableConcept: compact({ text: generic ?? brand, coding: generic && brand ? [{ system: "urn:shifa:brand-name", display: brand }] : undefined }),
    subject: { reference: subject },
    context: s(r.encounter_id) ? { reference: `urn:uuid:${r.encounter_id}` } : undefined,
    effectivePeriod: s(r.start_date) || s(r.end_date) ? compact({ start: dateOnly(r.start_date), end: dateOnly(r.end_date) }) : undefined,
    dateAsserted: instant(r.recorded_at),
    reasonCode: s(r.indication) ? [{ text: s(r.indication) }] : undefined,
    note: note([s(r.instructions), s(r.notes), r.long_term ? "Long-term medication" : undefined].filter(Boolean).join("\n")),
    dosage: dosageText || s(r.route) || r.as_needed ? [compact({ text: dosageText || undefined, route: text(s(r.route)), asNeededBoolean: r.as_needed ? true : undefined })] : undefined,
  }) as FhirResource;
}

const INTERP: Record<string, [string, string]> = {
  normal: ["N", "Normal"], low: ["L", "Low"], high: ["H", "High"], critical_low: ["LL", "Critical low"], critical_high: ["HH", "Critical high"], abnormal: ["A", "Abnormal"], borderline: ["A", "Abnormal"],
};
const OBS_STATUS: Record<string, string> = { preliminary: "preliminary", final: "final", amended: "amended", entered_in_error: "entered-in-error" };
interface ObsType { id: string; code: string; category: string; value_kind: string; name_en: string; name_ar: string; default_unit: string | null }

function observationResource(r: Row, subject: string, types: Map<string, ObsType>): FhirResource {
  const ty = types.get(String(r.type_id));
  const name = s(r.custom_name) ?? ty?.name_en ?? "Observation";
  const category = ty?.category === "lab" ? "laboratory" : ty?.category === "vital" ? "vital-signs" : "activity";
  const unit = s(r.unit) ?? ty?.default_unit ?? undefined;
  const q = (v: unknown) => (n(v) != null ? compact({ value: n(v), unit }) : undefined);
  const isBp = ty?.value_kind === "bp";
  const code = isBp
    ? { coding: [{ system: SYS.loinc, code: "85354-9", display: "Blood pressure panel" }], text: name }
    : { coding: [{ system: SYS.obsType, code: ty?.code ?? "custom", display: ty?.name_en }], text: name };
  const interp = INTERP[String(r.interpretation)];
  return compact({
    resourceType: "Observation", id: String(r.id),
    status: errored(r) ? "entered-in-error" : OBS_STATUS[String(r.status)] ?? "final",
    category: [cc(SYS.obsCat, category)],
    code,
    subject: { reference: subject },
    encounter: s(r.encounter_id) ? { reference: `urn:uuid:${r.encounter_id}` } : undefined,
    effectiveDateTime: instant(r.effective_at),
    valueQuantity: !isBp ? q(r.value_num) : undefined,
    valueString: !isBp && n(r.value_num) == null ? s(r.value_text) : undefined,
    component: isBp ? [
      { code: { coding: [{ system: SYS.loinc, code: "8480-6", display: "Systolic blood pressure" }] }, valueQuantity: q(r.value_num) },
      ...(n(r.value_num2) != null ? [{ code: { coding: [{ system: SYS.loinc, code: "8462-4", display: "Diastolic blood pressure" }] }, valueQuantity: q(r.value_num2) }] : []),
    ] : undefined,
    interpretation: interp ? [cc(SYS.interp, interp[0], interp[1])] : undefined,
    referenceRange: n(r.ref_low) != null || n(r.ref_high) != null || s(r.ref_text)
      ? [compact({ low: n(r.ref_low) != null ? { value: n(r.ref_low), unit } : undefined, high: n(r.ref_high) != null ? { value: n(r.ref_high), unit } : undefined, text: s(r.ref_text) })] : undefined,
    device: s(r.device) ? { display: s(r.device) } : undefined,
    note: note(r.notes),
  }) as FhirResource;
}

function procedureResource(r: Row, subject: string): FhirResource {
  return compact({
    resourceType: "Procedure", id: String(r.id),
    status: errored(r) ? "entered-in-error" : "completed",
    category: text(s(r.kind)),
    code: text(s(r.name)),
    subject: { reference: subject },
    encounter: s(r.encounter_id) ? { reference: `urn:uuid:${r.encounter_id}` } : undefined,
    performedDateTime: dateOnly(r.performed_on),
    performer: s(r.operator_name) ? [{ actor: { display: s(r.operator_name) } }] : undefined,
    location: s(r.facility_name) ? { display: s(r.facility_name) } : undefined,
    bodySite: s(r.body_site) ? [{ text: s(r.body_site) }] : undefined,
    reasonCode: s(r.indication) ? [{ text: s(r.indication) }] : undefined,
    outcome: text(s(r.outcome)),
    complication: s(r.complications) ? [{ text: s(r.complications) }] : undefined,
    note: note(r.notes),
  }) as FhirResource;
}

const ENC_CLASS: Record<string, [string, string]> = {
  clinic: ["AMB", "ambulatory"], emergency: ["EMER", "emergency"], telehealth: ["VR", "virtual"], inpatient: ["IMP", "inpatient encounter"],
  surgery: ["SS", "short stay"], diagnostic: ["AMB", "ambulatory"], therapy_session: ["AMB", "ambulatory"], follow_up: ["AMB", "ambulatory"],
  home_visit: ["HH", "home health"], dental: ["AMB", "ambulatory"],
};
const ENC_STATUS: Record<string, string> = { planned: "planned", in_progress: "in-progress", completed: "finished", cancelled: "cancelled" };
function encounterResource(r: Row, subject: string): FhirResource {
  const cls = ENC_CLASS[String(r.kind)] ?? ["AMB", "ambulatory"];
  return compact({
    resourceType: "Encounter", id: String(r.id),
    status: errored(r) ? "entered-in-error" : ENC_STATUS[String(r.status)] ?? "unknown",
    class: { system: SYS.actCode, code: cls[0], display: cls[1] },
    type: [cc(SYS.kind, String(r.kind))],
    subject: { reference: subject },
    participant: s(r.practitioner_name) ? [{ individual: { display: s(r.practitioner_name) } }] : undefined,
    period: compact({ start: instant(r.started_at), end: instant(r.ended_at) }),
    reasonCode: s(r.reason) ? [{ text: s(r.reason) }] : undefined,
    serviceProvider: s(r.facility_name) ? { display: s(r.facility_name) } : undefined,
    extension: [
      ...(s(r.assessment) ? [{ url: "urn:shifa:assessment", valueString: s(r.assessment) }] : []),
      ...(s(r.plan) ? [{ url: "urn:shifa:plan", valueString: s(r.plan) }] : []),
    ],
  }) as FhirResource;
}

function immunizationResource(r: Row, subject: string): FhirResource | null {
  const status = String(r.status);
  if (status === "scheduled") return null;
  return compact({
    resourceType: "Immunization", id: String(r.id),
    status: errored(r) ? "entered-in-error" : status === "completed" ? "completed" : "not-done",
    statusReason: status === "declined" ? { text: "Declined" } : status === "contraindicated" ? { text: "Contraindicated" } : undefined,
    vaccineCode: text(s(r.vaccine_name)),
    patient: { reference: subject },
    ...(s(r.administered_on) ? { occurrenceDateTime: dateOnly(r.administered_on) } : { occurrenceString: "unknown" }),
    recorded: instant(r.recorded_at),
    lotNumber: s(r.lot_number),
    location: s(r.facility_name) ? { display: s(r.facility_name) } : undefined,
    performer: s(r.administered_by) ? [{ actor: { display: s(r.administered_by) } }] : undefined,
    note: note(r.notes),
    protocolApplied: n(r.dose_number) != null ? [{ doseNumberPositiveInt: n(r.dose_number) }] : undefined,
  }) as FhirResource;
}

/** Name of the file inside the archive for a stored document (shared by the export route and the DocumentReference url). */
export function documentFileName(d: { id: string; original_filename?: string | null; mime_type?: string | null }): string {
  const ext = d.mime_type === "application/pdf" ? "pdf" : d.mime_type === "image/png" ? "png" : d.mime_type === "image/webp" ? "webp" : d.mime_type === "image/jpeg" ? "jpg" : "bin";
  const base = (d.original_filename ?? "").replace(/\.[A-Za-z0-9]{1,5}$/, "").normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[_.]+|[_.]+$/g, "").slice(0, 60);
  return `${String(d.id).slice(0, 8)}-${base || "document"}.${ext}`;
}

function documentResource(r: Row, subject: string): FhirResource {
  const file = documentFileName({ id: String(r.id), original_filename: s(r.original_filename), mime_type: s(r.mime_type) });
  return compact({
    resourceType: "DocumentReference", id: String(r.id),
    status: errored(r) ? "entered-in-error" : "current",
    type: cc(SYS.docType, String(r.doc_type)),
    subject: { reference: subject },
    date: instant(r.uploaded_at),
    description: s(r.title),
    securityLabel: r.sensitivity && r.sensitivity !== "standard" ? [cc("urn:shifa:sensitivity", String(r.sensitivity))] : undefined,
    content: [{ attachment: compact({ contentType: s(r.mime_type), url: `documents/${file}`, size: n(r.size_bytes), title: s(r.original_filename), creation: dateOnly(r.document_date) }) }],
  }) as FhirResource;
}

/** The FHIR R4 collection Bundle for an exported record. `now` is injectable for tests. */
export function buildFhirBundle(rec: ExportRecord, now = new Date()): FhirBundle {
  const patient = rows(rec, "patients")[0];
  if (!patient) throw new Error("fhir: the export has no patient");
  const subject = `urn:uuid:${patient.id}`;
  const types = new Map<string, ObsType>();
  const catalogs = (rec.catalogs ?? {}) as { observation_types?: ObsType[] };
  for (const t of catalogs.observation_types ?? []) types.set(t.id, t);

  const resources: FhirResource[] = [patientResource(patient)];
  const add = (list: Row[], f: (r: Row) => FhirResource | null) => { for (const r of list) { const x = f(r); if (x) resources.push(x); } };
  add(rows(rec, "conditions"), (r) => conditionResource(r, subject));
  add(rows(rec, "allergies"), (r) => allergyResource(r, subject));
  add(rows(rec, "medications"), (r) => medicationResource(r, subject));
  add(rows(rec, "observations"), (r) => observationResource(r, subject, types));
  add(rows(rec, "procedures"), (r) => procedureResource(r, subject));
  add(rows(rec, "encounters"), (r) => encounterResource(r, subject));
  add(rows(rec, "immunizations"), (r) => immunizationResource(r, subject));
  add(rows(rec, "medical_documents"), (r) => documentResource(r, subject));

  return {
    resourceType: "Bundle", id: `shifa-${String(patient.mrn ?? patient.id)}`.toLowerCase(), type: "collection", timestamp: now.toISOString(),
    entry: resources.map((resource) => ({ fullUrl: `urn:uuid:${resource.id}`, resource })),
  };
}

/** The README written into the archive: what each file holds and what the FHIR file does not carry. */
export function exportReadme(info: { mrn: string; exportedAt: string; documents: number; skippedDocuments: number; counts: Record<string, number> }): string {
  const lines = [
    "Shifa Portal - full export of a health file",
    "===========================================",
    `File number: ${info.mrn}`,
    `Exported at: ${info.exportedAt}`,
    "",
    "record.json   Every record of the file, grouped by table: active records AND records marked as entered in error",
    "              (with their reason). Dates are ISO 8601; ids are UUIDs. The audit log and everything about share links",
    "              are not included. \"catalogs\" holds the measurement types and specialties the records refer to.",
    "fhir.json     A FHIR R4 Bundle (type collection) with: Patient, Condition, AllergyIntolerance, MedicationStatement,",
    "              Observation, Procedure, Encounter, Immunization, DocumentReference. Records entered in error keep",
    "              their data with status entered-in-error. Concepts without a free code system carry text only.",
    `documents/    ${info.documents} document file(s) as uploaded; DocumentReference.content.attachment.url points to them.`,
    ...(info.skippedDocuments ? [`              ${info.skippedDocuments} file(s) could not be read from storage and are missing (listed in record.json).`] : []),
    "",
    "Not mapped to FHIR (present in record.json only):",
    ...FHIR_NOT_MAPPED.map((m) => `  - ${m.table}: ${m.why}`),
    "",
    "Row counts in record.json:",
    ...Object.entries(info.counts).filter(([, c]) => c > 0).map(([t, c]) => `  ${t}: ${c}`),
    "",
    "This export is a copy of data entered into the portal. It is not a certified medical record and has not been validated",
    "against a FHIR server profile.",
    "",
  ];
  return lines.join("\n");
}
