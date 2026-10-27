import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ageLabel, fmtDate, fmtDateTime } from "@/lib/format";
import {
  ALLERGY_ASSERTION, ALLERGY_SEVERITY, CARE_PLAN_STATUS, CERTAINTY, CLINICAL_STATUS, CONDITION_CATEGORY, ENCOUNTER_KIND, FAMILY_RELATION,
  IMAGING_MODALITY, IMMUNIZATION_STATUS, INTERPRETATION, lbl, LAB_GROUP, MED_ORIGIN, PROCEDURE_KIND, SEX, SHARE_MODULES, type Opt,
} from "@/lib/labels";
import { buildSeries, inWindow, resolveWindow, stats } from "@/lib/clinical/series";
import { REF_LINES } from "@/lib/clinical/refs";
import { forSex } from "@/lib/sex";
import type { Bundle } from "@/lib/share-types";
import type { ObservationRow, ObservationType, PatientRow } from "@/lib/types";
import type { Block, Cell, ReportMeta } from "@/lib/pdf/engine";

type Lang = "ar" | "en";
type R = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => (v == null || v === "" ? "" : String(Number(v)));

const tx = (lang: Lang) => (ar: string, en: string) => (lang === "ar" ? ar : en);
const interpCell = (v: string, lang: Lang): Cell => {
  const m = INTERPRETATION[v] ?? INTERPRETATION.not_assessed;
  return v === "normal" || v === "not_assessed" ? { text: m[lang], tone: v === "normal" ? "ok" : "muted" } : { text: m[lang], tone: m.tone };
};
const valueOf = (o: { value_kind?: unknown; value_num?: unknown; value_num2?: unknown; value_text?: unknown }) =>
  o.value_kind === "bp" ? `${num(o.value_num)}/${num(o.value_num2)}` : s(o.value_num != null ? num(o.value_num) : o.value_text);

const SAFETY_NOTE = (lang: Lang) => tx(lang)(
  "أداة لتنظيم المعلومات الصحية؛ لا تقدّم تشخيصاً ولا علاجاً. التصنيفات مؤشرات فحص عامة تستدعي تقييم مختص.",
  "A tool to organise health information; it does not diagnose or treat. Flags are general screening prompts that need professional assessment.");

function identityLines(lang: Lang, tz: string, p: { mrn: string; date_of_birth: string; sex: string; nationality?: string | null; blood?: string | null; verified?: boolean; phone?: string | null }) {
  const t = tx(lang);
  return [
    [p.mrn, ageLabel(p.date_of_birth, lang), lbl(SEX, p.sex, lang), `${t("الميلاد", "DOB")} ${fmtDate(p.date_of_birth, lang, tz)}`, p.nationality].filter(Boolean).join("  ·  "),
    [p.blood ? `${t("فصيلة الدم", "Blood group")}: ${p.blood}${p.verified ? "" : ` (${t("غير موثقة", "unverified")})`}` : t("فصيلة الدم غير مسجلة", "Blood group not recorded"), p.phone].filter(Boolean).join("  ·  "),
  ];
}

