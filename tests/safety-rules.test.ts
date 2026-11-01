import { describe, expect, it } from "vitest";
import { alertsByItem, evaluateSafety, hasRecordFactor, hasTrigger, matchFromForm, parseRuleRow, reasonText, splitKeywords, triggeredItems, type PlannedItem, type SafetyContext, type SafetyRuleRow } from "@/lib/safety-rules";

const rule = (r: Partial<SafetyRuleRow> & Pick<SafetyRuleRow, "code" | "match">): SafetyRuleRow => ({
  specialty_code: "dentistry", title_ar: "عنوان", title_en: "Title", message_ar: "رسالة", message_en: "Message", severity: "warn", reference: null, sort: 0, is_active: true, ...r,
});
const ctx = (over: Partial<SafetyContext> = {}): SafetyContext => ({ conditions: [], medications: [], allergies: [], devices: [], lifestyle: null, ...over });
const med = (name: string) => ({ name, strength: null, dose: null, frequency: null, long_term: true, status: "active" });
const item = (id: string, catalog_code: string | null, category: string | null, name = id): PlannedItem => ({ id, name, catalog_code, category, teeth: [38] });
const life = (pregnancy_status: string) => ({
  tobacco_status: "never", tobacco_types: [], cigarettes_per_day: null, waterpipe_per_week: null, tobacco_start_year: null, tobacco_quit_year: null, activity_level: null,
  pregnancy_status, none_chronic_conditions: false, none_long_term_medications: false, none_devices: false,
});

const anticoag = rule({ code: "anticoag", severity: "danger", sort: 10,
  match: { medications: ["warfarin", "وارفارين", "apixaban", "aspirin"], procedures: { categories: ["surgical", "implant"], codes: ["root_planing"] } } });
const radio = rule({ code: "radio", severity: "danger", sort: 80, match: { conditions: ["radiotherapy", "علاج إشعاعي"], procedures: { categories: ["surgical"] } } });
const latex = rule({ code: "latex", severity: "warn", sort: 71, match: { allergies: ["latex", "لاتكس"] } });
const hba1c = rule({ code: "hba1c", severity: "danger", sort: 51, match: { labs: [{ code: "hba1c", gte: 8 }], procedures: { categories: ["surgical", "implant"] } } });
const pregnant = rule({ code: "pregnant", severity: "warn", sort: 40, match: { pregnancy: true, procedures: { codes: ["xray_panoramic", "cbct"] }, drugs: ["doxycycline", "ibuprofen"] } });
const penRx = rule({ code: "pen_rx", severity: "danger", sort: 61, match: { allergies: ["penicillin", "بنسلين"], drugs: ["amoxicillin", "augmentin"] } });
const valve = rule({ code: "valve", severity: "warn", sort: 30, match: { devices: ["prosthetic_heart_valve"], conditions: ["aortic stenosis"], procedures: { categories: ["surgical"] } } });

const extraction = item("i1", "extraction_simple", "surgical", "Simple extraction");
const filling = item("i2", "filling_composite", "restorative", "Composite filling");
const scaling = item("i3", "scaling", "preventive", "Scaling");
const custom = item("i4", null, null, "Whatever the dentist typed");

