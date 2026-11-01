import { describe, expect, it } from "vitest";
import { activeDrugNames, groupPrescriptions, lineSig, lineTitle, parseRxHeader, parseRxLines, rxError } from "@/lib/prescription";
import { consentError, consentTemplate, consentsForPlan, parseConsentForm } from "@/lib/consent";

const t = (ar: string, en: string) => en;
const form = (o: Record<string, string>) => { const fd = new FormData(); for (const [k, v] of Object.entries(o)) fd.set(k, v); return fd; };

describe("prescription form", () => {
  it("reads the filled lines and skips the blank ones", () => {
    const r = parseRxLines(form({
      l0_name_generic: "Amoxicillin", l0_strength: "500 mg", l0_form: "capsule", l0_route: "oral", l0_frequency: "three times a day", l0_quantity: "21 capsules", l0_duration_days: "7", l0_refills: "0",
      l1_name_generic: "", l1_dose: "",
      l2_name_brand: "Brufen", l2_name_generic: "Ibuprofen", l2_as_needed: "on", l2_duration_days: "3",
    }), t);
    expect("lines" in r && r.lines).toEqual([
      { name_generic: "Amoxicillin", strength: "500 mg", frequency: "three times a day", quantity: "21 capsules", form: "capsule", route: "oral", duration_days: 7, refills: 0 },
      { name_generic: "Ibuprofen", name_brand: "Brufen", duration_days: 3, as_needed: true },
    ]);
  });
  it("needs at least one medicine", () => {
    expect(parseRxLines(form({}), t)).toEqual({ error: "Add at least one medicine." });
    expect(parseRxLines(form({ l0_dose: "  " }), t)).toEqual({ error: "Add at least one medicine." });
  });
  it("a line with details but no medicine name is refused, naming the line", () => {
    expect(parseRxLines(form({ l0_name_generic: "Aspirin", l1_strength: "5 mg" }), t)).toEqual({ error: "Line 2: enter the medicine name." });
  });
  it("checks the duration, the refills, the form and the route", () => {
    expect(parseRxLines(form({ l0_name_generic: "X1", l0_duration_days: "0" }), t)).toHaveProperty("error");
    expect(parseRxLines(form({ l0_name_generic: "X1", l0_duration_days: "3651" }), t)).toHaveProperty("error");
    expect(parseRxLines(form({ l0_name_generic: "X1", l0_duration_days: "2.5" }), t)).toHaveProperty("error");
    expect(parseRxLines(form({ l0_name_generic: "X1", l0_refills: "-1" }), t)).toHaveProperty("error");
    expect(parseRxLines(form({ l0_name_generic: "X1", l0_refills: "25" }), t)).toHaveProperty("error");
    expect(parseRxLines(form({ l0_name_generic: "X1", l0_form: "potion" }), t)).toHaveProperty("error");
    expect(parseRxLines(form({ l0_name_generic: "X1", l0_route: "teleport" }), t)).toHaveProperty("error");
    expect(parseRxLines(form({ l0_name_generic: "x".repeat(201) }), t)).toHaveProperty("error");
    expect(parseRxLines(form({ l0_name_generic: "X1", l0_duration_days: "3650", l0_refills: "24" }), t)).toHaveProperty("lines");
  });
  it("reads up to twenty lines", () => {
    const o: Record<string, string> = {};
    for (let i = 0; i < 25; i++) o[`l${i}_name_generic`] = `Drug ${i}`;
    const r = parseRxLines(form(o), t);
    expect("lines" in r && r.lines.length).toBe(20);
  });
  it("the header needs the prescriber and a date that is not in the future", () => {
    expect(parseRxHeader(form({ prescriber_name: "A" }), t, "2026-11-01")).toEqual({ error: "Enter the prescriber's name." });
    expect(parseRxHeader(form({ prescriber_name: "Dr Reem", issued_on: "2026-11-05" }), t, "2026-11-01")).toEqual({ error: "The prescription date is in the future." });
    expect(parseRxHeader(form({ prescriber_name: "Dr Reem", issued_on: "not a date" }), t, "2026-11-01")).toHaveProperty("error");
    expect(parseRxHeader(form({ prescriber_name: "Dr Reem", prescriber_license: "L-1", facility_name: "Smile" }), t, "2026-11-01"))
      .toEqual({ rx: { prescriber_name: "Dr Reem", prescriber_license: "L-1", facility_name: "Smile", issued_on: "2026-11-01", notes: null } });
  });
  it("turns database errors into words", () => {
    expect(rxError("ERROR: prescription_closed", t)).toBe("The prescription is completed or cancelled; it is not edited or added to.");
    expect(rxError("medication_name_required", (ar) => ar)).toContain("اسم");
    expect(rxError("something else", t)).toBeNull();
  });
  it("describes a line", () => {
    const l = { name_generic: "Amoxicillin", name_brand: null, strength: "500 mg", form: "capsule", dose: "1 capsule", route: "oral", frequency: "three times a day", as_needed: false,
      quantity: "21 capsules", duration_days: 7, refills: 0, instructions: null, indication: null };
    expect(lineTitle(l, "en")).toBe("Amoxicillin · 500 mg · Capsule");
    expect(lineSig(l, "en")).toBe("1 capsule · Oral · three times a day · 7 days · quantity: 21 capsules · refills: 0");
    expect(lineSig({ ...l, dose: null, route: null, frequency: null, quantity: null, duration_days: null, refills: null, as_needed: true }, "en")).toBe("as needed");
  });
  it("groups medication rows under their prescription and lists the drugs in force", () => {
    const rxs = groupPrescriptions(
      [{ id: "r1", prescriber_name: "Dr A", issued_on: "2026-11-01", status: "active" }, { id: "r2", prescriber_name: "Dr B", issued_on: "2026-10-01", status: "cancelled" }],
      [{ id: "m1", prescription_id: "r1", name_generic: "Amoxicillin", recorded_at: "2026-11-01T10:00:01Z", status: "active" },
       { id: "m2", prescription_id: "r1", name_brand: "Brufen", name_generic: "Ibuprofen", recorded_at: "2026-11-01T10:00:00Z", status: "stopped" },
       { id: "m3", prescription_id: "r2", name_generic: "Metronidazole", recorded_at: "2026-10-01T10:00:00Z", status: "stopped" }],
    );
    expect(rxs[0].lines.map((l) => l.id)).toEqual(["m2", "m1"]);
    expect(rxs[1].lines).toHaveLength(1);
    expect(activeDrugNames(rxs)).toEqual(["Amoxicillin"]);
  });
});

