import { FileSignature, Printer } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/format";
import { lbl } from "@/lib/labels";
import { CONSENT_KIND, CONSENT_STATUS, SIGNER_ROLE, type ConsentRow } from "@/lib/consent";
import { Chip, Empty } from "@/components/ui";
import { ActionForm, ConfirmButton, type FormAction } from "@/components/ui/client";

export interface ConsentActions {
  hidden: Record<string, string>;
  /** withdraw (the patient) */
  withdraw?: FormAction;
  /** the drawn signature, shown to the file's members only */
  signatureHref?: (c: ConsentRow) => string;
  pdfHref?: (c: ConsentRow) => string;
  /** the form for a new version of a signed consent */
  newVersion?: (c: ConsentRow) => React.ReactNode;
}

const tone = (s: string) => (s === "signed" ? "ok" : s === "withdrawn" ? "bad" : "muted");

/** Consents, newest first: who signed in what capacity and when, what it covers, its state and version. Never edited, never deleted. */
export function ConsentList({ consents, lang, tz, actions, contributors = {}, empty, idPrefix = "consent" }: {
  consents: ConsentRow[]; lang: Lang; tz: string; actions: ConsentActions; contributors?: Record<string, string>; empty?: string; idPrefix?: string;
}) {
  const t = (a: string, e: string) => (lang === "ar" ? a : e);
  if (!consents.length) return <Empty>{empty ?? t("لا موافقات موقّعة بعد.", "No signed consents yet.")}</Empty>;
  return (
    <div className="stack" id={`${idPrefix}-list`}>
      {consents.map((c) => (
        <article key={c.id} className={`rec consent-card${c.status !== "signed" ? " closed" : ""}`} data-consent={c.id} data-status={c.status}>
          <div className="row between">
            <span className="row" style={{ gap: ".4rem" }}>
              <FileSignature size={16} aria-hidden="true" />
              <strong>{c.title}</strong>
              <Chip tone={tone(c.status)}>{lbl(CONSENT_STATUS, c.status, lang)}</Chip>
              <Chip tone="muted">{t(`النسخة ${c.version}`, `Version ${c.version}`)}</Chip>
              <Chip tone="muted">{lbl(CONSENT_KIND, c.kind, lang)}</Chip>
              {c.contributed_by && <Chip tone="info">{t(`قدّمها ${c.presented_by ?? contributors[c.contributed_by] ?? "طبيب"} عبر رابط`, `Presented by ${c.presented_by ?? contributors[c.contributed_by] ?? "a doctor"} via a link`)}</Chip>}
              {c.mine && <Chip tone="info">{t("قدّمتَها", "Yours")}</Chip>}
            </span>
            {actions.pdfHref && <a className="btn sm" href={actions.pdfHref(c)} target="_blank" rel="noopener noreferrer"><Printer size={14} aria-hidden="true" />{t("طباعة (PDF)", "Print (PDF)")}</a>}
          </div>
          <p className="small muted" style={{ margin: ".2rem 0" }}>
            {t("وقّعها", "Signed by")} <strong>{c.signer_name}</strong> ({lbl(SIGNER_ROLE, c.signer_role, lang)}) · {fmtDateTime(c.signed_at, lang, tz)}
            {c.witness_name ? ` · ${t("الشاهد", "witness")}: ${c.witness_name}` : ""}
          </p>
          {c.status === "withdrawn" && <p className="small consent-withdrawn">{t("سُحبت", "Withdrawn")} {c.withdrawn_at ? fmtDateTime(c.withdrawn_at, lang, tz) : ""} — {c.withdrawn_reason}</p>}
          {actions.signatureHref && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="sig-img" src={actions.signatureHref(c)} alt={t(`توقيع ${c.signer_name}`, `Signature of ${c.signer_name}`)} loading="lazy" />
            </>
          )}
          {c.status === "signed" && (actions.withdraw || actions.newVersion) && (
            <div className="row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
              {actions.newVersion && (
                <details className="fold"><summary>{t("نسخة جديدة", "New version")}</summary><div className="fold-body">{actions.newVersion(c)}</div></details>
              )}
              {actions.withdraw && (
                <details className="fold"><summary>{t("سحب الموافقة", "Withdraw")}</summary><div className="fold-body">
                  <ActionForm action={actions.withdraw} className="row">
                    {Object.entries({ ...actions.hidden, _id: c.id }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                    <input name="reason" required minLength={3} maxLength={500} placeholder={t("السبب", "Reason")} aria-label={t("السبب", "Reason")} style={{ flex: 1, minWidth: 160 }} />
                    <ConfirmButton message={t("سحب هذه الموافقة؟ تبقى في السجل مع السبب.", "Withdraw this consent? It stays in the record with the reason.")}>{t("سحب", "Withdraw")}</ConfirmButton>
                  </ActionForm>
                </div></details>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