describe("safety rules", () => {
  it("raises the anticoagulant alert for an extraction, and says which medicine and which treatment", () => {
    const [a] = evaluateSafety([anticoag], { context: ctx({ medications: [med("Warfarin 5 mg")] }), items: [filling, extraction] });
    expect(a.code).toBe("anticoag");
    expect(a.reasons).toEqual([{ kind: "medication", matched: "Warfarin 5 mg" }]);
    expect(a.items.map((i) => i.id)).toEqual(["i1"]);
  });
  it("matches Arabic names without diacritics or letter-form differences", () => {
    const a = evaluateSafety([anticoag], { context: ctx({ medications: [med("وَارفارين")] }), items: [extraction] });
    expect(a).toHaveLength(1);
    const r = evaluateSafety([radio], { context: ctx({ conditions: [{ name: "علاج اشعاعي للفك", category: "chronic", clinical_status: "active", certainty: "confirmed" }] }), items: [extraction] });
    expect(r).toHaveLength(1);
  });
  it("is silent when the medicine is not there", () => {
    expect(evaluateSafety([anticoag], { context: ctx({ medications: [med("Metformin")] }), items: [extraction] })).toEqual([]);
    expect(evaluateSafety([anticoag], { context: ctx(), items: [extraction] })).toEqual([]);
  });
  it("is silent when the plan has no treatment of the kind it is about", () => {
    const c = ctx({ medications: [med("Warfarin")] });
    expect(evaluateSafety([anticoag], { context: c, items: [filling, scaling] })).toEqual([]);
    expect(evaluateSafety([anticoag], { context: c, items: [] })).toEqual([]);
    expect(evaluateSafety([anticoag], { context: c })).toEqual([]);
  });
  it("does not guess from a treatment typed by name, with no catalogue code or category", () => {
    expect(evaluateSafety([anticoag], { context: ctx({ medications: [med("Warfarin")] }), items: [custom] })).toEqual([]);
  });
  it("triggers on a catalogue code as well as on a category", () => {
    const a = evaluateSafety([anticoag], { context: ctx({ medications: [med("apixaban")] }), items: [item("p1", "root_planing", "periodontal"), filling] });
    expect(a[0].items.map((i) => i.id)).toEqual(["p1"]);
  });
  it("a rule without a trigger is a reminder about the patient and needs no plan", () => {
    expect(hasTrigger(latex.match)).toBe(false);
    const a = evaluateSafety([latex], { context: ctx({ allergies: [{ substance: "Latex gloves", category: "environmental", reaction: null, severity: null, certainty: "confirmed" }] }) });
    expect(a).toHaveLength(1);
    expect(a[0].items).toEqual([]);
    expect(evaluateSafety([latex], { context: ctx({ allergies: [{ substance: "Peanuts", category: "food", reaction: null, severity: null, certainty: "confirmed" }] }) })).toEqual([]);
  });
  it("reads a laboratory threshold from the latest value, and not a missing or lower one", () => {
    const c = ctx();
    expect(evaluateSafety([hba1c], { context: c, items: [extraction], labs: { hba1c: 9.1 } })[0].reasons[0]).toEqual({ kind: "lab", matched: "hba1c 9.1" });
    expect(evaluateSafety([hba1c], { context: c, items: [extraction], labs: { hba1c: 8 } })).toHaveLength(1);
    expect(evaluateSafety([hba1c], { context: c, items: [extraction], labs: { hba1c: 7.9 } })).toEqual([]);
    expect(evaluateSafety([hba1c], { context: c, items: [extraction], labs: { hba1c: null } })).toEqual([]);
    expect(evaluateSafety([hba1c], { context: c, items: [extraction] })).toEqual([]);
    expect(evaluateSafety([hba1c], { context: c, items: [filling], labs: { hba1c: 11 } })).toEqual([]);
  });
  it("pregnancy raises the imaging alert for an X-ray, and the drug alert for a prescribed drug", () => {
    const c = ctx({ lifestyle: life("pregnant") });
    const xray = item("x1", "xray_panoramic", "diagnostic");
    expect(evaluateSafety([pregnant], { context: c, items: [xray] })[0].items.map((i) => i.id)).toEqual(["x1"]);
    expect(evaluateSafety([pregnant], { context: c, items: [filling], drugs: ["Ibuprofen 400 mg"] })[0].drugs).toEqual(["Ibuprofen 400 mg"]);
    expect(evaluateSafety([pregnant], { context: c, items: [filling], drugs: ["Paracetamol"] })).toEqual([]);
    expect(evaluateSafety([pregnant], { context: ctx({ lifestyle: life("not_pregnant") }), items: [xray] })).toEqual([]);
    expect(evaluateSafety([pregnant], { context: ctx({ lifestyle: null }), items: [xray] })).toEqual([]);
  });
  it("a penicillin allergy alerts on a penicillin-family prescription and not on another antibiotic", () => {
    const c = ctx({ allergies: [{ substance: "Penicillin", category: "drug", reaction: "rash", severity: "moderate", certainty: "confirmed" }] });
    const a = evaluateSafety([penRx], { context: c, drugs: ["Augmentin 1 g"] });
    expect(a).toHaveLength(1);
    expect(a[0].reasons[0].kind).toBe("allergy");
    expect(a[0].drugs).toEqual(["Augmentin 1 g"]);
    expect(evaluateSafety([penRx], { context: c, drugs: ["Clindamycin"] })).toEqual([]);
    expect(evaluateSafety([penRx], { context: ctx(), drugs: ["Augmentin 1 g"] })).toEqual([]);
  });
  it("a device or a diagnosis can raise the same rule; every reason is listed", () => {
    const c = ctx({
      devices: [{ kind: "prosthetic_heart_valve", name: "Mechanical valve", body_site: null, implanted_on: null, date_precision: null, mri_safety: "unknown" }],
      conditions: [{ name: "Congenital aortic stenosis", category: "congenital", clinical_status: "active", certainty: "confirmed" }],
    });
    const [a] = evaluateSafety([valve], { context: c, items: [extraction] });
    expect(a.reasons.map((r) => r.kind)).toEqual(["condition", "device"]);
    expect(evaluateSafety([valve], { context: ctx({ devices: [{ kind: "pacemaker", name: null, body_site: null, implanted_on: null, date_precision: null, mri_safety: "unknown" }] }), items: [extraction] })).toEqual([]);
  });
  it("reads other recorded diagnoses and past procedures given as history", () => {
    expect(evaluateSafety([radio], { context: ctx(), items: [extraction], history: ["Radiotherapy to the jaw 2019"] })).toHaveLength(1);
    expect(evaluateSafety([radio], { context: ctx(), items: [extraction], history: ["Appendectomy"] })).toEqual([]);
  });
  it("applies the rules of the specialty being viewed, or all of them", () => {
    const other = rule({ code: "radiology_one", specialty_code: "radiology", match: { allergies: ["latex"] } });
    const c = ctx({ allergies: [{ substance: "Latex", category: "environmental", reaction: null, severity: null, certainty: "confirmed" }] });
    expect(evaluateSafety([latex, other], { context: c }).map((a) => a.code)).toEqual(["latex"]);
    expect(evaluateSafety([latex, other], { context: c, specialties: "all" }).map((a) => a.code).sort()).toEqual(["latex", "radiology_one"]);
    expect(evaluateSafety([latex, other], { context: c, specialties: ["cardiology"] })).toEqual([]);
  });
  it("ignores inactive rules and lists the most serious first", () => {
    const c = ctx({ medications: [med("Warfarin")], allergies: [{ substance: "Latex", category: "environmental", reaction: null, severity: null, certainty: "confirmed" }] });
    const out = evaluateSafety([latex, anticoag, { ...radio, is_active: false }], { context: c, items: [extraction] });
    expect(out.map((a) => a.code)).toEqual(["anticoag", "latex"]);
    expect(evaluateSafety([{ ...latex, is_active: false }], { context: c })).toEqual([]);
  });
  it("marks whether the rule was reviewed", () => {
    const c = ctx({ allergies: [{ substance: "Latex", category: "environmental", reaction: null, severity: null, certainty: "confirmed" }] });
    expect(evaluateSafety([latex], { context: c })[0].reviewed).toBe(false);
    expect(evaluateSafety([{ ...latex, reviewed_at: "2026-11-01T10:00:00Z" }], { context: c })[0].reviewed).toBe(true);
  });
  it("groups alerts by the treatment they concern", () => {
    const c = ctx({ medications: [med("Warfarin")], conditions: [{ name: "Radiotherapy", category: "chronic", clinical_status: "active", certainty: "confirmed" }] });
    const by = alertsByItem(evaluateSafety([anticoag, radio], { context: c, items: [extraction, filling] }));
    expect(by.get("i1")?.map((a) => a.code)).toEqual(["anticoag", "radio"]);
    expect(by.has("i2")).toBe(false);
  });
  it("finds the treatments of a trigger", () => {
    expect(triggeredItems({ procedures: { codes: ["scaling"] } }, [filling, scaling, extraction]).map((i) => i.id)).toEqual(["i3"]);
    expect(triggeredItems({}, [filling])).toEqual([]);
  });
  it("reads a stored rule defensively", () => {
    const r = parseRuleRow({ code: "x", severity: "weird", match: { medications: ["a1", 5, null], procedures: { codes: "no" }, labs: [{ code: "hba1c", gte: 8 }, 3], pregnancy: "yes" }, reviewed_at: "2026-01-01" });
    expect(r.severity).toBe("warn");
    expect(r.match.medications).toEqual(["a1"]);
    expect(r.match.procedures).toEqual({ categories: undefined, codes: undefined });
    expect(r.match.labs).toEqual([{ code: "hba1c", gte: 8 }]);
    expect(r.match.pregnancy).toBeUndefined();
    expect(parseRuleRow({ code: "y", match: null }).match.medications).toBeUndefined();
  });
  it("splits keywords typed in the admin form", () => {
    expect(splitKeywords("warfarin, وارفارين\naspirin ; x\nwarfarin")).toEqual(["warfarin", "وارفارين", "aspirin"]);
    expect(splitKeywords("  ,, ")).toEqual([]);
  });
  it("builds a rule's match from the administrator's form, and insists on something in the file to match", () => {
    const fd = new FormData();
    fd.set("medications", "warfarin\nأسبرين, aspirin"); fd.set("hba1c_gte", "8"); fd.set("pregnancy", "on");
    fd.append("devices", "prosthetic_heart_valve"); fd.append("devices", "BAD KIND!");
    fd.append("proc_categories", "surgical"); fd.set("proc_codes", "root_planing, gum_graft; Bad Code"); fd.set("drugs", "ibuprofen");
    const m = matchFromForm(fd);
    expect(m).toEqual({
      medications: ["warfarin", "أسبرين", "aspirin"], drugs: ["ibuprofen"], devices: ["prosthetic_heart_valve"], pregnancy: true,
      labs: [{ code: "hba1c", gte: 8 }], procedures: { categories: ["surgical"], codes: ["root_planing", "gum_graft"] },
    });
    expect(hasRecordFactor(m)).toBe(true);
    const onlyTrigger = matchFromForm(Object.assign(new FormData(), {}));
    expect(onlyTrigger).toEqual({});
    const fd2 = new FormData(); fd2.append("proc_categories", "surgical"); fd2.set("drugs", "ibuprofen");
    expect(hasRecordFactor(matchFromForm(fd2))).toBe(false);
    const fd3 = new FormData(); fd3.set("hba1c_gte", "abc");
    expect(matchFromForm(fd3)).toEqual({});
  });
  it("says why in words", () => {
    expect(reasonText({ kind: "pregnancy", matched: "pregnancy" }, "ar")).toBe("الحمل");
    expect(reasonText({ kind: "lab", matched: "hba1c 9.1" }, "en")).toBe("HbA1c 9.1");
    expect(reasonText({ kind: "medication", matched: "Warfarin" }, "en")).toBe("Warfarin");
  });
});
