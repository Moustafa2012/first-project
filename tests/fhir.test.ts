import { describe, expect, it } from "vitest";
import { buildFhirBundle, documentFileName, exportReadme, FHIR_NOT_MAPPED, type FhirResource } from "@/lib/fhir";

const P = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const record = {
  patients: [{ id: P, mrn: "SH-00000042", full_name: "سارة أحمد", full_name_en: "Sara Ahmed", date_of_birth: "1985-04-02", sex: "female", phone: "+966500000000", email: null, city: "Riyadh", country: "SA", blood_abo: "O", blood_rh: "+", allergy_assertion: "has_allergies", deactivated_at: null }],
  conditions: [
    { id: id(1), name: "Type 2 diabetes", icd10_code: "E11", category: "chronic", clinical_status: "active", certainty: "confirmed", severity: "moderate", onset_date: "2015-01-01", notes: "metformin", record_status: "active", recorded_at: "2026-10-01T08:00:00Z" },
    { id: id(2), name: "Wrong entry", category: "diagnosis", clinical_status: "resolved", certainty: "suspected", record_status: "entered_in_error", invalidated_reason: "wrong patient" },
  ],
  allergies: [
    { id: id(3), substance: "Penicillin", category: "medication", reaction: "hives", severity: "life_threatening", status: "active", certainty: "confirmed", record_status: "active" },
    { id: id(4), substance: "Latex", category: "latex", severity: "unknown", status: "active", certainty: "unverified", record_status: "active" },
  ],
  medications: [{ id: id(5), name_generic: "Metformin", name_brand: "Glucophage", strength: "500 mg", form: "tablet", dose: "1", frequency: "twice daily", route: "oral", status: "on_hold", start_date: "2020-01-01", long_term: true, as_needed: false, record_status: "active" }],
  observations: [
    { id: id(6), type_id: id(100), value_num: 128, value_num2: 82, unit: "mmHg", effective_at: "2026-10-20T07:30:00Z", status: "final", interpretation: "borderline", record_status: undefined },
    { id: id(7), type_id: id(101), value_num: 7.1, unit: "%", effective_at: "2026-10-21T07:30:00Z", status: "final", interpretation: "high", ref_low: 4, ref_high: 5.6 },
    { id: id(8), type_id: id(101), value_num: 9, unit: "%", effective_at: "2026-10-22T07:30:00Z", status: "entered_in_error", interpretation: "high" },
    { id: id(9), type_id: id(102), value_text: "Positive", effective_at: "2026-10-22T07:30:00Z", status: "final", interpretation: "abnormal" },
  ],
  procedures: [{ id: id(10), name: "Appendectomy", kind: "surgery", performed_on: "2010-05-05", body_site: "abdomen", operator_name: "Dr A", record_status: "active" }],
  encounters: [{ id: id(11), kind: "emergency", status: "completed", started_at: "2026-09-01T10:00:00Z", ended_at: "2026-09-01T12:00:00Z", reason: "Chest pain", assessment: "Non-cardiac", plan: "Follow up", practitioner_name: "Dr B", record_status: "active" }],
  immunizations: [
    { id: id(12), vaccine_name: "Influenza", status: "completed", administered_on: "2025-10-01", dose_number: 1, record_status: "active" },
    { id: id(13), vaccine_name: "Tetanus", status: "scheduled", record_status: "active" },
    { id: id(14), vaccine_name: "MMR", status: "declined", record_status: "active" },
  ],
  medical_documents: [{ id: id(15), title: "Cardiology letter", doc_type: "doctor_report", original_filename: "letter 2026.pdf", mime_type: "application/pdf", size_bytes: 1234, uploaded_at: "2026-10-05T09:00:00Z", document_date: "2026-10-01", sensitivity: "sensitive", record_status: "active" }],
  catalogs: { observation_types: [
    { id: id(100), code: "blood_pressure", category: "vital", value_kind: "bp", name_en: "Blood pressure", name_ar: "ضغط الدم", default_unit: "mmHg" },
    { id: id(101), code: "hba1c", category: "lab", value_kind: "numeric", name_en: "HbA1c", name_ar: "السكر التراكمي", default_unit: "%" },
    { id: id(102), code: "hbsag", category: "lab", value_kind: "text", name_en: "HBsAg", name_ar: "HBsAg", default_unit: null },
  ] },
};
const bundle = buildFhirBundle(record, new Date("2026-11-01T00:00:00Z"));
const of = (type: string) => bundle.entry.map((e) => e.resource).filter((r) => r.resourceType === type);
const byId = (n: number) => bundle.entry.map((e) => e.resource).find((r) => r.id === id(n)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("FHIR Bundle", () => {
  it("is a collection Bundle with one entry per mapped record (scheduled immunizations are not events)", () => {
    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.type).toBe("collection");
    expect(bundle.timestamp).toBe("2026-11-01T00:00:00.000Z");
    const counts = Object.fromEntries(["Patient", "Condition", "AllergyIntolerance", "MedicationStatement", "Observation", "Procedure", "Encounter", "Immunization", "DocumentReference"].map((t) => [t, of(t).length]));
    expect(counts).toEqual({ Patient: 1, Condition: 2, AllergyIntolerance: 2, MedicationStatement: 1, Observation: 4, Procedure: 1, Encounter: 1, Immunization: 2, DocumentReference: 1 });
    expect(bundle.entry.every((e) => e.fullUrl === `urn:uuid:${e.resource.id}`)).toBe(true);
  });
  it("every clinical resource points at the patient in the bundle", () => {
    const refs = bundle.entry.map((e) => e.resource as FhirResource & { subject?: { reference: string }; patient?: { reference: string } }).filter((r) => r.resourceType !== "Patient");
    for (const r of refs) expect((r.subject ?? r.patient)?.reference).toBe(`urn:uuid:${P}`);
  });
  it("survives JSON round-trip (no undefined, no NaN)", () => {
    expect(JSON.parse(JSON.stringify(bundle))).toEqual(bundle);
    expect(JSON.stringify(bundle)).not.toMatch(/undefined|NaN/);
  });
});