describe("consent form", () => {
  const ok = { kind: "surgery", title: "Consent to extraction", body: "I understand the extraction of tooth 38.", signer_name: "Ahmad Ali", signer_role: "patient" };
  it("reads a complete consent", () => {
    expect(parseConsentForm(form({ ...ok, witness_name: "Nurse Huda", treatment_item_id: "11111111-1111-4111-8111-111111111111" }), t))
      .toEqual({ consent: { ...ok, witness_name: "Nurse Huda", treatment_plan_id: null, treatment_item_id: "11111111-1111-4111-8111-111111111111", supersedes: null } });
  });
  it("refuses a missing kind, role, signer, title, a short text and a bad link", () => {
    expect(parseConsentForm(form({ ...ok, kind: "magic" }), t)).toEqual({ error: "Choose the kind of consent." });
    expect(parseConsentForm(form({ ...ok, signer_role: "nurse" }), t)).toEqual({ error: "Choose who is signing." });
    expect(parseConsentForm(form({ ...ok, signer_name: "A" }), t)).toEqual({ error: "Enter the signer's name." });
    expect(parseConsentForm(form({ ...ok, title: "" }), t)).toEqual({ error: "Enter a title for the consent." });
    expect(parseConsentForm(form({ ...ok, body: "short" }), t)).toEqual({ error: "The consent text is too short." });
    expect(parseConsentForm(form({ ...ok, supersedes: "not-a-uuid" }), t)).toEqual({ error: "Invalid request." });
  });
  it("starts from a template in the viewer's language, naming what it covers", () => {
    const en = consentTemplate("surgery", "en", "Simple extraction (38)");
    expect(en.title).toBe("Consent to a surgical procedure — Simple extraction (38)");
    expect(en.body).toContain("Procedure or plan: Simple extraction (38)");
    expect(en.body).toContain("surgical procedure");
    const ar = consentTemplate("anesthesia", "ar");
    expect(ar.title).toBe("موافقة على التخدير");
    expect(ar.body).toContain("التخدير");
    expect(consentTemplate("unknown-kind", "en").title).toBe("Consent to treatment");
  });
  it("explains database errors and orders a plan's consents newest first", () => {
    expect(consentError("consent_signed", t)).toContain("not edited");
    expect(consentError("nope", t)).toBeNull();
    const list = [{ treatment_plan_id: "p1", signed_at: "2026-01-01" }, { treatment_plan_id: "p2", signed_at: "2026-03-01" }, { treatment_plan_id: "p1", signed_at: "2026-02-01" }];
    expect(consentsForPlan(list, "p1").map((c) => c.signed_at)).toEqual(["2026-02-01", "2026-01-01"]);
  });
});
