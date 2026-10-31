import { Calculator } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getObsTypes, getPatient } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtDate, fmtNum } from "@/lib/format";
import { ageAt, bmi, bmiClass, egfrCkdEpi2021, gfrCategory, homaIr, toDefaultUnit, type BmiClass } from "@/lib/clinical/derived";
import type { ObservationRow, ObservationType } from "@/lib/types";
import { Card, Chip } from "@/components/ui";

const CODES = ["weight", "height", "creatinine", "glucose_fasting_lab", "insulin"];

export const BMI_LABEL: Record<BmiClass, [string, string, "ok" | "warn" | "bad" | "muted"]> = {
  underweight: ["نقص وزن", "Underweight", "warn"], normal: ["وزن طبيعي", "Normal weight", "ok"], overweight: ["وزن زائد", "Overweight", "warn"],
  obese1: ["سمنة درجة 1", "Obesity class I", "bad"], obese2: ["سمنة درجة 2", "Obesity class II", "bad"], obese3: ["سمنة درجة 3", "Obesity class III", "bad"],
};

/**
 * Values computed from recorded results (never stored, so they follow corrections): BMI, eGFR and HOMA-IR.
 * Adults only; each line shows the inputs it was computed from.
 */
export async function DerivedCard({ pid, compact = false }: { pid: string; compact?: boolean }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const [p, types] = await Promise.all([getPatient(pid), getObsTypes()]);
  const byCode = new Map(types.filter((x) => CODES.includes(x.code)).map((x) => [x.code, x]));
  const ids = Array.from(byCode.values()).map((x) => x.id);
  if (!ids.length) return null;
  const { data } = await createClient().from("observations").select("*").eq("patient_id", pid).in("type_id", ids)
    .in("status", ["final", "preliminary"]).order("effective_at", { ascending: false }).limit(500);
  const rows = (data ?? []) as ObservationRow[];
  const of = (code: string) => { const ty = byCode.get(code); return ty ? rows.filter((o) => o.type_id === ty.id && o.value_num != null) : []; };
  const inDefault = (o: ObservationRow, ty: ObservationType | undefined) => (ty ? toDefaultUnit(Number(o.value_num), o.unit, ty.default_unit, ty.unit_conversions) : null);

  const lines: { key: string; name: string; value: string; chip?: [string, "ok" | "warn" | "bad" | "muted"]; from: string; when: string }[] = [];

  // BMI: latest adult weight with the latest height
  const w = of("weight")[0], h = of("height")[0];
  if (w && h && ageAt(p.date_of_birth, w.effective_at) >= 18) {
    const kg = inDefault(w, byCode.get("weight")), cm = inDefault(h, byCode.get("height"));
    const v = bmi(kg, cm);
    if (v != null) {
      const c = BMI_LABEL[bmiClass(v)];
      lines.push({ key: "bmi", name: t("مؤشر كتلة الجسم BMI", "Body-mass index (BMI)"), value: `${fmtNum(v, 1)} kg/m²`, chip: [lang === "ar" ? c[0] : c[1], c[2]],
        from: t(`الوزن ${fmtNum(kg, 1)} كغ والطول ${fmtNum(cm, 0)} سم`, `weight ${fmtNum(kg, 1)} kg, height ${fmtNum(cm, 0)} cm`), when: fmtDate(w.effective_at, lang, tz) });
    }
  }

  // eGFR for each creatinine result (most recent first)
  const egfrOk = p.sex === "male" || p.sex === "female";
  for (const o of of("creatinine").slice(0, compact ? 1 : 6)) {
    const age = ageAt(p.date_of_birth, o.effective_at);
    const mg = inDefault(o, byCode.get("creatinine"));
    const v = egfrOk && age >= 18 ? egfrCkdEpi2021(mg, age, p.sex) : null;
    if (v == null) continue;
    lines.push({ key: `egfr-${o.id}`, name: "eGFR (CKD-EPI 2021)", value: `${fmtNum(v, 0)} mL/min/1.73m²`, chip: [gfrCategory(v), v >= 60 ? "ok" : v >= 30 ? "warn" : "bad"],
      from: t(`الكرياتينين ${fmtNum(mg, 2)} mg/dL، العمر ${age}`, `creatinine ${fmtNum(mg, 2)} mg/dL, age ${age}`), when: fmtDate(o.effective_at, lang, tz) });
  }

  // HOMA-IR when a fasting glucose and an insulin were taken together (same report, or within two hours)
  const ins = of("insulin");
  for (const g of of("glucose_fasting_lab").slice(0, compact ? 1 : 4)) {
    const pair = ins.find((i) => (g.report_id && i.report_id === g.report_id) || Math.abs(Date.parse(i.effective_at) - Date.parse(g.effective_at)) <= 2 * 3_600_000);
    if (!pair) continue;
    const gl = inDefault(g, byCode.get("glucose_fasting_lab")), iv = inDefault(pair, byCode.get("insulin"));
    const v = homaIr(gl, iv);
    if (v == null) continue;
    lines.push({ key: `homa-${g.id}`, name: "HOMA-IR", value: fmtNum(v, 2), chip: v >= 2.5 ? [t("مرتفع (≥ 2.5)", "High (≥ 2.5)"), "warn"] : [t("أقل من 2.5", "Below 2.5"), "ok"],
      from: t(`سكر صائم ${fmtNum(gl, 0)} mg/dL، أنسولين ${fmtNum(iv, 1)} µIU/mL`, `fasting glucose ${fmtNum(gl, 0)} mg/dL, insulin ${fmtNum(iv, 1)} µIU/mL`), when: fmtDate(g.effective_at, lang, tz) });
  }

  if (!lines.length) return null;
  return (
    <Card title={<><Calculator size={18} aria-hidden="true" /> {t("قيم محسوبة", "Calculated values")}</>}>
      <div className="stack" style={{ gap: ".55rem" }}>
        {lines.map((l) => (
          <div key={l.key} className="row between">
            <span><strong>{l.name}</strong>: <span className="ltr">{l.value}</span> {l.chip && <Chip tone={l.chip[1]}>{l.chip[0]}</Chip>}
              <span className="muted small"> · {t("من", "from")} {l.from}</span></span>
            <span className="muted small nowrap">{l.when}</span>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ marginBlockStart: ".6rem" }}>
        {t("تُحسب تلقائياً من النتائج المسجلة ولا تُخزَّن، فتتبع أي تصحيح. معادلات للبالغين ومؤشرات فحص وليست تشخيصاً. eGFR لا يُحسب إن لم يُسجَّل الجنس ذكراً أو أنثى، ولا يكفي وحده للحكم على الكلى.",
           "Computed from recorded results and never stored, so they follow any correction. Adult equations and screening aids, not a diagnosis. eGFR is not computed unless sex is recorded as male or female, and is not enough on its own to judge kidney function.")}
      </p>
    </Card>
  );
}
