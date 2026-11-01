import Link from "next/link";
import { HeartPulse, Pencil, TriangleAlert } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { fmtDate, fmtNum, fmtPartialDate } from "@/lib/format";
import { bmiClass } from "@/lib/clinical/derived";
import { ACTIVITY_LEVEL, ALCOHOL_STATUS, ALLERGY_SEVERITY, CLINICAL_STATUS, DEVICE_KIND, DIET_PATTERN, EXPOSURE_KIND, LIVING_SITUATION, lbl, PREGNANCY_STATUS, PROTECTIVE_EQUIPMENT, SEX, SLEEP_QUALITY, SUBSTANCE_STATUS, SUBSTANCE_TYPE, TOBACCO_STATUS, TOBACCO_TYPE } from "@/lib/labels";
import { ageOf, bodyMetrics, contextPackYears, coreGaps, matchHighlights, type ClinicalContextData } from "@/lib/clinical-context";
import { Chip } from "@/components/ui";
import { BMI_LABEL } from "@/components/observations/DerivedCard";

/**
 * The core context, entered once in the core file and shown the same way everywhere: the overview, every specialty,
 * the dental file, the clinician's shared view and the PDF. `codes` picks the specialty reminders to show (null = none).
 * `coreHref` (patient side only) links each gap to the part of the core file that completes it.
 */
