import { Printer, Pill } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";
import { lbl } from "@/lib/labels";
import { lineSig, lineTitle, RX_STATUS, type Rx } from "@/lib/prescription";
import { Chip, Empty } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton, type FormAction } from "@/components/ui/client";
import { SafetyList } from "@/components/SafetyAlerts";
import type { SafetyAlert } from "@/lib/safety-rules";

export interface RxActions {
  hidden: Record<string, string>;
  /** complete / cancel (the patient) */
  status?: FormAction;
  /** entered by mistake (the patient) */
  invalidate?: FormAction;
  /** the doctor withdraws their own */
  retract?: FormAction;
  pdfHref?: (rx: Rx) => string;
}

const tone = (s: string) => (s === "active" ? "ok" : s === "cancelled" ? "bad" : "muted");

/** The prescriptions of a file (or of a share), each with its medicines, a print link, and the drug alerts that concern it. */
export function Prescriptions({ rxs, lang, tz, actions, alerts = [], contributors = {}, empty, idPrefix = "rx" }: {
  rxs: Rx[]; lang: Lang; tz: string; actions: RxActions; alerts?: SafetyAlert[]; contributors?: Record<string, string>; empty?: string; idPrefix?: string;
}) {
  const t = (a: string, e: string) => (lang === "ar" ? a : e);
  if (!rxs.length) return <Empty>{empty ?? t("لا وصفات بعد.", "No prescriptions yet.")}</Empty>;
  return (
    <div className="stack" id={`${idPrefix}-list`}>
      {rxs.map((rx) => {
        const mine = alerts.filter((a) => a.drugs.some((d) => rx.lines.some((l) => [l.name_generic, l.name_brand].includes(d))));
        return (
          <article key={rx.id} className={`rec rx-card${rx.status !== "active" ? " closed" : ""}`} data-rx={rx.id}>
            <div className="row between">
              <span className="row" style={{ gap: ".4rem" }}>
                <Pill size={16} aria-hidden="true" />
                <strong>{rx.prescriber_name}</strong>
                <Chip tone={tone(rx.status)}>{lbl(RX_STATUS, rx.status, lang)}</Chip>
                {rx.contributed_by && <Chip tone="info">{t(`كتبها ${contributors[rx.contributed_by] ?? "طبيب"} عبر رابط`, `Written by ${contributors[rx.contributed_by] ?? "a doctor"} via a link`)}</Chip>}
                {rx.mine && <Chip tone="info">{t("وصفتك", "Yours")}</Chip>}
              </span>
              <span className="row" style={{ gap: ".4rem" }}>
                <span className="muted small">{fmtDate(rx.issued_on, lang, tz)}</span>
                {actions.pdfHref && <a className="btn sm" href={actions.pdfHref(rx)} target="_blank" rel="noopener noreferrer"><Printer size={14} aria-hidden="true" />{t("طباعة الوصفة", "Print prescription")}</a>}
              </span>
            </div>
            <p className="small muted" style={{ margin: ".2rem 0" }}>
              {[rx.prescriber_license && t(`ترخيص ${rx.prescriber_license}`, `licence ${rx.prescriber_license}`), rx.facility_name, rx.notes].filter(Boolean).join(" · ")}
              {rx.status_reason ? ` · ${rx.status_reason}` : ""}
            </p>
            <ul className="rx-lines">
              {rx.lines.map((l) => (
                <li key={l.id}>
                  <strong>{lineTitle(l, lang)}</strong>
                  <span className="small muted"> — {lineSig(l, lang)}</span>
                  {l.instructions && <div className="small">{l.instructions}</div>}
                  {l.status && l.status !== "active" && <Chip tone="muted">{l.status === "completed" ? t("انتهى", "Ended") : l.status === "stopped" ? t("أُوقف", "Stopped") : l.status}</Chip>}
                </li>
              ))}
            </ul>
            {mine.length > 0 && <SafetyList alerts={mine} lang={lang} compact />}
            {rx.status === "active" && (actions.status || actions.invalidate || actions.retract) && (
              <div className="row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
                {actions.status && (
                  <>
                    <ActionForm action={actions.status} className="row" resetOnSuccess={false}>
                      {Object.entries({ ...actions.hidden, _id: rx.id, status: "completed" }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                      <SubmitButton className="btn sm">{t("اكتملت الكورة", "Course completed")}</SubmitButton>
                    </ActionForm>
                    <details className="fold"><summary>{t("إلغاء الوصفة", "Cancel the prescription")}</summary><div className="fold-body">
                      <ActionForm action={actions.status} className="row">
                        {Object.entries({ ...actions.hidden, _id: rx.id, status: "cancelled" }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                        <input name="reason" required minLength={3} maxLength={500} placeholder={t("السبب", "Reason")} aria-label={t("السبب", "Reason")} style={{ flex: 1, minWidth: 160 }} />
                        <ConfirmButton message={t("إلغاء الوصفة وإيقاف أدويتها؟", "Cancel the prescription and stop its medicines?")}>{t("إلغاء", "Cancel it")}</ConfirmButton>
                      </ActionForm>
                    </div></details>
                  </>
                )}
                {actions.invalidate && !rx.contributed_by && (
                  <details className="fold"><summary>{t("أُدخلت خطأً", "Entered in error")}</summary><div className="fold-body">
                    <ActionForm action={actions.invalidate} className="row">
                      {Object.entries({ ...actions.hidden, _id: rx.id }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                      <input name="reason" required minLength={3} maxLength={500} placeholder={t("السبب", "Reason")} aria-label={t("السبب", "Reason")} style={{ flex: 1, minWidth: 160 }} />
                      <ConfirmButton message={t("إبطال الوصفة وأدويتها؟ تبقى في السجل مع السبب.", "Invalidate the prescription and its medicines? They stay in the history with the reason.")}>{t("إبطال", "Invalidate")}</ConfirmButton>
                    </ActionForm>
                  </div></details>
                )}
                {actions.retract && rx.mine && (
                  <details className="fold"><summary>{t("سحب هذه الوصفة", "Withdraw this prescription")}</summary><div className="fold-body">
                    <ActionForm action={actions.retract} className="row">
                      {Object.entries({ ...actions.hidden, _id: rx.id }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                      <input name="reason" required minLength={3} maxLength={400} placeholder={t("السبب", "Reason")} aria-label={t("السبب", "Reason")} style={{ flex: 1, minWidth: 160 }} />
                      <ConfirmButton message={t("سحب هذه الوصفة؟ تبقى في التاريخ مع السبب.", "Withdraw this prescription? It stays in the history with the reason.")}>{t("سحب", "Withdraw")}</ConfirmButton>
                    </ActionForm>
                  </div></details>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
