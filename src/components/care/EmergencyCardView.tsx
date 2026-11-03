import { ageLabel, fmtDate } from "@/lib/format";
import { ALLERGY_SEVERITY, DEVICE_KIND, lbl, MRI_SAFETY, SEX } from "@/lib/labels";
import { bloodLabel, medLine, type EmergencyCard } from "@/lib/care/emergency";
import type { Lang } from "@/lib/i18n";
import { Chip } from "@/components/ui";

/** The emergency card as a page: used by the owner (preview) and by the public link, so both show the same thing. */
export function EmergencyCardView({ card, lang }: { card: EmergencyCard; lang: Lang }) {
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const p = card.patient;
  const name = lang === "en" && p.full_name_en ? p.full_name_en : p.full_name;
  const blood = bloodLabel(p);
  const none = (flag: boolean) => (flag ? t("لا يوجد (إقرار مسجل)", "None (recorded statement)") : t("غير مسجلة", "None recorded"));
  return (
    <div className="emergency-card" data-testid="emergency-card">
      <header className="emergency-head">
        <div>
          <p className="emergency-kicker">{t("بطاقة الطوارئ الطبية", "Medical emergency card")}</p>
          <h2>{name}</h2>
          <p className="muted">{ageLabel(p.date_of_birth, lang)} · {lbl(SEX, p.sex, lang)} · {t("الميلاد", "DOB")} <span className="ltr">{fmtDate(p.date_of_birth, lang)}</span></p>
        </div>
        <div className={`emergency-blood${blood ? "" : " none"}`} aria-label={t("فصيلة الدم", "Blood group")}>
          <span className="small">{t("فصيلة الدم", "Blood group")}</span>
          <strong className="ltr">{blood || "—"}</strong>
          {blood && !p.blood_group_verified && <span className="small">{t("غير موثقة", "unverified")}</span>}
        </div>
      </header>
      <section>
        <h3>{t("الحساسية", "Allergies")}</h3>
        {card.allergies.length ? (
          <ul className="emergency-list">{card.allergies.map((a, i) => (
            <li key={i}><strong>{a.substance}</strong>{a.reaction ? ` — ${a.reaction}` : ""} <Chip tone={a.severity === "severe" || a.severity === "life_threatening" ? "bad" : "warn"}>{lbl(ALLERGY_SEVERITY, a.severity, lang)}</Chip></li>))}</ul>
        ) : <p className="muted">{p.allergy_assertion === "none_known" ? t("لا توجد حساسية معروفة (إقرار مسجل).", "No known allergies (recorded statement).") : t("حالة الحساسية غير معروفة؛ لا يعني ذلك عدم وجودها.", "Allergy status unknown; this does not mean there are none.")}</p>}
      </section>
      <section>
        <h3>{t("الأمراض المزمنة", "Chronic conditions")}</h3>
        {card.conditions.length ? <ul className="emergency-list">{card.conditions.map((c, i) => <li key={i}>{c.name}</li>)}</ul> : <p className="muted">{none(card.assertions.none_chronic_conditions)}</p>}
      </section>
      <section>
        <h3>{t("الأدوية الدائمة", "Long-term medicines")}</h3>
        {card.medications.length ? <ul className="emergency-list">{card.medications.map((m, i) => <li key={i}>{medLine(m)}</li>)}</ul> : <p className="muted">{none(card.assertions.none_long_term_medications)}</p>}
      </section>
      <section>
        <h3>{t("الأجهزة والزرعات", "Devices and implants")}</h3>
        {card.devices.length ? (
          <ul className="emergency-list">{card.devices.map((d, i) => (
            <li key={i}>{[lbl(DEVICE_KIND, d.kind, lang), d.name, d.body_site].filter(Boolean).join(" — ")}{d.mri_safety && d.mri_safety !== "unknown" ? <> <Chip tone={d.mri_safety === "unsafe" ? "bad" : d.mri_safety === "conditional" ? "warn" : "ok"}>MRI: {lbl(MRI_SAFETY, d.mri_safety, lang)}</Chip></> : null}</li>))}</ul>
        ) : <p className="muted">{none(card.assertions.none_devices)}</p>}
      </section>
      <section>
        <h3>{t("جهات الطوارئ", "Emergency contacts")}</h3>
        {card.contacts.length ? (
          <ul className="emergency-list">{card.contacts.map((c, i) => (
            <li key={i}><strong>{c.full_name}</strong>{c.relation ? ` (${c.relation})` : ""}{c.is_legal_representative ? ` · ${t("ممثل قانوني", "legal representative")}` : ""} <a className="ltr" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{c.phone}</a></li>))}</ul>
        ) : <p className="muted">{t("لا توجد جهات طوارئ في هذه البطاقة.", "No emergency contacts on this card.")}</p>}
      </section>
      <p className="muted small">{t("ملخص يختاره المريض لحالات الطوارئ؛ قد لا يكون كاملاً أو حديثاً. لا يغني عن تقييم الطبيب.", "A summary chosen by the patient for emergencies; it may be incomplete or out of date. It does not replace the clinician's assessment.")}</p>
    </div>
  );
}
