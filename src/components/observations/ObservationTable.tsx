import { Pencil, Eraser } from "lucide-react";
import { getObsTypes } from "@/lib/data";
import { fmtDateTime } from "@/lib/format";
import { lbl, SETTING, SOURCE, VERIFICATION } from "@/lib/labels";
import { CONTEXT_BY_TYPE } from "@/lib/labels";
import { deltas } from "@/lib/clinical/series";
import type { Lang } from "@/lib/i18n";
import type { ObservationRow, ObservationType } from "@/lib/types";
import { Chip, InterpChip } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/ui/client";
import { correctObservation, invalidateObservation } from "@/app/actions/observations";

export function valueText(o: ObservationRow, ty: ObservationType | undefined): string {
  if (ty?.value_kind === "bp") return `${o.value_num}/${o.value_num2}`;
  if (o.value_num != null) return String(o.value_num);
  return o.value_text ?? "";
}

export async function ObservationTable({
  rows, lang, tz, canWrite, pid, returnPath, showDelta = false,
}: { rows: ObservationRow[]; lang: Lang; tz: string; canWrite: boolean; pid: string; returnPath: string; showDelta?: boolean }) {
  const types = await getObsTypes();
  const byId = new Map(types.map((x) => [x.id, x]));
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const d = showDelta ? deltas(rows) : new Map<string, number | null>();
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr>
          <th>{t("الوقت", "When")}</th><th>{t("القياس", "Measure")}</th><th>{t("النتيجة", "Result")}</th>
          {showDelta && <th>{t("التغير", "Change")}</th>}<th>{t("المرجع", "Reference")}</th><th>{t("التصنيف", "Flag")}</th><th>{t("الظروف والمصدر", "Conditions & source")}</th>
          {canWrite && <th><span className="sr-only">{t("إجراءات", "Actions")}</span></th>}
        </tr></thead>
        <tbody>
          {rows.map((o) => {
            const ty = byId.get(o.type_id);
            const superseded = o.status === "amended" || o.status === "entered_in_error";
            const ctxOpts = ty ? CONTEXT_BY_TYPE[ty.code] ?? [] : [];
            const ref = o.ref_low != null || o.ref_high != null ? `${o.ref_low ?? ""} – ${o.ref_high ?? ""}` : o.ref_text ?? "";
            const delta = d.get(o.id);
            return (
              <tr key={o.id} className={superseded ? "superseded" : undefined}>
                <td className="nowrap">{fmtDateTime(o.effective_at, lang, tz)}</td>
                <td>
                  {o.custom_name || (ty ? (lang === "ar" ? ty.name_ar : ty.name_en) : "—")}
                  <div className="row" style={{ gap: ".25rem" }}>
                    {o.supersedes_id && <Chip tone="info">{t("تصحيح", "Correction")}</Chip>}
                    {o.status === "amended" && <Chip tone="muted">{t("مصحَّحة", "Superseded")}</Chip>}
                    {o.status === "entered_in_error" && <Chip tone="bad">{t("بالخطأ", "In error")}</Chip>}
                    {o.status === "preliminary" && <Chip tone="warn">{t("أولية", "Preliminary")}</Chip>}
                  </div>
                </td>
                <td className="nowrap"><strong><span className="ltr">{valueText(o, ty)}</span></strong> <span className="muted small ltr">{o.unit ?? ""}</span></td>
                {showDelta && <td className="nowrap">{delta == null ? <span className="muted small" title={t("لا مقارنة: وحدة مختلفة أو أول قراءة", "No comparison: different unit or first reading")}>—</span> : <span className="ltr">{delta > 0 ? "+" : ""}{Number(delta.toFixed(2))}</span>}</td>}
                <td className="nowrap muted small"><span className="ltr">{ref}</span></td>
                <td>{superseded ? null : <InterpChip value={o.interpretation} lang={lang} />}
                  {o.interpretation_basis === "reported_by_lab" && <div className="muted small">{t("كما ورد من المختبر", "as reported by the lab")}</div>}
                </td>
                <td className="small">
                  {[o.context ? lbl(ctxOpts, o.context, lang) : "", lbl(SETTING, o.setting, lang), o.device].filter(Boolean).join(" · ")}
                  <div className="muted">{lbl(SOURCE, o.source, lang)}{o.source_detail ? ` (${o.source_detail})` : ""} · {lbl(VERIFICATION, o.verification, lang)}</div>
                  {o.symptoms && <div>{t("أعراض", "Symptoms")}: {o.symptoms}</div>}
                  {o.notes && <div>{o.notes}</div>}
                  {o.amendment_reason && <div className="muted">{t("السبب", "Reason")}: {o.amendment_reason}</div>}
                </td>
                {canWrite && (
                  <td style={{ minWidth: 190 }}>
                    {o.status === "final" && (
                      <details className="fold">
                        <summary><Pencil size={13} aria-hidden="true" />{t("تصحيح", "Correct")}</summary>
                        <div className="fold-body">
                          <p className="small muted">{t("تبقى القيمة الأصلية في التاريخ وتُستبدل بهذه.", "The original value stays in the history and is superseded by this one.")}</p>
                          <ActionForm action={correctObservation} className="stack">
                            <input type="hidden" name="_pid" value={pid} /><input type="hidden" name="_id" value={o.id} />
                            <div className="field"><label>{ty?.value_kind === "bp" ? t("الانقباضي", "Systolic") : t("القيمة", "Value")}</label>
                              {ty?.value_kind === "text" ? <input name="value_text" type="text" defaultValue={o.value_text ?? ""} /> : <input name="value_num" type="text" inputMode="decimal" dir="ltr" defaultValue={o.value_num ?? ""} />}</div>
                            {ty?.value_kind === "bp" && <div className="field"><label>{t("الانبساطي", "Diastolic")}</label><input name="value_num2" type="text" inputMode="decimal" dir="ltr" defaultValue={o.value_num2 ?? ""} /></div>}
                            <div className="field"><label>{t("الوحدة", "Unit")}</label><input name="unit" type="text" dir="ltr" defaultValue={o.unit ?? ""} /></div>
                            <div className="field"><label>{t("سبب التصحيح", "Reason")} <span className="req">*</span></label><input name="reason" type="text" required minLength={3} maxLength={500} /></div>
                            <SubmitButton className="btn primary sm">{t("حفظ التصحيح", "Save correction")}</SubmitButton>
                          </ActionForm>
                        </div>
                      </details>
                    )}
                    {(o.status === "final" || o.status === "preliminary") && (
                      <details className="fold" style={{ marginBlockStart: ".3rem" }}>
                        <summary><Eraser size={13} aria-hidden="true" />{t("بالخطأ", "In error")}</summary>
                        <div className="fold-body">
                          <ActionForm action={invalidateObservation} className="stack">
                            <input type="hidden" name="_pid" value={pid} /><input type="hidden" name="_id" value={o.id} />
                            <input name="reason" type="text" required minLength={3} maxLength={500} placeholder={t("السبب", "Reason")} aria-label={t("السبب", "Reason")} />
                            <ConfirmButton message={t("إبطال هذه النتيجة؟ ستبقى في السجل.", "Invalidate this result? It stays in the record.")}>{t("إبطال", "Invalidate")}</ConfirmButton>
                          </ActionForm>
                        </div>
                      </details>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
