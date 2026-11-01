import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ageLabel, fmtDate, fmtDateTime, fmtPartialDate } from "@/lib/format";
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
import { bodyMetrics, contextPackYears, matchHighlights, type ClinicalContextData } from "@/lib/clinical-context";
import { ALCOHOL_STATUS, DEVICE_KIND, PREGNANCY_STATUS, TOBACCO_STATUS, TOBACCO_TYPE } from "@/lib/labels";
import { calOf, comparePerio, siteName, summarize, toothHasData, type PerioExam, type PerioTooth } from "@/lib/perio";
import { DX_EXTENTS, DX_KINDS, dxIsSet, dxLine } from "@/lib/perio-staging";
import { ITEM_STATUS, PLAN_STATUS, byPhase, costTotals, fmtMoney, planProgress, type TreatmentCost, type TreatmentPlan } from "@/lib/treatment";

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

/** The core context (body, blood, devices, lifestyle, pregnancy) and the specialty reminders, as report blocks. */
function contextBlocks(ctx: ClinicalContextData, lang: Lang, codes: string[] | "all" | null): Block[] {
  const t = tx(lang);
  const out: Block[] = [];
  for (const h of codes ? matchHighlights(ctx, codes) : []) {
    out.push({ t: "alert", tone: h.level === "info" ? "info" : h.level, text: `${lang === "ar" ? h.message_ar : h.message_en} (${t("بسبب", "because of")}: ${h.because.join(lang === "ar" ? "، " : ", ")})` });
  }
  const { cm, kg, bmi } = bodyMetrics(ctx.body);
  const l = ctx.lifestyle;
  const py = contextPackYears(l);
  const rows: [string, string][] = [
    [t("فصيلة الدم", "Blood group"), ctx.patient.blood_abo ? `${ctx.patient.blood_abo}${ctx.patient.blood_rh ?? ""}${ctx.patient.blood_group_verified ? "" : ` (${t("غير موثقة", "unverified")})`}` : t("غير مسجلة", "Not recorded")],
    [t("الطول / الوزن / BMI", "Height / weight / BMI"), [cm ? `${Math.round(cm)} cm` : "—", kg ? `${kg.toFixed(1)} kg` : "—", bmi ? bmi.toFixed(1) : "—"].join("  ·  ")],
    [t("التدخين", "Tobacco"), !l || l.tobacco_status === "unknown" ? t("غير محدد", "Not stated") : [lbl(TOBACCO_STATUS, l.tobacco_status, lang),
      l.tobacco_types.map((x) => lbl(TOBACCO_TYPE, x, lang)).join(lang === "ar" ? "، " : ", "), py ? t(`${py.toFixed(1)} علبة-سنة`, `${py.toFixed(1)} pack-years`) : ""].filter(Boolean).join(" · ")],
  ];
  if (l?.alcohol_status && l.alcohol_status !== "unknown") rows.push([t("الكحول", "Alcohol"), lbl(ALCOHOL_STATUS, l.alcohol_status, lang)]);
  if (ctx.patient.sex !== "male" && l?.pregnancy_status && l.pregnancy_status !== "unknown") {
    rows.push([t("الحمل", "Pregnancy"), `${lbl(PREGNANCY_STATUS, l.pregnancy_status, lang)}${l.pregnancy_edd ? ` · ${l.pregnancy_edd}` : ""}${l.breastfeeding ? ` · ${t("ترضع", "breastfeeding")}` : ""}`]);
  }
  rows.push([t("الأجهزة والزرعات", "Devices & implants"), ctx.devices.length ? ctx.devices.map((d) => `${lbl(DEVICE_KIND, d.kind, lang)}${d.name ? ` — ${d.name}` : ""}`).join(lang === "ar" ? "، " : ", ")
    : l?.none_devices ? t("لا يوجد (إقرار مسجل)", "None (recorded statement)") : t("غير مسجل", "Not recorded")]);
  out.push({ t: "kv", rows });
  return out;
}

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
  ctx?: ClinicalContextData;
}): Promise<{ meta: ReportMeta; blocks: Block[]; filename: string }> {
  const { lang, tz } = o;
  const t = tx(lang);
  const d = (v: unknown, prec?: unknown) => (prec ? fmtPartialDate(s(v), prec, lang, tz) : fmtDate(s(v), lang, tz));
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
    wantSummary ? supabase.from("conditions").select("name, category, certainty, clinical_status, onset_date, date_precision").eq("patient_id", p.id).eq("record_status", "active").order("onset_date", { ascending: false, nullsFirst: false }).limit(60) : { data: [] },
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
    if (o.ctx) blocks.push(...contextBlocks(o.ctx, lang, null));
    if (al.length) blocks.push({ t: "alert", tone: "bad", title: t("حساسية موثقة", "Documented allergies"), text: al.map((a) => `${s(a.substance)} — ${lbl(ALLERGY_SEVERITY, s(a.severity), lang)}${a.reaction ? ` (${s(a.reaction)})` : ""}`).join(lang === "ar" ? "،  " : ",  ") });
    else if (p.allergy_assertion === "none_known") blocks.push({ t: "alert", tone: "ok", text: t("لا توجد حساسية معروفة (إقرار مسجل).", "No known allergies (recorded statement).") });
    else blocks.push({ t: "alert", tone: "warn", title: t("حالة الحساسية غير معروفة", "Allergy status unknown"), text: t("لم تُسجَّل بعد؛ لا يعني ذلك غياب الحساسية.", "not recorded yet; this does not mean there are none.") });
    void ALLERGY_ASSERTION;

    const cs = (conditions.data ?? []) as R[];
    blocks.push({ t: "h", text: t("الأمراض والتشخيصات", "Conditions") });
    blocks.push(cs.length ? { t: "table", cols: [{ label: t("الحالة", "Condition"), w: 4 }, { label: t("التصنيف", "Category"), w: 2 }, { label: t("اليقين", "Certainty"), w: 2 }, { label: t("الوضع", "Status"), w: 2 }, { label: t("البداية", "Onset"), w: 2 }],
      rows: cs.map((c) => [{ text: s(c.name), bold: true }, lbl(CONDITION_CATEGORY, s(c.category), lang), lbl(CERTAINTY, s(c.certainty), lang), lbl(CLINICAL_STATUS, s(c.clinical_status), lang), d(c.onset_date, c.date_precision)]) }
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
export function buildShareReport(b: Bundle, o: { lang: Lang; tz: string; ctx?: (ClinicalContextData & { specialties: string[] | null }) | null }): { meta: ReportMeta; blocks: Block[]; filename: string } {
  const { lang, tz } = o;
  const t = tx(lang);
  const d = (v: unknown, prec?: unknown) => (prec ? fmtPartialDate(s(v), prec, lang, tz) : fmtDate(s(v), lang, tz));
  const dt = (v: unknown) => fmtDateTime(s(v), lang, tz);
  const inc = new Set(b.meta.include);
  const spec = (id: unknown) => { const x = b.specialties.find((y) => y.id === id); return x ? (lang === "ar" ? x.name_ar : x.name_en) : ""; };
  const blocks: Block[] = [];
  const sec = (title: string) => blocks.push({ t: "h", text: title });
  const kvs = (rows: [string, string][]) => blocks.push({ t: "kv", rows });

  blocks.push({ t: "p", text: `${t("الغرض", "Purpose")}: ${b.meta.title}${b.meta.recipient_label ? ` — ${b.meta.recipient_label}` : ""}` });
  blocks.push({ t: "p", muted: true, text: `${t("النطاق", "Scope")}: ${b.meta.scope_kind === "specialty" ? b.meta.specialties.map((x) => (lang === "ar" ? x.name_ar : x.name_en)).join(lang === "ar" ? "، " : ", ") : b.meta.scope_kind === "full" ? t("الملف الكامل", "Whole file") : t("سجلات مختارة", "Selected records")}${b.meta.date_from || b.meta.date_to ? ` · ${b.meta.date_from ?? "…"} – ${b.meta.date_to ?? "…"}` : ""} · ${t("يتضمن", "includes")}: ${b.meta.include.map((m) => (SHARE_MODULES.find((x: Opt) => x.value === m) as Opt | undefined)?.[lang]).filter(Boolean).join(lang === "ar" ? "، " : ", ") || t("الأساسيات فقط", "essentials only")}` });

  sec(t("معلومات السلامة", "Safety information"));
  if (o.ctx) blocks.push(...contextBlocks(o.ctx, lang, o.ctx.specialties ?? "all"));
  if (b.allergies.length) blocks.push({ t: "alert", tone: "bad", title: t("حساسية موثقة", "Documented allergies"), text: b.allergies.map((a) => `${s(a.substance)} — ${lbl(ALLERGY_SEVERITY, s(a.severity), lang)}${a.reaction ? ` (${s(a.reaction)})` : ""}`).join(lang === "ar" ? "،  " : ",  ") });
  else if (b.allergy_assertion === "none_known") blocks.push({ t: "alert", tone: "ok", text: t("لا توجد حساسية معروفة (إقرار المريض).", "No known allergies (patient’s statement).") });
  else blocks.push({ t: "alert", tone: "warn", title: t("حالة الحساسية غير معروفة", "Allergy status unknown"), text: t("لم يُسجَّل شيء؛ لا يعني ذلك غياب الحساسية.", "nothing recorded; this does not mean none exist.") });
  blocks.push({ t: "h", text: t("الأمراض المزمنة والعيوب الخلقية", "Chronic & congenital conditions") });
  blocks.push(b.chronic_conditions.length ? { t: "table", cols: [{ label: t("الحالة", "Condition"), w: 4 }, { label: t("اليقين", "Certainty"), w: 2 }, { label: t("الوضع", "Status"), w: 2 }, { label: t("البداية", "Onset"), w: 2 }],
    rows: b.chronic_conditions.map((c) => [{ text: s(c.name), bold: true }, lbl(CERTAINTY, s(c.certainty), lang), lbl(CLINICAL_STATUS, s(c.clinical_status), lang), d(c.onset_date, c.date_precision)]) } : { t: "p", muted: true, text: t("لا شيء مسجل (لا يعني عدم وجود).", "None recorded (not proof of none).") });
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
      rows: (b.other_conditions ?? []).map((c) => [{ text: s(c.name), bold: true }, lbl(CERTAINTY, s(c.certainty), lang), lbl(CLINICAL_STATUS, s(c.clinical_status), lang), spec(c.specialty_id), d(c.onset_date, c.date_precision)]) });
  }
  if (inc.has("procedures") && (b.procedures ?? []).length) {
    sec(t("العمليات والإجراءات", "Procedures & surgeries"));
    for (const x of b.procedures ?? []) { blocks.push({ t: "p", text: `${d(x.performed_on, x.date_precision)} — ${s(x.name)} (${lbl(PROCEDURE_KIND, s(x.kind), lang)}${x.body_site ? `, ${s(x.body_site)}` : ""})` }); kvs([[t("المنفّذ", "Operator"), s(x.operator_name)], [t("الدافع", "Indication"), s(x.indication)], [t("النتيجة", "Outcome"), s(x.outcome)], [t("المضاعفات", "Complications"), s(x.complications)], [t("ملاحظات", "Notes"), s(x.notes)]]); }
  }
  if (inc.has("imaging") && (b.imaging ?? []).length) {
    sec(t("الأشعة والتصوير", "Imaging"));
    for (const x of b.imaging ?? []) { blocks.push({ t: "p", text: `${d(x.performed_on, x.date_precision)} — ${lbl(IMAGING_MODALITY, s(x.modality), lang)} ${s(x.body_site)}` }); kvs([[t("الموجودات", "Findings"), s(x.findings)], [t("الخلاصة", "Impression"), s(x.impression)]]); }
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
    blocks.push({ t: "table", cols: [{ label: t("اللقاح", "Vaccine"), w: 5 }, { label: t("الحالة", "Status"), w: 2 }, { label: t("التاريخ", "Date"), w: 2 }], rows: (b.immunizations ?? []).map((x) => [{ text: `${s(x.vaccine_name)}${x.dose_number ? ` #${s(x.dose_number)}` : ""}`, bold: true }, lbl(IMMUNIZATION_STATUS, s(x.status), lang), d(x.administered_on, x.date_precision)]) });
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

// ------------------------------------------------------------------------------------------------ a treatment plan, with consent
export function buildTreatmentPlanReport(p: PatientRow, plan: TreatmentPlan, o: {
  lang: Lang; tz: string; ctx?: ClinicalContextData; problems: { id: string; name: string }[]; costs?: TreatmentCost[] | null;
}): { meta: ReportMeta; blocks: Block[]; filename: string } {
  const { lang, tz } = o;
  const t = tx(lang);
  const day = (v: string | null) => (v ? fmtDate(v, lang, tz) : "");
  const blocks: Block[] = [];
  if (o.ctx) {
    blocks.push({ t: "h", text: t("معلومات السلامة قبل العلاج", "Safety information before treatment") });
    blocks.push(...contextBlocks(o.ctx, lang, ["dentistry"]));
  }
  blocks.push({ t: "h", text: t("الخطة", "The plan") });
  blocks.push({ t: "kv", rows: ([
    [t("العنوان", "Title"), plan.title],
    [t("الحالة", "Status"), lbl(PLAN_STATUS, plan.status, lang)],
    [t("النسخة", "Version"), String(plan.version)],
    [t("اقترحها", "Proposed by"), s(plan.presented_by)],
    [t("تاريخ الاقتراح", "Proposed on"), day(plan.presented_on)],
    [t("تاريخ الاعتماد", "Accepted on"), day(plan.accepted_on)],
    [t("ملاحظات", "Notes"), s(plan.notes)],
  ] as [string, string][]).filter(([, v]) => v) });
  const { byItem, totals } = costTotals(plan.items, o.costs ?? []);
  const prog = planProgress(plan.items);
  blocks.push({ t: "p", muted: true, text: t(`التقدم: منجز ${prog.done} من ${prog.total} (${prog.pct}%).`, `Progress: ${prog.done} of ${prog.total} done (${prog.pct}%).`) });
  const withCost = Boolean(o.costs);
  for (const [phase, list] of byPhase(plan.items)) {
    blocks.push({ t: "h", text: t(`المرحلة ${phase}`, `Phase ${phase}`) });
    blocks.push({ t: "table", cols: [
      { label: t("السن", "Tooth"), w: 2 }, { label: t("العلاج", "Treatment"), w: 4 }, { label: t("يعالج", "Treats"), w: 3 }, { label: t("الحالة", "Status"), w: 2 },
      ...(withCost ? [{ label: t("التكلفة", "Cost"), w: 2, align: "end" as const }] : []),
    ], rows: list.map((i): Cell[] => {
      const c = byItem.get(i.id);
      return [
        (i.teeth ?? []).join(", ") + (i.surfaces?.length && i.teeth?.length === 1 ? ` ${i.surfaces.join("")}` : ""),
        { text: i.name + (i.surgical ? t(" (جراحي)", " (surgical)") : ""), bold: true },
        o.problems.find((x) => x.id === i.condition_id)?.name ?? "",
        { text: lbl(ITEM_STATUS, i.status, lang) + (i.scheduled_for && i.status === "scheduled" ? ` ${day(i.scheduled_for)}` : i.completed_on ? ` ${day(i.completed_on)}` : ""),
          tone: i.status === "completed" ? "ok" : i.status === "cancelled" ? "muted" : "info" },
        ...(withCost ? [c ? fmtMoney(c.amount, c.currency, lang) : ""] : []),
      ];
    }) });
  }
  if (withCost && totals.length) {
    blocks.push({ t: "p", text: `${t("المجموع", "Total")}: ${totals.map((x) => fmtMoney(x.amount, x.currency, lang)).join("  ·  ")} — ${t("لكل عملة على حدة؛ تقديرات ما لم يُذكر غير ذلك.", "per currency; estimates unless stated otherwise.")}` });
  }

  // consent: what the patient confirms, and the lines to sign
  const surgical = plan.items.filter((i) => i.surgical && i.status !== "cancelled");
  blocks.push({ t: "h", text: t("الموافقة على العلاج", "Consent to treatment") });
  blocks.push({ t: "p", text: t(
    "شُرحت لي خطة العلاج أعلاه، بما فيها طبيعة كل علاج وفائدته المتوقعة ومخاطره الشائعة والبدائل المتاحة (ومنها عدم العلاج)، وأُتيحت لي فرصة السؤال. أوافق على العلاجات المذكورة، وأعلم أنني أستطيع سحب موافقتي قبل أي علاج.",
    "The treatment plan above was explained to me, including the nature of each treatment, its expected benefit, its common risks and the alternatives (including no treatment), and I could ask questions. I agree to the treatments listed and know I may withdraw my consent before any treatment.") });
  if (surgical.length) blocks.push({ t: "alert", tone: "warn", title: t("علاجات جراحية", "Surgical treatments"), text: t(
    `تتضمن الخطة علاجاً جراحياً (${surgical.map((i) => i.name).join("، ")}). أؤكد أنه شُرح لي على حدة وأوافق عليه صراحة.`,
    `The plan includes surgical treatment (${surgical.map((i) => i.name).join(", ")}). I confirm it was explained to me separately and I explicitly agree to it.`) });
  const line = "____________________";
  blocks.push({ t: "table", cols: [{ label: "", w: 3 }, { label: t("الاسم", "Name"), w: 4 }, { label: t("التوقيع", "Signature"), w: 4 }, { label: t("التاريخ", "Date"), w: 3 }], rows: [
    [{ text: t("المريض أو وليّه", "Patient or guardian"), bold: true }, line, line, line],
    [{ text: t("طبيب الأسنان", "Dentist"), bold: true }, s(plan.presented_by) || line, line, line],
    [{ text: t("شاهد (اختياري)", "Witness (optional)"), bold: true }, line, line, line],
  ] });
  const name = lang === "en" && p.full_name_en ? p.full_name_en : p.full_name;
  return {
    meta: {
      lang, title: t("خطة علاج الأسنان", "Dental treatment plan"), subtitle: plan.title, brand: t("بوابة شفاء", "Shifa Portal"),
      headline: { name, lines: identityLines(lang, tz, { mrn: p.mrn, date_of_birth: p.date_of_birth, sex: p.sex, nationality: p.nationality, blood: p.blood_abo ? `${p.blood_abo}${p.blood_rh ?? ""}` : null, verified: p.blood_group_verified, phone: p.phone }) },
      generatedAt: `${t("أُنشئ في", "Generated")} ${fmtDateTime(new Date(), lang, tz)}`, footerNote: SAFETY_NOTE(lang),
    },
    blocks, filename: `${p.mrn}-treatment-plan-v${plan.version}.pdf`,
  };
}

/** The periodontal chart: the figures, then each tooth's six sites (in the stored order: distal → mesial on each side), and the change since the chart before. */
export function buildPerioReport(p: PatientRow, exam: PerioExam, o: { lang: Lang; tz: string; previous?: PerioExam | null }): { meta: ReportMeta; blocks: Block[]; filename: string } {
  const { lang, tz } = o;
  const t = tx(lang);
  const day = (v: string | null | undefined) => (v ? fmtPartialDate(v, "day", lang) : "");
  const blocks: Block[] = [];
  const sm = summarize(exam.teeth);
  blocks.push({ t: "kv", rows: ([
    [t("تاريخ الفحص", "Exam date"), day(exam.exam_date)],
    [t("الحالة", "Status"), exam.status === "final" ? t("معتمد", "Final") : t("مسودة", "Draft")],
    [t("الفاحص", "Examiner"), s(exam.examiner_name)],
    [t("المنشأة", "Facility"), s(exam.facility_name)],
    [t("سُجّل عبر رابط بواسطة", "Recorded through a link by"), exam.contributed_by ? s(exam.source_detail ?? exam.examiner_name) : ""],
    [t("ملاحظات", "Notes"), s(exam.notes)],
  ] as [string, string][]).filter(([, v]) => v) });
  if (dxIsSet(exam)) {
    blocks.push({ t: "h", text: t("التشخيص اللثوي (تصنيف 2017 — AAP/EFP)", "Periodontal diagnosis (2017 AAP/EFP)") });
    blocks.push({ t: "kv", rows: ([
      [t("التشخيص", "Diagnosis"), exam.dx_kind ? s(DX_KINDS.find((k) => k.value === exam.dx_kind)?.[lang]) : ""],
      [t("المرحلة", "Stage"), s(exam.dx_stage)],
      [t("الدرجة", "Grade"), s(exam.dx_grade)],
      [t("الامتداد", "Extent"), exam.dx_extent ? s(DX_EXTENTS.find((x) => x.value === exam.dx_extent)?.[lang]) : ""],
      [t("فقد العظم الشعاعي في أسوأ موقع", "Radiographic bone loss at the worst site"), exam.dx_rbl_pct == null ? "" : `${exam.dx_rbl_pct}%`],
      [t("أسنان فُقدت بسبب اللثة", "Teeth lost to periodontitis"), exam.dx_teeth_lost_perio == null ? "" : String(exam.dx_teeth_lost_perio)],
      [t("ملاحظة", "Note"), s(exam.dx_note)],
    ] as [string, string][]).filter(([, v]) => v) });
    if (dxLine(exam, lang)) blocks.push({ t: "p", text: dxLine(exam, lang) });
  }
  blocks.push({ t: "h", text: t("الملخص", "Summary") });
  const mm = t("مم", "mm");
  blocks.push({ t: "table", cols: [{ label: t("المؤشر", "Measure"), w: 5 }, { label: t("القيمة", "Value"), w: 3, align: "end" }], rows: ([
    [t("الأسنان المفحوصة / المفقودة", "Teeth charted / missing"), `${sm.teeth} / ${sm.missing}`],
    [t("المواقع المسبورة", "Sites probed"), String(sm.sites)],
    [t("النزف عند السبر", "Bleeding on probing"), sm.bopPct === null ? "—" : `${sm.bopPct}% (${sm.bop})`],
    [t("البلاك", "Plaque"), sm.plaquePct === null ? "—" : `${sm.plaquePct}% (${sm.plaque})`],
    [t("القيح", "Suppuration"), String(sm.suppuration)],
    [t("جيوب بعمق 4 مم فأكثر", "Pockets of 4 mm or more"), String(sm.pd4)],
    [t("جيوب بعمق 6 مم فأكثر", "Pockets of 6 mm or more"), String(sm.pd6)],
    [t("متوسط العمق", "Mean depth"), sm.meanPd === null ? "—" : `${sm.meanPd} ${mm}`],
    [t("متوسط الارتباط", "Mean CAL"), sm.meanCal === null ? "—" : `${sm.meanCal} ${mm}`],
    [t("أقصى فقد ارتباط", "Max CAL"), sm.maxCal === null ? "—" : `${sm.maxCal} ${mm}`],
    [t("أسنان متحركة", "Mobile teeth"), String(sm.mobile)],
    [t("أسنان بانقسام جذور", "Teeth with furcation involvement"), String(sm.furcations)],
  ] as [string, string][]).map(([a, b]): Cell[] => [a, b]) });
  blocks.push({ t: "p", muted: true, text: t(
    "حافة اللثة: موجب = فوق ملتقى المينا بالملاط (تضخم)، صفر = عنده، سالب = انحسار. الارتباط السريري = العمق ناقص الحافة. ترتيب المواقع في كل جهة: وحشي ثم وسط ثم أنسي.",
    "Gingival margin: positive = coronal to the CEJ (overgrowth), 0 = at it, negative = recession. CAL = depth minus margin. Sites on each side: distal, mid, mesial.") });

  const by = new Map(exam.teeth.map((x) => [x.tooth, x]));
  const trio = (a: (number | boolean | null)[] | null | undefined, from: number) => (a ? [0, 1, 2].map((k) => {
    const v = a[from + k];
    return v === null || v === undefined || v === false ? "·" : v === true ? "+" : String(v);
  }).join(" ") : "");
  const deep = (a: (number | null)[] | null | undefined, from: number) => (a ? a.slice(from, from + 3).some((v) => (v ?? 0) >= 6) ? "bad" : a.slice(from, from + 3).some((v) => (v ?? 0) >= 4) ? "warn" : undefined : undefined);
  const quads: [string, number[]][] = [
    [t("الربع العلوي الأيمن (1)", "Upper right (1)"), [11, 12, 13, 14, 15, 16, 17, 18]], [t("الربع العلوي الأيسر (2)", "Upper left (2)"), [21, 22, 23, 24, 25, 26, 27, 28]],
    [t("الربع السفلي الأيسر (3)", "Lower left (3)"), [31, 32, 33, 34, 35, 36, 37, 38]], [t("الربع السفلي الأيمن (4)", "Lower right (4)"), [41, 42, 43, 44, 45, 46, 47, 48]],
  ];
  for (const [title, list] of quads) {
    const rows = list.map((n) => by.get(n)).filter((x): x is PerioTooth => !!x && toothHasData(x));
    if (!rows.length) continue;
    blocks.push({ t: "h", text: title });
    blocks.push({ t: "table", cols: [
      { label: t("السن", "Tooth"), w: 1.4 }, { label: t("حركة", "Mob"), w: 1.1 }, { label: t("انقسام", "Furc"), w: 1.6 },
      { label: t("دهليزي عمق", "B depth"), w: 2.2 }, { label: t("حافة", "Margin"), w: 2.2 }, { label: "CAL", w: 2.2 }, { label: t("نزف", "BOP"), w: 1.8 },
      { label: t("لساني عمق", "L depth"), w: 2.2 }, { label: t("حافة", "Margin"), w: 2.2 }, { label: "CAL", w: 2.2 }, { label: t("نزف", "BOP"), w: 1.8 },
    ], rows: rows.map((x): Cell[] => {
      if (x.missing) return [{ text: String(x.tooth), bold: true }, { text: t("مفقود", "missing"), tone: "muted" }, "", "", "", "", "", "", "", "", ""];
      const cal = calOf(x);
      const furc = (["b", "l", "m", "d"] as const).map((f) => (x[`furcation_${f}`] ? `${f.toUpperCase()}${x[`furcation_${f}`]}` : "")).filter(Boolean).join(" ");
      return [
        { text: `${x.tooth}${x.implant ? "*" : ""}`, bold: true }, x.mobility ? String(x.mobility) : "", furc,
        { text: trio(x.pd, 0), tone: deep(x.pd, 0) }, trio(x.gm, 0), trio(cal, 0), trio(x.bop, 0),
        { text: trio(x.pd, 3), tone: deep(x.pd, 3) }, trio(x.gm, 3), trio(cal, 3), trio(x.bop, 3),
      ];
    }) });
  }
  blocks.push({ t: "p", muted: true, text: t("في أعمدة النزف: + = نزف عند السبر، · = لا نزف أو لم يُسجَّل.", "In the BOP columns: + = bleeding on probing, · = none or not recorded.")
    + (exam.teeth.some((x) => x.implant) ? t(" * = زرعة.", " * = implant.") : "") });

  if (o.previous) {
    const c = comparePerio(o.previous.teeth, exam.teeth);
    blocks.push({ t: "h", text: t(`التغيّر منذ ${day(o.previous.exam_date)}`, `Change since ${day(o.previous.exam_date)}`) });
    blocks.push({ t: "p", text: t(
      `مواقع فقدت ارتباطاً 2 مم فأكثر: ${c.worse.length}. مواقع قلّ عمقها 2 مم فأكثر: ${c.better.length}.${c.lostTeeth.length ? ` أسنان فُقدت: ${c.lostTeeth.join("، ")}.` : ""} النزف: كان ${c.before.bopPct ?? "—"}% وصار ${c.after.bopPct ?? "—"}%.`,
      `Sites with 2 mm or more attachment loss: ${c.worse.length}. Sites 2 mm or more shallower: ${c.better.length}.${c.lostTeeth.length ? ` Teeth lost: ${c.lostTeeth.join(", ")}.` : ""} Bleeding: ${c.before.bopPct ?? "—"}% then ${c.after.bopPct ?? "—"}%.`) });
    if (c.worse.length) {
      blocks.push({ t: "table", cols: [{ label: t("السن", "Tooth"), w: 1.5 }, { label: t("الموقع", "Site"), w: 4 }, { label: t("العمق", "Depth"), w: 2.5 }, { label: "CAL", w: 2.5 }], rows:
        c.worse.map((w): Cell[] => [{ text: String(w.tooth), bold: true }, siteName(w.site, w.tooth, lang), `${w.pdBefore} > ${w.pdAfter}`, { text: `${w.calBefore} > ${w.calAfter} (+${w.dCal})`, tone: "bad" }]) });
    }
  }
  const name = lang === "en" && p.full_name_en ? p.full_name_en : p.full_name;
  return {
    meta: {
      lang, title: t("مخطط اللثة", "Periodontal chart"), subtitle: day(exam.exam_date), brand: t("بوابة شفاء", "Shifa Portal"),
      headline: { name, lines: identityLines(lang, tz, { mrn: p.mrn, date_of_birth: p.date_of_birth, sex: p.sex, nationality: p.nationality, blood: p.blood_abo ? `${p.blood_abo}${p.blood_rh ?? ""}` : null, verified: p.blood_group_verified, phone: p.phone }) },
      generatedAt: `${t("أُنشئ في", "Generated")} ${fmtDateTime(new Date(), lang, tz)}`, footerNote: SAFETY_NOTE(lang),
    },
    blocks, filename: `${p.mrn}-perio-${exam.exam_date}.pdf`,
  };
}
