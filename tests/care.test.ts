import { describe, expect, it } from "vitest";
import { countByState, daysBetween, describeReminder, dueCount, dueText, groupByPatient, parseRefill, reminderHref, reminderState, toItems, type FeedRow } from "@/lib/care/reminders";
import { attentionBadges, buildAttention, countsByPatient, labTrend, outsideBy } from "@/lib/care/attention";
import { compareReports, reportDate } from "@/lib/care/labs-compare";
import { asCard, bloodLabel, emergencyLink, medLine, tokenFromForm, validEmergencyToken } from "@/lib/care/emergency";
import { canRevoke, daysLeft, inviteLink, inviteStatus, memberKind, normalizeEmail, validEmail, validInviteToken } from "@/lib/care/members";
import { availableChannels, unavailableChannels } from "@/lib/care/channels";
import type { ObservationRow } from "@/lib/types";

const en = (_ar: string, e: string) => e;
const row = (o: Partial<FeedRow>): FeedRow => ({ kind: "recall", code: "dental_checkup", patient_id: "p1", ref_id: "r1", due_on: "2026-11-10", label: null, detail: null, at_time: null, ...o });

describe("reminders", () => {
  it("counts whole days between dates", () => {
    expect(daysBetween("2026-11-01", "2026-11-08")).toBe(7);
    expect(daysBetween("2026-11-08", "2026-11-01")).toBe(-7);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
  });
  it("classifies by distance, and a written reminder inside its lead time is soon", () => {
    expect(reminderState("recall", "2026-10-31", "2026-11-01")).toBe("overdue");
    expect(reminderState("recall", "2026-11-01", "2026-11-01")).toBe("today");
    expect(reminderState("recall", "2026-11-08", "2026-11-01")).toBe("soon");
    expect(reminderState("recall", "2026-11-09", "2026-11-01")).toBe("upcoming");
    expect(reminderState("custom", "2026-11-25", "2026-11-01")).toBe("soon");
  });
  it("sorts overdue first (longest overdue first), then by date", () => {
    const items = toItems([row({ ref_id: "a", due_on: "2026-11-20" }), row({ ref_id: "b", due_on: "2026-10-30" }), row({ ref_id: "c", due_on: "2026-10-01" }), row({ ref_id: "d", due_on: "2026-11-03" })], "2026-11-01");
    expect(items.map((i) => i.refId)).toEqual(["c", "b", "d", "a"]);
    expect(items.map((i) => i.state)).toEqual(["overdue", "overdue", "soon", "upcoming"]);
  });
  it("counts what the bell counts: overdue or within a week, and every written reminder in its lead time", () => {
    const items = toItems([row({ ref_id: "a", due_on: "2026-10-30" }), row({ ref_id: "b", due_on: "2026-11-30" }), row({ kind: "custom", ref_id: "c", due_on: "2026-11-25" }), row({ ref_id: "d", due_on: "2026-11-06" })], "2026-11-01");
    expect(dueCount(items)).toBe(3);
    expect(countByState(items)).toEqual({ overdue: 1, today: 0, soon: 2, upcoming: 1 });
  });
  it("links each kind to the page of its record", () => {
    expect(reminderHref("recall", "p")).toBe("/patients/p/dental?tab=followup");
    expect(reminderHref("medication_refill", "p")).toBe("/patients/p/medications");
    expect(reminderHref("prescription_end", "p")).toBe("/patients/p/medications#prescriptions");
    expect(reminderHref("test_order", "p")).toBe("/patients/p/test-orders");
    expect(reminderHref("appointment", "p")).toBe("/patients/p/appointments");
    expect(reminderHref("custom", "p")).toBe("/patients/p/reminders");
  });
  it("groups by file in order of first appearance", () => {
    const g = groupByPatient(toItems([row({ patient_id: "b", ref_id: "1", due_on: "2026-10-01" }), row({ patient_id: "a", ref_id: "2", due_on: "2026-10-02" }), row({ patient_id: "b", ref_id: "3", due_on: "2026-10-03" })], "2026-11-01"));
    expect(g.map((x) => [x.patientId, x.items.length])).toEqual([["b", 2], ["a", 1]]);
  });
  it("reads a refill and words the reminders", () => {
    expect(parseRefill("2/3")).toEqual({ n: 2, of: 3 });
    expect(parseRefill("x")).toBeNull();
    const name = (c: string | null, l: string) => l || String(c);
    const d = (o: Partial<FeedRow>, today = "2026-11-01") => describeReminder(toItems([row(o)], today)[0], en, name);
    expect(d({ kind: "medication_refill", label: "Insulin", detail: "2/3" })).toBe("Refill of Insulin (2 of 3)");
    expect(d({ kind: "medication_end", label: "Amoxicillin", due_on: "2026-10-20" })).toBe("Amoxicillin has ended but is still marked active");
    expect(d({ kind: "medication_end", label: "Amoxicillin", due_on: "2026-11-05" })).toBe("Amoxicillin ends");
    expect(d({ kind: "prescription_end", label: "Dr Sara", due_on: "2026-11-05" })).toBe("The prescription from Dr Sara ends");
    expect(d({ kind: "test_order", label: "CBC" })).toBe("Requested test not done: CBC");
    expect(d({ kind: "custom", label: "Renew insurance" })).toBe("Renew insurance");
  });
  it("words the distance", () => {
    expect(dueText(-3, en)).toBe("3 days overdue");
    expect(dueText(-1, en)).toBe("1 day overdue");
    expect(dueText(0, en)).toBe("today");
    expect(dueText(1, en)).toBe("tomorrow");
    expect(dueText(9, en)).toBe("in 9 days");
  });
  it("offers only the channel that can really deliver", () => {
    expect(availableChannels().map((c) => c.id)).toEqual(["in_app"]);
    expect(unavailableChannels().map((c) => c.id).sort()).toEqual(["email", "sms"]);
  });
});