function chartBlocks(lang: Lang, tz: string, type: ObservationType, rows: ObservationRow[], window?: { from: number; to: number }): Block[] {
  const t = tx(lang);
  const all = buildSeries(type, rows);
  const series = all.map((x) => ({ ...x, pts: window ? inWindow(x.pts, window) : x.pts })).filter((x) => x.pts.length);
  if (!series.some((x) => x.pts.length >= 2)) return [];
  const units = new Set(series.map((x) => x.unit));
  const name = lang === "ar" ? type.name_ar : type.name_en;
  const multi = units.size > 1;
  const out: Block[] = [];
  if (multi) out.push({ t: "alert", tone: "warn", text: t("وحدات مختلفة: تُعرض منفصلة ولا تُقارن.", "Different units: drawn separately, not compared.") });
  const groups = multi ? Array.from(units).map((u) => series.filter((x) => x.unit === u)) : [series];
  for (const g of groups) {
    const unit = g[0].unit;
    const st = stats(g.find((x) => x.role !== "dia")?.pts ?? g[0].pts);
    out.push({
      t: "chart", title: `${name}${unit ? ` · ${unit}` : ""}`, caption: st ? `${t("المتوسط", "mean")} ${Number(st.mean.toFixed(1))}  ·  ${t("أدنى", "min")} ${st.min}  ·  ${t("أعلى", "max")} ${st.max}  ·  ${st.count} ${t("قراءة", "readings")}` : undefined,
      series: g.map((x) => ({ label: x.label[lang], pts: x.pts.map((p) => ({ t: p.t, v: p.v })) })),
      refs: !multi ? (REF_LINES[type.code] ?? []).map((r) => ({ y: r.v, label: r.label })) : undefined,
      dateLabel: (ms) => fmtDate(new Date(ms), lang, tz),
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ patient's own report
export type ReportScope = "summary" | "vitals" | "labs" | "full";

export async function buildPatientReport(supabase: SupabaseClient, p: PatientRow, o: {
  lang: Lang; tz: string; scope: ReportScope; typeCode?: string; range?: string; from?: string; to?: string; types: ObservationType[];
}): Promise<{ meta: ReportMeta; blocks: Block[]; filename: string }> {
  const { lang, tz } = o;
  const t = tx(lang);
  const d = (v: unknown) => fmtDate(s(v), lang, tz);
  const dt = (v: unknown) => fmtDateTime(s(v), lang, tz);
  const types = forSex(o.types, p.sex);
  const byId = new Map(types.map((x) => [x.id, x]));
  const blocks: Block[] = [];
  const wantSummary = o.scope === "summary" || o.scope === "full";
  const wantVitals = o.scope === "vitals" || o.scope === "full";
  const wantLabs = o.scope === "labs" || o.scope === "full";

  const win = o.scope === "vitals" ? (resolveWindow(o.range, o.from, o.to) ?? resolveWindow("90", undefined, undefined)!) : undefined;
  const needObs = wantVitals || wantLabs || wantSummary;
  const [allergies, conditions, meds, contacts, obsRes, encs] = await Promise.all([
    wantSummary ? supabase.from("allergies").select("substance, severity, reaction, certainty").eq("patient_id", p.id).eq("status", "active").eq("record_status", "active").neq("certainty", "refuted") : { data: [] },
    wantSummary ? supabase.from("conditions").select("name, category, certainty, clinical_status, onset_date").eq("patient_id", p.id).eq("record_status", "active").order("onset_date", { ascending: false, nullsFirst: false }).limit(60) : { data: [] },
    wantSummary ? supabase.from("medications").select("name_generic, name_brand, strength, dose, frequency, route, origin, indication, status").eq("patient_id", p.id).eq("record_status", "active").eq("status", "active") : { data: [] },
    wantSummary ? supabase.from("emergency_contacts").select("full_name, relation, phone, is_legal_representative").eq("patient_id", p.id) : { data: [] },
    needObs ? supabase.from("observations").select("*").eq("patient_id", p.id).in("status", ["final", "preliminary"]).order("effective_at", { ascending: false }).limit(5000) : { data: [] },
    wantSummary ? supabase.from("encounters").select("kind, reason, started_at, practitioner_name, facility_name, assessment, summary").eq("patient_id", p.id).eq("record_status", "active").order("started_at", { ascending: false }).limit(12) : { data: [] },
  ]);
  const obs = ((obsRes.data ?? []) as ObservationRow[]).filter((x) => byId.has(x.type_id));
  const rowsOf = (id: string) => obs.filter((x) => x.type_id === id);

  if (wantSummary) {
    const al = (allergies.data ?? []) as R[];
    blocks.push({ t: "h", text: t("معلومات السلامة", "Safety information") });
    if (al.length) blocks.push({ t: "alert", tone: "bad", title: t("حساسية موثقة", "Documented allergies"), text: al.map((a) => `${s(a.substance)} — ${lbl(ALLERGY_SEVERITY, s(a.severity), lang)}${a.reaction ? ` (${s(a.reaction)})` : ""}`).join(lang === "ar" ? "،  " : ",  ") });
    else if (p.allergy_assertion === "none_known") blocks.push({ t: "alert", tone: "ok", text: t("لا توجد حساسية معروفة (إقرار مسجل).", "No known allergies (recorded statement).") });
    else blocks.push({ t: "alert", tone: "warn", title: t("حالة الحساسية غير معروفة", "Allergy status unknown"), text: t("لم تُسجَّل بعد؛ لا يعني ذلك غياب الحساسية.", "not recorded yet; this does not mean there are none.") });
    void ALLERGY_ASSERTION;

    const cs = (conditions.data ?? []) as R[];
    blocks.push({ t: "h", text: t("الأمراض والتشخيصات", "Conditions") });
    blocks.push(cs.length ? { t: "table", cols: [{ label: t("الحالة", "Condition"), w: 4 }, { label: t("التصنيف", "Category"), w: 2 }, { label: t("اليقين", "Certainty"), w: 2 }, { label: t("الوضع", "Status"), w: 2 }, { label: t("البداية", "Onset"), w: 2 }],
      rows: cs.map((c) => [{ text: s(c.name), bold: true }, lbl(CONDITION_CATEGORY, s(c.category), lang), lbl(CERTAINTY, s(c.certainty), lang), lbl(CLINICAL_STATUS, s(c.clinical_status), lang), d(c.onset_date)]) }
      : { t: "p", muted: true, text: t("لا شيء مسجل (لا يعني عدم وجود).", "None recorded (not proof of none).") });

    const ms = (meds.data ?? []) as R[];
    blocks.push({ t: "h", text: t("الأدوية الحالية", "Current medications") });
    blocks.push(ms.length ? { t: "table", cols: [{ label: t("الدواء", "Medication"), w: 4 }, { label: t("الجرعة", "Dose"), w: 3 }, { label: t("المصدر", "Origin"), w: 2 }, { label: t("الدافع", "Indication"), w: 3 }],
      rows: ms.map((m) => [{ text: [s(m.name_generic), m.name_brand && `(${s(m.name_brand)})`, s(m.strength)].filter(Boolean).join(" "), bold: true }, [s(m.dose), s(m.frequency), s(m.route)].filter(Boolean).join(" · "), lbl(MED_ORIGIN, s(m.origin), lang), s(m.indication)]) }
      : { t: "p", muted: true, text: t("لا شيء مسجل (لا يعني عدم تناول أدوية).", "None recorded (not proof none are taken).") });

    const cc = (contacts.data ?? []) as R[];
    if (cc.length) {
      blocks.push({ t: "h", text: t("جهات الطوارئ", "Emergency contacts") });
      blocks.push({ t: "table", cols: [{ label: t("الاسم", "Name"), w: 4 }, { label: t("الصلة", "Relation"), w: 3 }, { label: t("الهاتف", "Phone"), w: 3 }], rows: cc.map((c) => [{ text: s(c.full_name), bold: true }, `${s(c.relation)}${c.is_legal_representative ? ` (${t("ممثل قانوني", "legal representative")})` : ""}`, s(c.phone)]) });
    }
  }

  // ---- latest value per measurement (vital + lab) for the summary / full report
  const latestRows = (list: ObservationType[]) => list.map((ty) => ({ ty, rows: rowsOf(ty.id) })).filter((x) => x.rows.length);
  const latestTable = (list: { ty: ObservationType; rows: ObservationRow[] }[], withGroup: boolean): Block => ({
    t: "table",
    cols: [{ label: t("القياس", "Measure"), w: 4 }, { label: t("آخر قيمة", "Latest"), w: 2.2 }, { label: t("التاريخ", "Date"), w: 2.6 }, { label: t("المرجع", "Ref."), w: 2 }, { label: t("التصنيف", "Flag"), w: 2.6 }, { label: t("العدد", "n"), w: 0.9 }],
    rows: list.map(({ ty, rows }) => {
      const l = rows[0];
      const ref = l.ref_low != null || l.ref_high != null ? `${num(l.ref_low)} – ${num(l.ref_high)}` : s(l.ref_text);
      const name = (lang === "ar" ? ty.name_ar : ty.name_en) + (withGroup && ty.lab_group ? ` (${LAB_GROUP[ty.lab_group]?.[lang] ?? ""})` : "");
      return [{ text: name, bold: true }, `${valueOf({ ...l, value_kind: ty.value_kind })} ${s(l.unit)}`.trim(), dt(l.effective_at), ref, interpCell(l.interpretation, lang), String(rows.length)];
    }),
  });

  if (o.scope === "vitals") {
    const type = types.find((x) => x.code === o.typeCode && x.category !== "lab");
    const list = type ? [type] : types.filter((x) => x.category !== "lab");
    blocks.push({ t: "h", text: type ? (lang === "ar" ? type.name_ar : type.name_en) : t("القياسات الحيوية", "Vital signs") });
    blocks.push({ t: "p", muted: true, text: `${t("الفترة", "Period")}: ${Number.isFinite(win!.from) && win!.from > 0 ? `${fmtDate(new Date(win!.from), lang, tz)} – ${fmtDate(new Date(win!.to), lang, tz)}` : t("كل الفترة", "All time")}` });
    blocks.push({ t: "alert", tone: "info", text: t("التصنيفات (مرتفع / منخفض…) مؤشرات فحص عامة للبالغين وليست تشخيصاً. قراءات غير البالغين وما بعد الجهد لا تُصنَّف.", "Flags (high / low…) are general adult screening prompts, not a diagnosis. Readings for under-18s and after exertion are not classified.") });
    for (const ty of list) {
      const rows = rowsOf(ty.id).filter((r) => { const tt = Date.parse(r.effective_at); return tt >= win!.from && tt <= win!.to; });
      if (!rows.length) { if (type) blocks.push({ t: "p", muted: true, text: t("لا قراءات ضمن هذه الفترة.", "No readings in this period.") }); continue; }
      if (!type) blocks.push({ t: "h", text: lang === "ar" ? ty.name_ar : ty.name_en });
      blocks.push(...chartBlocks(lang, tz, ty, rows, win));
      blocks.push({ t: "table", cols: [{ label: t("الوقت", "Time"), w: 3 }, { label: t("القيمة", "Value"), w: 2.4 }, { label: t("السياق", "Context"), w: 2.4 }, { label: t("التصنيف", "Flag"), w: 2.6 }, { label: t("ملاحظات", "Notes"), w: 3 }],
        rows: rows.slice(0, type ? 400 : 25).map((r) => [dt(r.effective_at), { text: `${valueOf({ ...r, value_kind: ty.value_kind })} ${s(r.unit)}`.trim(), bold: true }, s(r.context), interpCell(r.interpretation, lang), s(r.notes)]) });
    }
  } else {
    if (wantVitals || wantSummary) {
      const vit = latestRows(types.filter((x) => x.category !== "lab"));
      if (vit.length) { blocks.push({ t: "h", text: t("القياسات الحيوية (آخر قراءة)", "Vital signs (latest)") }); blocks.push(latestTable(vit, false)); }
      if (wantVitals) {
        const w = resolveWindow("365", undefined, undefined)!;
        for (const { ty, rows } of vit) blocks.push(...chartBlocks(lang, tz, ty, rows, w));
      }
    }
    if (wantLabs || wantSummary) {
      const labs = latestRows(types.filter((x) => x.category === "lab")).sort((a, b) => s(a.ty.lab_group).localeCompare(s(b.ty.lab_group)) || a.ty.sort - b.ty.sort);
      if (labs.length) {
        blocks.push({ t: "h", text: t("التحاليل المخبرية (آخر نتيجة)", "Lab results (latest)") });
        blocks.push({ t: "alert", tone: "info", text: t("المجالات المرجعية وتصنيفات المختبر كما سُجّلت مع كل نتيجة.", "Reference ranges and lab flags are as recorded with each result.") });
        blocks.push(latestTable(labs, true));
        if (wantLabs) for (const { ty, rows } of labs.filter((x) => x.rows.length >= 2).slice(0, 12)) blocks.push(...chartBlocks(lang, tz, ty, rows));
      }
    }
  }

  if (wantSummary) {
    const es = (encs.data ?? []) as R[];
    if (es.length) {
      blocks.push({ t: "h", text: t("آخر الزيارات", "Latest visits") });
      blocks.push({ t: "table", cols: [{ label: t("التاريخ", "Date"), w: 2.6 }, { label: t("النوع / السبب", "Type / reason"), w: 4 }, { label: t("الطبيب / المنشأة", "Practitioner / facility"), w: 3 }, { label: t("التقييم", "Assessment"), w: 3.4 }],
        rows: es.map((e) => [dt(e.started_at), { text: `${lbl(ENCOUNTER_KIND, s(e.kind), lang)}${e.reason ? ` — ${s(e.reason)}` : ""}`, bold: true }, [s(e.practitioner_name), s(e.facility_name)].filter(Boolean).join(" · "), s(e.assessment || e.summary)]) });
    }
  }

  const titleBy: Record<ReportScope, string> = {
    summary: t("الملخص الصحي", "Health summary"), vitals: t("تقرير القياسات الحيوية", "Vital signs report"),
    labs: t("تقرير التحاليل المخبرية", "Lab results report"), full: t("التقرير الصحي الكامل", "Complete health report"),
  };
  const name = lang === "en" && p.full_name_en ? p.full_name_en : p.full_name;
  return {
    meta: {
      lang, title: titleBy[o.scope], brand: t("بوابة شفاء", "Shifa Portal"),
      headline: { name, lines: identityLines(lang, tz, { mrn: p.mrn, date_of_birth: p.date_of_birth, sex: p.sex, nationality: p.nationality, blood: p.blood_abo ? `${p.blood_abo}${p.blood_rh ?? ""}` : null, verified: p.blood_group_verified, phone: p.phone }) },
      generatedAt: `${t("أُنشئ في", "Generated")} ${fmtDateTime(new Date(), lang, tz)}`, footerNote: SAFETY_NOTE(lang),
    },
    blocks, filename: `${p.mrn}-${o.scope}${o.scope === "vitals" && o.typeCode ? `-${o.typeCode}` : ""}.pdf`,
  };
}

// ------------------------------------------------------------------------------------------------ a doctor's shared bundle
export function buildShareReport(b: Bundle, o: { lang: Lang; tz: string }): { meta: ReportMeta; blocks: Block[]; filename: string } {
  const { lang, tz } = o;
  const t = tx(lang);
  const d = (v: unknown) => fmtDate(s(v), lang, tz);
  const dt = (v: unknown) => fmtDateTime(s(v), lang, tz);
  const inc = new Set(b.meta.include);
  const spec = (id: unknown) => { const x = b.specialties.find((y) => y.id === id); return x ? (lang === "ar" ? x.name_ar : x.name_en) : ""; };
  const blocks: Block[] = [];
  const sec = (title: string) => blocks.push({ t: "h", text: title });
  const kvs = (rows: [string, string][]) => blocks.push({ t: "kv", rows });

  blocks.push({ t: "p", text: `${t("الغرض", "Purpose")}: ${b.meta.title}${b.meta.recipient_label ? ` — ${b.meta.recipient_label}` : ""}` });
  blocks.push({ t: "p", muted: true, text: `${t("النطاق", "Scope")}: ${b.meta.scope_kind === "specialty" ? b.meta.specialties.map((x) => (lang === "ar" ? x.name_ar : x.name_en)).join(lang === "ar" ? "، " : ", ") : b.meta.scope_kind === "full" ? t("الملف الكامل", "Whole file") : t("سجلات مختارة", "Selected records")}${b.meta.date_from || b.meta.date_to ? ` · ${b.meta.date_from ?? "…"} – ${b.meta.date_to ?? "…"}` : ""} · ${t("يتضمن", "includes")}: ${b.meta.include.map((m) => (SHARE_MODULES.find((x: Opt) => x.value === m) as Opt | undefined)?.[lang]).filter(Boolean).join(lang === "ar" ? "، " : ", ") || t("الأساسيات فقط", "essentials only")}` });

  sec(t("معلومات السلامة", "Safety information"));
  if (b.allergies.length) blocks.push({ t: "alert", tone: "bad", title: t("حساسية موثقة", "Documented allergies"), text: b.allergies.map((a) => `${s(a.substance)} — ${lbl(ALLERGY_SEVERITY, s(a.severity), lang)}${a.reaction ? ` (${s(a.reaction)})` : ""}`).join(lang === "ar" ? "،  " : ",  ") });
  else if (b.allergy_assertion === "none_known") blocks.push({ t: "alert", tone: "ok", text: t("لا توجد حساسية معروفة (إقرار المريض).", "No known allergies (patient’s statement).") });
  else blocks.push({ t: "alert", tone: "warn", title: t("حالة الحساسية غير معروفة", "Allergy status unknown"), text: t("لم يُسجَّل شيء؛ لا يعني ذلك غياب الحساسية.", "nothing recorded; this does not mean none exist.") });
  blocks.push({ t: "h", text: t("الأمراض المزمنة والعيوب الخلقية", "Chronic & congenital conditions") });
  blocks.push(b.chronic_conditions.length ? { t: "table", cols: [{ label: t("الحالة", "Condition"), w: 4 }, { label: t("اليقين", "Certainty"), w: 2 }, { label: t("الوضع", "Status"), w: 2 }, { label: t("البداية", "Onset"), w: 2 }],
    rows: b.chronic_conditions.map((c) => [{ text: s(c.name), bold: true }, lbl(CERTAINTY, s(c.certainty), lang), lbl(CLINICAL_STATUS, s(c.clinical_status), lang), d(c.onset_date)]) } : { t: "p", muted: true, text: t("لا شيء مسجل (لا يعني عدم وجود).", "None recorded (not proof of none).") });
  blocks.push({ t: "h", text: t("الأدوية الحالية", "Current medications") });
  blocks.push(b.medications.length ? { t: "table", cols: [{ label: t("الدواء", "Medication"), w: 4 }, { label: t("الجرعة", "Dose"), w: 3 }, { label: t("المصدر", "Origin"), w: 2 }, { label: t("الدافع", "Indication"), w: 3 }],
    rows: b.medications.map((m) => [{ text: [s(m.name_generic), m.name_brand && `(${s(m.name_brand)})`, s(m.strength)].filter(Boolean).join(" "), bold: true }, [s(m.dose), s(m.frequency), s(m.route)].filter(Boolean).join(" · "), lbl(MED_ORIGIN, s(m.origin), lang), s(m.indication)]) } : { t: "p", muted: true, text: t("لا شيء مسجل (لا يعني عدم تناول أدوية).", "None recorded (not proof none are taken).") });

  if (inc.has("contact") && (b.emergency_contacts ?? []).length) {
    sec(t("جهات الطوارئ", "Emergency contacts"));
    blocks.push({ t: "table", cols: [{ label: t("الاسم", "Name"), w: 4 }, { label: t("الصلة", "Relation"), w: 3 }, { label: t("الهاتف", "Phone"), w: 3 }], rows: (b.emergency_contacts ?? []).map((c) => [{ text: s(c.full_name), bold: true }, s(c.relation), s(c.phone)]) });
  }

  if (inc.has("observations")) {
    const obs = (b.observations ?? []) as R[];
    sec(t("القياسات والتحاليل عبر الزمن", "Measurements & lab results over time"));
    if (!obs.length) blocks.push({ t: "p", muted: true, text: t("لا توجد قياسات ضمن النطاق.", "No measurements in scope.") });
    else {
      blocks.push({ t: "alert", tone: "info", text: t("التصنيفات مؤشرات فحص عامة أو من المختبر وليست تشخيصاً. الوحدات والمجالات المرجعية كما سُجّلت.", "Flags are general screening prompts or lab flags, not a diagnosis. Units and reference ranges are as recorded.") });
      const byType = new Map<string, R[]>();
      for (const x of obs) byType.set(s(x.type_code), [...(byType.get(s(x.type_code)) ?? []), x]);
      const groups = Array.from(byType.entries()).sort((a, c) => s(a[1][0].category).localeCompare(s(c[1][0].category)) || s(a[1][0].lab_group).localeCompare(s(c[1][0].lab_group)));
      blocks.push({ t: "table", cols: [{ label: t("القياس", "Measure"), w: 4 }, { label: t("آخر قيمة", "Latest"), w: 2.2 }, { label: t("التاريخ", "Date"), w: 2.6 }, { label: t("المرجع", "Ref."), w: 2 }, { label: t("التصنيف", "Flag"), w: 2.6 }, { label: t("العدد", "n"), w: 0.9 }],
        rows: groups.map(([, list]) => { const l = list[0]; const ref = l.ref_low != null || l.ref_high != null ? `${num(l.ref_low)} – ${num(l.ref_high)}` : s(l.ref_text);
          return [{ text: l.custom_name ? s(l.custom_name) : s(lang === "ar" ? l.name_ar : l.name_en), bold: true }, `${valueOf(l)} ${s(l.unit)}`.trim(), dt(l.effective_at), ref, interpCell(s(l.interpretation), lang), String(list.length)]; }) });
      for (const [code, list] of groups) {
        const f = list[0];
        const ty = { code, value_kind: f.value_kind, name_ar: f.name_ar, name_en: f.name_en, default_unit: s(f.unit) || null, decimals: 1 } as unknown as ObservationType;
        const rows = list.map((x) => ({ ...x, id: x.id, status: x.status, interpretation: x.interpretation, unit: x.unit, type_id: code } as unknown as ObservationRow));
        blocks.push(...chartBlocks(lang, tz, ty, rows));
      }
    }
  }
  if (inc.has("encounters") && (b.encounters ?? []).length) {
    sec(t("الزيارات", "Visits"));
    for (const e of b.encounters ?? []) {
      blocks.push({ t: "p", text: `${dt(e.started_at)} — ${lbl(ENCOUNTER_KIND, s(e.kind), lang)}${e.reason ? ` — ${s(e.reason)}` : ""}${spec(e.specialty_id) ? `  [${spec(e.specialty_id)}]` : ""}` });
      kvs([[t("الطبيب", "Practitioner"), s(e.practitioner_name)], [t("المنشأة", "Facility"), s(e.facility_name)], [t("الأعراض", "Symptoms"), s(e.symptoms)], [t("الفحص", "Examination"), s(e.examination)], [t("التقييم", "Assessment"), s(e.assessment)], [t("الخطة", "Plan"), s(e.plan)], [t("الملخص", "Summary"), s(e.summary)], [t("ملخص الخروج", "Discharge"), s(e.discharge_summary)]]);
    }
  }
  if (inc.has("other_conditions") && (b.other_conditions ?? []).length) {
    sec(t("التشخيصات والحالات الأخرى", "Other diagnoses & conditions"));
    blocks.push({ t: "table", cols: [{ label: t("الحالة", "Condition"), w: 4 }, { label: t("اليقين", "Certainty"), w: 2 }, { label: t("الوضع", "Status"), w: 2 }, { label: t("التخصص", "Specialty"), w: 2.5 }, { label: t("البداية", "Onset"), w: 2 }],
      rows: (b.other_conditions ?? []).map((c) => [{ text: s(c.name), bold: true }, lbl(CERTAINTY, s(c.certainty), lang), lbl(CLINICAL_STATUS, s(c.clinical_status), lang), spec(c.specialty_id), d(c.onset_date)]) });
  }
  if (inc.has("procedures") && (b.procedures ?? []).length) {
    sec(t("العمليات والإجراءات", "Procedures & surgeries"));
    for (const x of b.procedures ?? []) { blocks.push({ t: "p", text: `${d(x.performed_on)} — ${s(x.name)} (${lbl(PROCEDURE_KIND, s(x.kind), lang)}${x.body_site ? `, ${s(x.body_site)}` : ""})` }); kvs([[t("المنفّذ", "Operator"), s(x.operator_name)], [t("الدافع", "Indication"), s(x.indication)], [t("النتيجة", "Outcome"), s(x.outcome)], [t("المضاعفات", "Complications"), s(x.complications)], [t("ملاحظات", "Notes"), s(x.notes)]]); }
  }
  if (inc.has("imaging") && (b.imaging ?? []).length) {
    sec(t("الأشعة والتصوير", "Imaging"));
    for (const x of b.imaging ?? []) { blocks.push({ t: "p", text: `${d(x.performed_on)} — ${lbl(IMAGING_MODALITY, s(x.modality), lang)} ${s(x.body_site)}` }); kvs([[t("الموجودات", "Findings"), s(x.findings)], [t("الخلاصة", "Impression"), s(x.impression)]]); }
  }
  if (inc.has("specialty_records") && (b.specialty_records ?? []).length) {
    sec(t("سجلات التخصص", "Specialty records"));
    for (const x of b.specialty_records ?? []) {
      const fields = (x.fields ?? []) as { key: string; label_ar: string; label_en: string; unit?: string; options?: { value: string; label_ar: string; label_en: string }[] }[];
      const data = (x.data ?? {}) as R;
      blocks.push({ t: "p", text: `${d(x.occurred_on)} — ${s(lang === "ar" ? x.record_type_name_ar : x.record_type_name_en)} [${spec(x.specialty_id)}]` });
      kvs(fields.map((f): [string, string] => { const v = data[f.key]; const opt = f.options?.find((q) => q.value === v); return [lang === "ar" ? f.label_ar : f.label_en, v == null ? "" : `${opt ? (lang === "ar" ? opt.label_ar : opt.label_en) : s(v)}${f.unit ? " " + f.unit : ""}`]; }));
      if (x.notes) blocks.push({ t: "p", muted: true, text: s(x.notes) });
    }
  }
  if (inc.has("care_plans") && (b.care_plans ?? []).length) {
    sec(t("خطط العلاج والمتابعة", "Care plans"));
    for (const x of b.care_plans ?? []) { blocks.push({ t: "p", text: `${s(x.title)} (${lbl(CARE_PLAN_STATUS, s(x.status), lang)})` }); kvs([[t("الأهداف", "Goals"), s(x.goals)], [t("التعليمات", "Instructions"), s(x.instructions)]]); }
  }
  if (inc.has("notes") && (b.notes ?? []).length) {
    sec(t("الملاحظات السريرية", "Clinical notes"));
    for (const x of b.notes ?? []) { blocks.push({ t: "p", text: `${dt(x.noted_at)} — ${s(x.title)}${x.author_name ? ` · ${s(x.author_name)}` : ""}` }); blocks.push({ t: "p", muted: true, text: s(x.body) }); }
  }
  if (inc.has("immunizations") && (b.immunizations ?? []).length) {
    sec(t("التطعيمات", "Immunizations"));
    blocks.push({ t: "table", cols: [{ label: t("اللقاح", "Vaccine"), w: 5 }, { label: t("الحالة", "Status"), w: 2 }, { label: t("التاريخ", "Date"), w: 2 }], rows: (b.immunizations ?? []).map((x) => [{ text: `${s(x.vaccine_name)}${x.dose_number ? ` #${s(x.dose_number)}` : ""}`, bold: true }, lbl(IMMUNIZATION_STATUS, s(x.status), lang), d(x.administered_on)]) });
  }
  if (inc.has("family_history") && (b.family_history ?? []).length) {
    sec(t("التاريخ العائلي", "Family history"));
    blocks.push({ t: "table", cols: [{ label: t("القريب", "Relative"), w: 3 }, { label: t("الحالة", "Condition"), w: 5 }, { label: t("عمر البداية", "Onset age"), w: 2 }], rows: (b.family_history ?? []).map((x) => [lbl(FAMILY_RELATION, s(x.relation), lang), { text: s(x.condition_name), bold: true }, s(x.age_at_onset)]) });
  }
  if (inc.has("documents") && (b.documents ?? []).length) {
    sec(t("المستندات المرفقة (قائمة فقط)", "Attached documents (list only)"));
    blocks.push({ t: "table", cols: [{ label: t("العنوان", "Title"), w: 6 }, { label: t("التاريخ", "Date"), w: 2 }], rows: (b.documents ?? []).map((x) => [{ text: s(x.title), bold: true }, d(x.document_date)]) });
  }

  const p = b.patient;
  return {
    meta: {
      lang, title: t("ملف طبي مشارك", "Shared medical file"), subtitle: b.meta.title, brand: t("بوابة شفاء", "Shifa Portal"),
      headline: { name: lang === "en" && p.full_name_en ? p.full_name_en : p.full_name, lines: identityLines(lang, tz, { mrn: p.mrn, date_of_birth: p.date_of_birth, sex: p.sex, nationality: p.nationality, blood: p.blood_group, verified: p.blood_group_verified, phone: p.phone ?? null }) },
      generatedAt: `${t("أُنشئ في", "Generated")} ${dt(b.meta.generated_at)} · ${t("تنتهي المشاركة", "share expires")} ${dt(b.meta.expires_at)}`,
      footerNote: t("هذا عرض لمعلومات سجّلها المريض أو مقدمو الرعاية؛ قد لا يكون كاملاً. القرار السريري لك. ", "A view of information recorded by the patient or care providers; it may be incomplete. Clinical judgement is yours. ") + SAFETY_NOTE(lang),
    },
    blocks, filename: `${p.mrn}-shared.pdf`,
  };
}
