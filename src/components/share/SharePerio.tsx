import { i18n } from "@/lib/i18n";
import { getTz } from "@/lib/auth";
import { fmtDate, fmtPartialDate, localDate } from "@/lib/format";
import { summarize } from "@/lib/perio";
import { factorsFrom } from "@/lib/perio-staging";
import type { SharePerio } from "@/lib/share-types";
import type { ContribState } from "@/lib/share-contrib";
import { Card, Chip } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { PerioChart } from "@/components/dental/PerioChart";
import { PerioDxView } from "@/components/dental/PerioDxView";
import { canAdd } from "@/components/share/Contribute";
import { sharePerioPlan, sharePerioSave } from "@/app/actions/share-viewer";

/**
 * "مخطط اللثة" in the clinician's view: the final charts in the link's range (read-only, with the periodontal diagnosis and who
 * recorded each), and — when the patient allowed it — the editor for the doctor's own chart, with the diagnosis and the plan in phases.
 */
export function SharePerioCard({ token, perio, contrib }: { token: string; perio: SharePerio; contrib: ContribState | null }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const today = localDate(new Date(), tz);
  const day = (v: string) => fmtPartialDate(v, "day", lang);
  const mayChart = canAdd(contrib, "perio_exams");
  const mayPlan = canAdd(contrib, "treatment_plans");
  const finals = perio.exams.filter((e) => e.status === "final");
  const draft = perio.exams.find((e) => e.status === "draft" && e.contributed_by && e.contributed_by === perio.contributor_id);
  const visits = (contrib?.encounters ?? []).map((e) => ({ id: e.id, label: `${fmtDate(e.started_at, lang, tz)} — ${e.reason ?? e.kind}` }));
  const visitLabel = (id: string | null | undefined) => visits.find((v) => v.id === id)?.label ?? null;
  const f = perio.factors;
  const factors = factorsFrom({
    dob: f.date_of_birth, on: today, tobaccoStatus: f.tobacco_status, cigarettesPerDay: f.cigarettes_per_day, diabetes: f.diabetes, hba1c: f.hba1c?.value ?? null,
  });
  const seed = (finals[0]?.teeth ?? []).filter((x) => x.missing).map((x) => x.tooth);
  const who = contrib?.contributor?.full_name ?? "";

  const chartOf = (e: (typeof finals)[number]) => (
    <>
      <div className="row between perio-shown-bar">
        <span><Chip tone="ok">{t("معتمد", "Final")}</Chip> <strong>{day(e.exam_date)}</strong>{e.examiner_name ? <span className="muted"> — {e.examiner_name}</span> : null}
          {e.contributed_by && contrib?.contributor?.id === e.contributed_by ? <> <Chip tone="muted">{t("مخططك", "Your chart")}</Chip></> : null}</span>
        {mayPlan && (
          <ActionForm action={sharePerioPlan} className="inline">
            <input type="hidden" name="_t" value={token} /><input type="hidden" name="_id" value={e.id} />
            <SubmitButton className="btn sm" pending={t("جارٍ الإنشاء…", "Creating…")}>{t("خطة لثوية بمراحل", "Phased gum treatment plan")}</SubmitButton>
          </ActionForm>
        )}
      </div>
      <PerioDxView exam={e} lang={lang} visit={visitLabel(e.encounter_id)} />
      {e.notes && <p className="small">{e.notes}</p>}
      <PerioChart lang={lang} teeth={e.teeth} />
    </>
  );

  return (
    <Card id="perio" title={t("مخطط اللثة", "Periodontal chart")}
      description={t("قياسات اللثة المعتمدة في نطاق هذه المشاركة، مع التشخيص اللثوي ومن سجّلها.",
        "The final periodontal charts within this link's range, with the periodontal diagnosis and who recorded each.")}>
      {mayChart && (
        <details className="fold" id="contrib-perio" open={Boolean(draft)}>
          <summary>{t("إضافة: مخطط لثة", "Add: periodontal chart")}{draft ? <> <Chip tone="warn">{t("مسودة", "Draft")}</Chip></> : null}</summary>
          <div className="fold-body">
            <p className="small muted" style={{ marginBlockStart: 0 }}>{t(
              "يُحفظ المخطط باسمك. يبقى مسودة حتى تعتمده، وبعد الاعتماد لا يُعدَّل. اكتب الأرقام بالتتابع: ينتقل المؤشر تلقائياً.",
              "The chart is saved under your name. It stays a draft until you finalise it, and a final chart is not edited. Type the numbers in sequence: the cursor moves on by itself.")}</p>
            <PerioChart lang={lang} teeth={draft?.teeth ?? []} edit={{
              action: sharePerioSave, hidden: { _t: token }, examId: draft?.id ?? null, today, seedMissing: seed, examinerLocked: true,
              header: { exam_date: draft?.exam_date ?? today, examiner_name: who, facility_name: draft?.facility_name ?? contrib?.contributor?.facility ?? "", notes: draft?.notes ?? "" },
              dx: { factors, initial: draft ?? {}, visits, visitId: draft?.encounter_id ?? "" },
            }} />
          </div>
        </details>
      )}
      {finals.length === 0 ? (
        <p className="muted small">{t("لا يوجد مخطط لثة معتمد ضمن نطاق هذه المشاركة.", "There is no final periodontal chart within this link's range.")}</p>
      ) : finals.map((e, i) => {
        const sm = summarize(e.teeth);
        return i === 0 ? (
          <article key={e.id} className="rec share-perio" data-testid="share-perio-chart">{chartOf(e)}</article>
        ) : (
          <details key={e.id} className="fold share-perio">
            <summary>{day(e.exam_date)}{e.examiner_name ? ` — ${e.examiner_name}` : ""} · {t("جيوب ≥4", "PD ≥4")}: {sm.pd4}</summary>
            <div className="fold-body">{chartOf(e)}</div>
          </details>
        );
      })}
    </Card>
  );
}