describe("needs attention", () => {
  const lab = (o: Partial<Parameters<typeof labTrend>[0]> = {}) => ({ value_num: 15.2, unit: "%", ref_low: 11.5, ref_high: 14.5, prev_value: 16.4, prev_unit: "%", ...o });
  it("measures how far a value is outside its range", () => {
    expect(outsideBy(15, 11, 14)).toBe(1);
    expect(outsideBy(10, 11, 14)).toBe(1);
    expect(outsideBy(12, 11, 14)).toBe(0);
    expect(outsideBy(12, null, null)).toBe(0);
  });
  it("reads the trend against the previous value and the range", () => {
    expect(labTrend(lab())).toEqual({ dir: "down", delta: -1.2, verdict: "improving" });
    expect(labTrend(lab({ value_num: 17, prev_value: 16 }))).toEqual({ dir: "up", delta: 1, verdict: "worsening" });
    expect(labTrend(lab({ value_num: 16.4 })).dir).toBe("flat");
    expect(labTrend(lab({ value_num: 16.4 })).verdict).toBe("unchanged");
    expect(labTrend(lab({ ref_low: null, ref_high: null }))).toEqual({ dir: "down", delta: -1.2, verdict: null });
  });
  it("never compares different units or a missing previous value", () => {
    expect(labTrend(lab({ unit: "g/dL", prev_unit: "g/L" }))).toEqual({ dir: "none", delta: null, verdict: null });
    expect(labTrend(lab({ prev_value: null }))).toEqual({ dir: "none", delta: null, verdict: null });
    expect(labTrend(lab({ value_num: null }))).toEqual({ dir: "none", delta: null, verdict: null });
  });
  it("builds the badges of a file, the most serious first, none for zero", () => {
    expect(attentionBadges(undefined, en)).toEqual([]);
    const b = attentionBadges({ drafts: 2, abnormal_labs: 3, soft_tissue: 1, overdue: 0 }, en);
    expect(b.map((x) => x.code)).toEqual(["soft_tissue", "abnormal_labs", "drafts"]);
    expect(b[1].text).toBe("3 lab out of range");
  });
  it("sums counts per file", () => {
    const m = countsByPatient([{ patient_id: "a", code: "overdue", n: 2 }, { patient_id: "a", code: "drafts", n: 1 }, { patient_id: "b", code: "overdue", n: 4 }]);
    expect(m.get("a")).toEqual({ overdue: 2, drafts: 1 });
    expect(m.get("b")).toEqual({ overdue: 4 });
  });
  it("lists the matters by seriousness and leaves out what is empty", () => {
    const empty = { base: "/patients/p", overdue: [], unreviewed: { notes: 0, clinicians: [] }, softTissue: false, shares: [], drafts: { perio: 0, notes: 0 }, documentsNoDate: 0, ordersOpen: 0, suggested: 0 };
    expect(buildAttention(empty, en)).toEqual([]);
    const items = buildAttention({ ...empty, softTissue: true, overdue: [{ label: "Check-up", days: 3, href: "/x" }, { label: "CBC", days: 1, href: "/y" }], unreviewed: { notes: 1, clinicians: ["Dr Sara Molar"] },
      shares: [{ id: "s1", title: "Dentist", hoursLeft: 5 }], drafts: { perio: 1, notes: 2 } }, en);
    expect(items.map((i) => i.key)).toEqual(["soft_tissue", "overdue", "notes", "clinician:Dr Sara Molar", "share:s1", "perio_draft", "note_drafts"]);
    expect(items[1].text).toBe("2 overdue: Check-up, CBC.");
    expect(items[3].text).toBe("Dr Sara Molar added to your file through a share link — review it on the share page.");
    expect(items[4].text).toBe("Share “Dentist” ends in 5 h.");
    expect(items[0].tone).toBe("bad");
  });
});