describe("mappings", () => {
  it("Patient: identifier, names, gender, birth date, telecom, blood group", () => {
    const p = of("Patient")[0] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(p.identifier[0]).toEqual({ system: "urn:shifa:mrn", value: "SH-00000042" });
    expect(p.name.map((x: { text: string }) => x.text)).toEqual(["سارة أحمد", "Sara Ahmed"]);
    expect(p.gender).toBe("female");
    expect(p.birthDate).toBe("1985-04-02");
    expect(p.telecom).toEqual([{ system: "phone", value: "+966500000000" }]);
    expect(p.extension.find((e: { url: string }) => e.url === "urn:shifa:blood-group").valueString).toBe("O+");
  });
  it("Condition: status, verification, ICD-10 as a code, error status", () => {
    const c = byId(1);
    expect(c.clinicalStatus.coding[0].code).toBe("active");
    expect(c.verificationStatus.coding[0].code).toBe("confirmed");
    expect(c.category[0].coding[0].code).toBe("problem-list-item");
    expect(c.code).toEqual({ coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: "E11" }], text: "Type 2 diabetes" });
    expect(c.onsetDateTime).toBe("2015-01-01");
    const bad = byId(2);
    expect(bad.verificationStatus.coding[0].code).toBe("entered-in-error");
    expect(bad.note[0].text).toContain("wrong patient");
  });
  it("AllergyIntolerance: criticality, reaction severity, categories", () => {
    const a = byId(3);
    expect(a.criticality).toBe("high");
    expect(a.reaction[0]).toEqual({ manifestation: [{ text: "hives" }], severity: "severe" });
    expect(a.category).toEqual(["medication"]);
    expect(a.verificationStatus.coding[0].code).toBe("confirmed");
    const l = byId(4);
    expect(l.criticality).toBe("unable-to-assess");
    expect(l.category).toEqual(["environment"]);
    expect(l.verificationStatus.coding[0].code).toBe("unconfirmed");
  });
  it("MedicationStatement: status, dosage text, period", () => {
    const m = byId(5);
    expect(m.status).toBe("on-hold");
    expect(m.medicationCodeableConcept.text).toBe("Metformin");
    expect(m.dosage[0].text).toBe("500 mg tablet 1 twice daily");
    expect(m.dosage[0].route).toEqual({ text: "oral" });
    expect(m.effectivePeriod).toEqual({ start: "2020-01-01" });
    expect(m.note[0].text).toContain("Long-term");
  });
  it("Observation: blood pressure components, lab quantity with range, interpretation, text result, error status", () => {
    const bp = byId(6);
    expect(bp.category[0].coding[0].code).toBe("vital-signs");
    expect(bp.component.map((c: { valueQuantity: { value: number } }) => c.valueQuantity.value)).toEqual([128, 82]);
    expect(bp.component[0].code.coding[0]).toMatchObject({ system: "http://loinc.org", code: "8480-6" });
    const a1c = byId(7);
    expect(a1c.category[0].coding[0].code).toBe("laboratory");
    expect(a1c.valueQuantity).toEqual({ value: 7.1, unit: "%" });
    expect(a1c.interpretation[0].coding[0].code).toBe("H");
    expect(a1c.referenceRange[0]).toEqual({ low: { value: 4, unit: "%" }, high: { value: 5.6, unit: "%" } });
    expect(a1c.code.coding[0]).toEqual({ system: "urn:shifa:observation-type", code: "hba1c", display: "HbA1c" });
    expect(byId(8).status).toBe("entered-in-error");
    expect(byId(9).valueString).toBe("Positive");
    expect(byId(9).valueQuantity).toBeUndefined();
  });
  it("Procedure and Encounter", () => {
    const p = byId(10);
    expect(p).toMatchObject({ status: "completed", performedDateTime: "2010-05-05", code: { text: "Appendectomy" } });
    const e = byId(11);
    expect(e.status).toBe("finished");
    expect(e.class.code).toBe("EMER");
    expect(e.period).toEqual({ start: "2026-09-01T10:00:00.000Z", end: "2026-09-01T12:00:00.000Z" });
    expect(e.reasonCode).toEqual([{ text: "Chest pain" }]);
    expect(e.participant[0].individual.display).toBe("Dr B");
  });
  it("Immunization: completed with dose, declined as not-done, scheduled left out", () => {
    expect(byId(12)).toMatchObject({ status: "completed", occurrenceDateTime: "2025-10-01", protocolApplied: [{ doseNumberPositiveInt: 1 }] });
    expect(byId(14).status).toBe("not-done");
    expect(byId(13)).toBeUndefined();
  });
  it("DocumentReference: attachment points into documents/ with the same file name the archive uses", () => {
    const d = byId(15);
    const file = documentFileName({ id: id(15), original_filename: "letter 2026.pdf", mime_type: "application/pdf" });
    expect(file).toBe("00000000-letter_2026.pdf");
    expect(d.content[0].attachment).toMatchObject({ contentType: "application/pdf", url: `documents/${file}`, size: 1234, title: "letter 2026.pdf" });
    expect(d.securityLabel[0].coding[0].code).toBe("sensitive");
  });
  it("uses no licensed code system", () => {
    expect(JSON.stringify(bundle)).not.toMatch(/snomed|cpt|cdt/i);
  });
  it("refuses an export without a patient", () => {
    expect(() => buildFhirBundle({ patients: [] })).toThrow(/no patient/);
  });
});

describe("README", () => {
  it("lists what is in the archive and what is not mapped", () => {
    const txt = exportReadme({ mrn: "SH-1", exportedAt: "2026-11-01T00:00:00Z", documents: 2, skippedDocuments: 1, counts: { conditions: 3, allergies: 0 } });
    expect(txt).toContain("record.json");
    expect(txt).toContain("fhir.json");
    expect(txt).toContain("documents/    2 document file(s)");
    expect(txt).toContain("1 file(s) could not be read");
    expect(txt).toContain("conditions: 3");
    expect(txt).not.toContain("allergies: 0");
    for (const m of FHIR_NOT_MAPPED) expect(txt).toContain(m.table);
  });
});