export function ClinicalContext({
  ctx, lang, tz = "UTC", codes = null, coreHref, title,
}: { ctx: ClinicalContextData; lang: Lang; tz?: string; codes?: string[] | "all" | null; coreHref?: string; title?: string }) {
  const ar = lang === "ar";
  const t = (a: string, e: string) => (ar ? a : e);
  const { cm, kg, bmi } = bodyMetrics(ctx.body);
  const l = ctx.lifestyle;
  const py = contextPackYears(l);
  const hl = codes ? matchHighlights(ctx, codes) : [];
  const gaps = coreHref ? coreGaps(ctx) : [];
  const female = ctx.patient.sex !== "male";
  const none = (v: boolean | undefined, yes: [string, string]) => <p className="muted small">{v ? t(...yes) : t("غير مسجل بعد (لا يعني عدم الوجود).", "Not recorded yet (not the same as none).")}</p>;
  const edit = (anchor: string) => coreHref ? <Link className="ctx-edit" href={`${coreHref}#${anchor}`} aria-label={t("تعديل في الملف الأساسي", "Edit in the core file")}><Pencil size={13} aria-hidden="true" /></Link> : null;
  const bmiC = bmi ? BMI_LABEL[bmiClass(bmi)] : null;

  return (
    <section className="card ctx" aria-label={title ?? t("السياق الصحي", "Health context")}>
      <div className="card-head">
        <h2><HeartPulse size={18} aria-hidden="true" /> {title ?? t("السياق الصحي (من الملف الأساسي)", "Health context (from the core file)")}</h2>
        {coreHref && <Link className="btn sm" href={coreHref}>{t("الملف الأساسي", "Core file")}</Link>}
      </div>

      {hl.length > 0 && (
        <div className="ctx-alerts">
          {hl.map((h) => (
            <div key={h.message_en} className={`banner ${h.level === "info" ? "info" : h.level}`} role={h.level === "bad" ? "alert" : "note"}>
              <TriangleAlert size={16} aria-hidden="true" />
              <div><strong>{ar ? h.message_ar : h.message_en}</strong>
                <span className="small muted"> — {t("بسبب", "because of")}: {h.because.map((b) => (b === "pregnancy" ? t("الحمل", "pregnancy") : b === "tobacco" ? t("التدخين", "tobacco") : b)).join("، ")}</span></div>
            </div>
          ))}
          {hl.some((h) => !h.reviewed) && <p className="small muted">{t("تذكيرات للمراجعة مبنية على قواعد عامة لم تُراجع سريرياً بعد؛ ليست تشخيصاً ولا قراراً علاجياً.", "Reminders to review, from general rules not yet clinically reviewed; not a diagnosis or a treatment decision.")}</p>}
        </div>
      )}

      <div className="ctx-line">
        <Chip tone="muted">{t(`${ageOf(ctx.patient.date_of_birth)} سنة`, `${ageOf(ctx.patient.date_of_birth)} y`)}</Chip>
        <Chip tone="muted">{lbl(SEX, ctx.patient.sex, lang)}</Chip>
        {ctx.patient.blood_abo
          ? <Chip tone="info">{t("الدم", "Blood")}: <span className="ltr">{ctx.patient.blood_abo}{ctx.patient.blood_rh ?? ""}</span>{ctx.patient.blood_group_verified ? "" : ` (${t("غير موثقة", "unverified")})`}</Chip>
          : <Chip tone="warn">{t("فصيلة الدم غير مسجلة", "Blood group not recorded")}</Chip>}
        {cm ? <Chip tone="muted">{t("الطول", "Height")} <span className="ltr">{fmtNum(cm, 0)} cm</span></Chip> : <Chip tone="warn">{t("الطول غير مسجل", "Height not recorded")}</Chip>}
        {kg ? <Chip tone="muted">{t("الوزن", "Weight")} <span className="ltr">{fmtNum(kg, 1)} kg</span> <span className="small">({fmtDate(ctx.body?.weight?.at, lang, tz)})</span></Chip> : <Chip tone="warn">{t("الوزن غير مسجل", "Weight not recorded")}</Chip>}
        {bmi && bmiC && <Chip tone={bmiC[2]}>BMI <span className="ltr">{fmtNum(bmi, 1)}</span> · {ar ? bmiC[0] : bmiC[1]}</Chip>}
        {edit("body")}
      </div>

      <div className="ctx-grid">
        <div>
          <h3>{t("الحساسية", "Allergies")} {edit("allergies")}</h3>
          {ctx.allergies.length > 0 ? ctx.allergies.map((a) => (
            <div key={a.substance}><Chip tone="bad">{a.substance}</Chip> <span className="small muted">{lbl(ALLERGY_SEVERITY, a.severity, lang)}{a.reaction ? ` · ${a.reaction}` : ""}</span></div>
          )) : ctx.patient.allergy_assertion === "none_known"
            ? <p className="small">{t("لا توجد حساسية معروفة (إقرار مسجل).", "No known allergies (recorded statement).")}</p>
            : <p className="small warn-text">{t("غير معروف — لا يعني عدم وجود حساسية.", "Unknown — not the same as none.")}</p>}
        </div>
        <div>
          <h3>{t("الأمراض المزمنة والخلقية", "Chronic & congenital conditions")} {edit("conditions")}</h3>
          {ctx.conditions.length > 0 ? ctx.conditions.map((c) => (
            <div key={c.name}>{c.name} <span className="small muted">{lbl(CLINICAL_STATUS, c.clinical_status, lang)}{c.certainty !== "confirmed" ? ` · ${t("غير مؤكد", "unconfirmed")}` : ""}</span></div>
          )) : none(l?.none_chronic_conditions, ["لا أمراض مزمنة معروفة (إقرار مسجل).", "No known chronic conditions (recorded statement)."])}
        </div>
        <div>
          <h3>{t("الأدوية", "Medications")} {edit("medications")}</h3>
          {ctx.medications.length > 0 ? ctx.medications.map((m, i) => (
            <div key={`${m.name}-${i}`}>{[m.name, m.strength].filter(Boolean).join(" ")} {m.long_term && <Chip tone="info">{t("دائم", "long-term")}</Chip>}
              {m.status === "on_hold" && <Chip tone="warn">{t("موقوف مؤقتاً", "on hold")}</Chip>}
              {(m.dose || m.frequency) && <span className="small muted"> · {[m.dose, m.frequency].filter(Boolean).join(" ")}</span>}</div>
          )) : none(l?.none_long_term_medications, ["لا أدوية دائمة (إقرار مسجل).", "No long-term medications (recorded statement)."])}
        </div>
        <div>
          <h3>{t("الأجهزة والزرعات", "Devices & implants")} {edit("devices")}</h3>
          {ctx.devices.length > 0 ? ctx.devices.map((d, i) => (
            <div key={i}>{lbl(DEVICE_KIND, d.kind, lang)}{d.name ? ` — ${d.name}` : ""} {d.implanted_on && <span className="small muted">({fmtPartialDate(d.implanted_on, d.date_precision ?? "day", lang)})</span>}</div>
          )) : none(l?.none_devices, ["لا أجهزة ولا زرعات (إقرار مسجل).", "No devices or implants (recorded statement)."])}
        </div>
        <div>
          <h3>{t("نمط الحياة", "Lifestyle")} {edit("lifestyle")}</h3>
          {!l || l.tobacco_status === "unknown" ? <p className="small muted">{t("التدخين: غير محدد.", "Tobacco: not stated.")}</p> : (
            <p className="small">{t("التدخين", "Tobacco")}: <strong>{lbl(TOBACCO_STATUS, l.tobacco_status, lang)}</strong>
              {l.tobacco_types.length > 0 && ` (${l.tobacco_types.map((x) => lbl(TOBACCO_TYPE, x, lang)).join("، ")})`}
              {l.cigarettes_per_day ? ` · ${t(`${fmtNum(Number(l.cigarettes_per_day), 0)} سيجارة/يوم`, `${fmtNum(Number(l.cigarettes_per_day), 0)} cigarettes/day`)}` : ""}
              {l.waterpipe_per_week ? ` · ${t(`${fmtNum(Number(l.waterpipe_per_week), 0)} أرجيلة/أسبوع`, `${fmtNum(Number(l.waterpipe_per_week), 0)} waterpipes/week`)}` : ""}
              {py ? ` · ${t(`${fmtNum(py, 1)} علبة-سنة`, `${fmtNum(py, 1)} pack-years`)}` : ""}
              {l.tobacco_status === "former" && l.tobacco_quit_year ? ` · ${t(`أقلع ${l.tobacco_quit_year}`, `quit ${l.tobacco_quit_year}`)}` : ""}</p>
          )}
          {l?.alcohol_status && l.alcohol_status !== "unknown" && <p className="small">{t("الكحول", "Alcohol")}: {lbl(ALCOHOL_STATUS, l.alcohol_status, lang)}</p>}
          {l?.activity_level && <p className="small">{t("النشاط البدني", "Physical activity")}: {lbl(ACTIVITY_LEVEL, l.activity_level, lang)}
            {l.activity_minutes_per_week ? ` · ${t(`${fmtNum(Number(l.activity_minutes_per_week), 0)} دقيقة/أسبوع`, `${fmtNum(Number(l.activity_minutes_per_week), 0)} min/week`)}` : ""}</p>}
          {!l?.activity_level && l?.activity_minutes_per_week ? <p className="small">{t("النشاط البدني", "Physical activity")}: {t(`${fmtNum(Number(l.activity_minutes_per_week), 0)} دقيقة/أسبوع`, `${fmtNum(Number(l.activity_minutes_per_week), 0)} min/week`)}</p> : null}
          {l?.occupation && <p className="small">{t("المهنة", "Occupation")}: {l.occupation}</p>}
          {(ctx.exposures ?? []).length > 0 && (
            <p className="small">{t("التعرضات", "Exposures")}: {(ctx.exposures ?? []).map((e) => `${lbl(EXPOSURE_KIND, e.kind, lang)}${e.agent ? ` (${e.agent})` : ""}${e.years != null ? ` · ${fmtNum(Number(e.years), 1)} ${t("سنة", "y")}` : ""} · ${lbl(PROTECTIVE_EQUIPMENT, e.protective_equipment, lang)}`).join(t("؛ ", "; "))}</p>
          )}
          {l?.diet_pattern && <p className="small">{t("الغذاء", "Diet")}: {lbl(DIET_PATTERN, l.diet_pattern, lang)}</p>}
          {(l?.sleep_hours || l?.sleep_quality) ? <p className="small">{t("النوم", "Sleep")}: {[l?.sleep_hours ? t(`${fmtNum(Number(l.sleep_hours), 1)} ساعة`, `${fmtNum(Number(l.sleep_hours), 1)} h`) : "", l?.sleep_quality ? lbl(SLEEP_QUALITY, l.sleep_quality, lang) : ""].filter(Boolean).join(" · ")}</p> : null}
          {l?.living_situation && <p className="small">{t("السكن", "Living")}: {lbl(LIVING_SITUATION, l.living_situation, lang)}</p>}
          {coreHref && l?.substance_use_status && l.substance_use_status !== "unknown" && (
            <p className="small">{t("مواد أخرى", "Other substances")}: {lbl(SUBSTANCE_STATUS, l.substance_use_status, lang)}
              {(l.substance_types ?? []).length > 0 && ` (${(l.substance_types ?? []).map((x) => lbl(SUBSTANCE_TYPE, x, lang)).join("، ")})`}</p>
          )}
        </div>
        {female && (
          <div>
            <h3>{t("الحمل والإرضاع", "Pregnancy & breastfeeding")} {edit("lifestyle")}</h3>
            {!l || !l.pregnancy_status || l.pregnancy_status === "unknown" ? <p className="small muted">{t("غير محدد.", "Not stated.")}</p> : (
              <p className="small"><strong className={l.pregnancy_status === "pregnant" ? "warn-text" : ""}>{lbl(PREGNANCY_STATUS, l.pregnancy_status, lang)}</strong>
                {l.pregnancy_edd ? ` · ${t("الموعد المتوقع", "due")} ${fmtDate(l.pregnancy_edd, lang)}` : ""}</p>
            )}
            {l?.breastfeeding && <p className="small">{t("ترضع حالياً", "Currently breastfeeding")}</p>}
          </div>
        )}
      </div>

      {gaps.length > 0 && coreHref && (
        <p className="small ctx-gaps">{t("ناقص في الملف الأساسي:", "Missing from the core file:")}{" "}
          {gaps.map((g, i) => <span key={g.key}>{i > 0 && "، "}<Link href={`${coreHref}#${g.anchor}`}>{t(g.ar, g.en)}</Link></span>)}</p>
      )}
    </section>
  );
}