describe("lab report comparison", () => {
  const obs = (o: Partial<ObservationRow>): ObservationRow => ({ id: Math.random().toString(36), patient_id: "p", type_id: "t1", report_id: "r", encounter_id: null, specialty_id: null, custom_name: null, value_num: 1, value_num2: null,
    value_text: null, unit: "g/dL", effective_at: "2026-10-01T08:00:00Z", setting: "lab", device: null, context: null, symptoms: null, notes: null, ref_low: null, ref_high: null, ref_text: null,
    interpretation: "normal", interpretation_basis: null, status: "final", supersedes_id: null, amendment_reason: null, source: "self", source_detail: null, verification: "reported", recorded_by: null, recorded_at: "2026-10-01T08:00:00Z", ...o });
  it("sets values side by side with the change and its share", () => {
    const rows = compareReports([obs({ type_id: "hb", value_num: 10 })], [obs({ type_id: "hb", value_num: 12.5 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ delta: 2.5, pct: 25, dir: "up", unitChanged: false });
  });
  it("shows a test present in one report only, without a change", () => {
    const rows = compareReports([obs({ type_id: "a" })], [obs({ type_id: "b" })]);
    expect(rows.map((r) => [r.a != null, r.b != null, r.delta])).toEqual([[true, false, null], [false, true, null]]);
  });
  it("computes no change across units", () => {
    const [r] = compareReports([obs({ type_id: "hb", value_num: 80, unit: "g/L" })], [obs({ type_id: "hb", value_num: 10, unit: "g/dL" })]);
    expect(r.delta).toBeNull(); expect(r.unitChanged).toBe(true); expect(r.dir).toBe("none");
  });
  it("tells other tests apart by name, ignores invalid results and takes the latest of a repeated test", () => {
    const rows = compareReports([obs({ type_id: "o", custom_name: "X" }), obs({ type_id: "o", custom_name: "Y" }), obs({ type_id: "h", status: "entered_in_error" }),
      obs({ type_id: "k", value_num: 1, effective_at: "2026-10-01T08:00:00Z" }), obs({ type_id: "k", value_num: 3, effective_at: "2026-10-01T09:00:00Z" })], []);
    expect(rows.map((r) => r.customName ?? r.typeId).sort()).toEqual(["X", "Y", "k"]);
    expect(rows.find((r) => r.typeId === "k")?.a?.num).toBe(3);
  });
  it("shows a blood pressure pair as text and never as a number", () => {
    const [r] = compareReports([obs({ type_id: "bp", value_num: 150, value_num2: 95 })], [obs({ type_id: "bp", value_num: 130, value_num2: 85 })]);
    expect(r.a?.value).toBe("150/95"); expect(r.delta).toBeNull();
  });
  it("dates a report by its sample, else its performance, approval or entry", () => {
    expect(reportDate({ collected_at: "2026-10-03T07:00:00Z", performed_at: null, approved_at: null, recorded_at: "2026-10-09T00:00:00Z" })).toBe("2026-10-03");
    expect(reportDate({ collected_at: null, performed_at: null, approved_at: null, recorded_at: "2026-10-09T00:00:00Z" })).toBe("2026-10-09");
  });
});

describe("emergency card", () => {
  const card = { patient: { full_name: "A", full_name_en: null, sex: "male", date_of_birth: "1980-01-01", blood_abo: "A", blood_rh: "+", blood_group_verified: true, allergy_assertion: "unknown" },
    allergies: [], conditions: [], medications: [], devices: [], contacts: [], assertions: { none_devices: true }, include_sensitive: false };
  it("accepts only an answer shaped like a card", () => {
    expect(asCard(card)?.assertions).toEqual({ none_chronic_conditions: false, none_long_term_medications: false, none_devices: true });
    expect(asCard(null)).toBeNull();
    expect(asCard({ status: "unavailable" })).toBeNull();
    expect(asCard({ ...card, allergies: "x" })).toBeNull();
    expect(asCard({ ...card, patient: { date_of_birth: "1980-01-01" } })).toBeNull();
  });
  it("builds links and checks tokens", () => {
    expect(emergencyLink("https://x.test/", "abc")).toBe("https://x.test/e/abc");
    expect(validEmergencyToken("a".repeat(32))).toBe(true);
    expect(validEmergencyToken("short")).toBe(false);
    expect(validEmergencyToken("a/b".padEnd(32, "c"))).toBe(false);
    expect(tokenFromForm(" " + "a".repeat(32) + " ")).toBe("a".repeat(32));
    expect(tokenFromForm("../..")).toBeNull();
    expect(tokenFromForm(null)).toBeNull();
  });
  it("words the blood group and the medicines", () => {
    expect(bloodLabel({ blood_abo: "AB", blood_rh: "-" })).toBe("AB-");
    expect(bloodLabel({ blood_abo: null, blood_rh: null })).toBe("");
    expect(medLine({ name: "Metformin", strength: "500 mg", dose: null, frequency: "twice a day" })).toBe("Metformin · 500 mg · twice a day");
  });
});

describe("members by invite", () => {
  it("normalises and checks an e-mail address", () => {
    expect(normalizeEmail("  Erin@Example.TEST ")).toBe("erin@example.test");
    expect(validEmail("a@b.co")).toBe(true);
    expect(validEmail("a@b")).toBe(false);
    expect(validEmail("a b@c.de")).toBe(false);
    expect(validEmail(`${"x".repeat(250)}@b.co`)).toBe(false);
  });
  it("builds the link and checks the token", () => {
    expect(inviteLink("https://x.test", "tok")).toBe("https://x.test/invite/tok");
    expect(validInviteToken("A".repeat(32))).toBe(true);
    expect(validInviteToken("A".repeat(10))).toBe(false);
  });
  it("tells where an invite stands", () => {
    const now = Date.parse("2026-11-01T00:00:00Z");
    const base = { accepted_at: null, revoked_at: null, expires_at: "2026-11-05T00:00:00Z" };
    expect(inviteStatus(base, now)).toBe("pending");
    expect(inviteStatus({ ...base, expires_at: "2026-10-31T00:00:00Z" }, now)).toBe("expired");
    expect(inviteStatus({ ...base, revoked_at: "2026-10-30T00:00:00Z" }, now)).toBe("revoked");
    expect(inviteStatus({ ...base, accepted_at: "2026-10-30T00:00:00Z" }, now)).toBe("accepted");
    expect(daysLeft("2026-11-05T00:00:00Z", now)).toBe(4);
    expect(daysLeft("2026-10-01T00:00:00Z", now)).toBe(0);
  });
  it("names members and says whom can be removed", () => {
    expect(memberKind({ role: "owner", can_write: true })).toBe("owner");
    expect(memberKind({ role: "caregiver", can_write: true })).toBe("editor");
    expect(memberKind({ role: "caregiver", can_write: false })).toBe("viewer");
    expect(canRevoke({ role: "caregiver", revoked_at: null })).toBe(true);
    expect(canRevoke({ role: "caregiver", revoked_at: "2026-10-01" })).toBe(false);
    expect(canRevoke({ role: "owner", revoked_at: null })).toBe(false);
    expect(canRevoke({ role: "guardian", revoked_at: null })).toBe(false);
  });
});
