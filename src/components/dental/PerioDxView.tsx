import type { Lang } from "@/lib/i18n";
import { dxIsSet, dxLine, type DxLike } from "@/lib/perio-staging";
import { Chip } from "@/components/ui";

/** The periodontal diagnosis a clinician saved with a chart, and who recorded the chart when it came through a link. */
export function PerioDxView({ exam, lang, visit }: {
  exam: DxLike & { contributed_by?: string | null; examiner_name?: string | null };
  lang: Lang;
  /** the linked visit, when it can be named */
  visit?: string | null;
}) {
  const t = (a: string, e: string) => (lang === "ar" ? a : e);
  const by = exam.contributed_by ? (
    <Chip tone="info">{lang === "ar" ? `سجّله ${exam.examiner_name ?? ""} عبر رابط` : `Recorded by ${exam.examiner_name ?? "a doctor"} via a link`}</Chip>
  ) : null;
  if (!dxIsSet(exam) && !by && !visit) return null;
  return (
    <div className="perio-dx-view" data-testid="perio-dx-view">
      {by}
      {dxIsSet(exam) && (
        <p className="perio-dx-line">
          <strong>{t("التشخيص اللثوي", "Periodontal diagnosis")}:</strong> {dxLine(exam, lang) || "—"}
          {exam.dx_rbl_pct != null && <span className="muted small"> · {t("فقد العظم", "bone loss")} <span className="ltr">{exam.dx_rbl_pct}%</span></span>}
          {exam.dx_teeth_lost_perio != null && exam.dx_teeth_lost_perio > 0 && <span className="muted small"> · {t("أسنان فُقدت", "teeth lost")} {exam.dx_teeth_lost_perio}</span>}
        </p>
      )}
      {exam.dx_note && <p className="small">{exam.dx_note}</p>}
      {visit && <p className="small muted">{t("مرتبط بالزيارة", "Linked to the visit")}: {visit}</p>}
    </div>
  );
}
