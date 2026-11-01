import { ShieldAlert } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { reasonText, type SafetyAlert } from "@/lib/safety-rules";
import { Chip } from "@/components/ui";

const TONE = { danger: "bad", warn: "warn", info: "info" } as const;

/** The alerts as banners: what to review, why (which record matched) and what it concerns. `compact` for use next to a treatment. */
export function SafetyList({ alerts, lang, compact = false }: { alerts: SafetyAlert[]; lang: Lang; compact?: boolean }) {
  const ar = lang === "ar";
  const t = (a: string, e: string) => (ar ? a : e);
  const sep = ar ? "، " : ", ";
  if (!alerts.length) return null;
  return (
    <div className={`safety-list${compact ? " compact" : ""}`}>
      {alerts.map((a) => (
        <div key={a.code} className={`banner ${TONE[a.severity]} safety-alert`} role={a.severity === "danger" ? "alert" : "note"} data-alert={a.code}>
          <ShieldAlert size={16} aria-hidden="true" style={{ flex: "none", marginBlockStart: 3 }} />
          <div>
            <strong>{ar ? a.title_ar : a.title_en}</strong>
            <span> — {ar ? a.message_ar : a.message_en}</span>
            <div className="small muted">
              {t("بسبب", "Because of")}: {a.reasons.map((r) => reasonText(r, lang)).join(sep)}
              {!compact && a.items.length > 0 && <> · {t("تخص", "Concerns")}: {a.items.map((i) => `${i.name}${i.teeth?.length ? ` (${i.teeth.join(",")})` : ""}`).join(sep)}</>}
              {!compact && a.drugs.length > 0 && <> · {t("الأدوية", "Drugs")}: {a.drugs.join(sep)}</>}
              {!a.reviewed && <> · <Chip tone="muted">{t("قاعدة لم تُراجع سريرياً", "rule not yet clinically reviewed")}</Chip></>}
              {a.reference && !compact && <> · <span title={a.reference}>{t("المرجع", "Reference")}: {a.reference}</span></>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The patient-level alerts at the top of a page (those not tied to a particular treatment), with the treatment alerts counted. */
export function SafetyAlerts({ alerts, lang, title }: { alerts: SafetyAlert[]; lang: Lang; title?: string }) {
  const t = (a: string, e: string) => (lang === "ar" ? a : e);
  if (!alerts.length) return null;
  return (
    <section className="card safety" aria-label={title ?? t("تنبيهات السلامة", "Safety alerts")} id="safety">
      <div className="card-head"><h2><ShieldAlert size={18} aria-hidden="true" /> {title ?? t("تنبيهات السلامة", "Safety alerts")}</h2>
        <Chip tone={alerts.some((a) => a.severity === "danger") ? "bad" : "warn"}>{t(`${alerts.length} للمراجعة`, `${alerts.length} to review`)}</Chip></div>
      <SafetyList alerts={alerts} lang={lang} />
      <p className="small muted">{t("تذكيرات للمراجعة مبنية على قواعد يراجعها المسؤول؛ ليست تشخيصاً ولا منعاً. القرار للطبيب المعالج.", "Reminders from rules an administrator reviews; they are not a diagnosis and do not block anything. The decision belongs to the treating clinician.")}</p>
    </section>
  );
}
