"use client";

import { useMemo, useState } from "react";
import type { Lang } from "@/lib/i18n";
import type { PerioTooth } from "@/lib/perio";
import {
  DX_EXTENTS, DX_GRADES, DX_KINDS, DX_STAGES, suggestDiagnosis, type DxLike, type PerioFactors, type Reason,
} from "@/lib/perio-staging";

/** the visits a chart can be linked to */
export interface VisitOption { id: string; label: string }

const num = (s: string) => (/^\d{1,3}$/.test(s.trim()) ? Number(s) : null);

/**
 * The periodontal diagnosis in the editor (2017 AAP/EFP): the engine suggests stage, grade and extent from the chart with its
 * reasons; the clinician confirms or changes them. The fields below are what is saved — the suggestion is only shown.
 */
export function PerioDxFields({ lang, teeth, factors, initial, visits, visitId }: {
  lang: Lang; teeth: PerioTooth[]; factors: PerioFactors; initial: DxLike; visits: VisitOption[]; visitId: string;
}) {
  const ar = lang === "ar";
  const t = (a: string, e: string) => (ar ? a : e);
  const [kind, setKind] = useState<string>(initial.dx_kind ?? "");
  const [stage, setStage] = useState<string>(initial.dx_stage ?? "");
  const [grade, setGrade] = useState<string>(initial.dx_grade ?? "");
  const [extent, setExtent] = useState<string>(initial.dx_extent ?? "");
  const [rbl, setRbl] = useState<string>(initial.dx_rbl_pct == null ? "" : String(initial.dx_rbl_pct));
  const [lost, setLost] = useState<string>(initial.dx_teeth_lost_perio == null ? "" : String(initial.dx_teeth_lost_perio));
  const [visit, setVisit] = useState(visitId);
  const rblN = num(rbl), lostN = num(lost);
  const sug = useMemo(() => suggestDiagnosis(teeth, { rblPct: rblN, teethLostPerio: lostN, factors }), [teeth, rblN, lostN, factors]);
  const kindOf = (v: string | null) => DX_KINDS.find((k) => k.value === v)?.[lang];
  const extentOf = (v: string | null) => DX_EXTENTS.find((k) => k.value === v)?.[lang];
  const reasons = (list: Reason[]) => (list.length ? <ul className="small muted perio-dx-reasons">{list.map((r, i) => <li key={i}>{r[lang]}</li>)}</ul> : null);
  const apply = () => {
    setKind(sug.kind ?? "");
    setStage(sug.stage ?? "");
    setGrade(sug.grade ?? "");
    setExtent(sug.extent ?? "");
  };
  const periodontitis = kind === "periodontitis";
  return (
    <fieldset className="perio-dx" id="perio-dx">
      <legend>{t("التشخيص اللثوي (تصنيف 2017 — AAP/EFP)", "Periodontal diagnosis (2017 AAP/EFP)")}</legend>
      <div className="perio-dx-suggest" aria-live="polite">
        <strong>{t("الاقتراح من المخطط", "Suggestion from the chart")}</strong>
        {sug.kind ? (<>
          <p className="perio-dx-sug-line" data-testid="dx-suggestion">
            {kindOf(sug.kind)}{sug.stage ? ` — ${t("المرحلة", "Stage")} ${sug.stage}` : ""}{sug.grade ? `, ${t("الدرجة", "Grade")} ${sug.grade}` : ""}
            {sug.extent ? `, ${extentOf(sug.extent)}` : ""}
          </p>
          {reasons(sug.kindReasons)}
          {sug.stage && <><h4 className="small">{t("المرحلة", "Stage")} {sug.stage}</h4>{reasons(sug.stageReasons)}</>}
          {sug.grade && <><h4 className="small">{t("الدرجة", "Grade")} {sug.grade}</h4>{reasons(sug.gradeReasons)}</>}
          {sug.extent && <><h4 className="small">{t("الامتداد", "Extent")}</h4>{reasons(sug.extentReasons)}</>}
          <button type="button" className="btn sm" onClick={apply}>{t("اعتمد الاقتراح في الحقول", "Use the suggestion")}</button>
        </>) : reasons(sug.kindReasons)}
        <p className="small muted">{t("اقتراح للمساعدة فقط؛ القرار السريري لك. ما تحفظه أدناه هو تشخيصك.", "A suggestion only; the clinical decision is yours. What you save below is your diagnosis.")}</p>
      </div>
      <div className="grid cols-4">
        <div className="field"><label htmlFor="dx-kind">{t("التشخيص", "Diagnosis")}</label>
          <select id="dx-kind" name="dx_kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">—</option>{DX_KINDS.map((k) => <option key={k.value} value={k.value}>{k[lang]}</option>)}
          </select></div>
        <div className="field"><label htmlFor="dx-stage">{t("المرحلة", "Stage")}</label>
          <select id="dx-stage" name="dx_stage" value={periodontitis ? stage : ""} disabled={!periodontitis} onChange={(e) => setStage(e.target.value)}>
            <option value="">—</option>{DX_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <div className="field"><label htmlFor="dx-grade">{t("الدرجة", "Grade")}</label>
          <select id="dx-grade" name="dx_grade" value={periodontitis ? grade : ""} disabled={!periodontitis} onChange={(e) => setGrade(e.target.value)}>
            <option value="">—</option>{DX_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select></div>
        <div className="field"><label htmlFor="dx-extent">{t("الامتداد", "Extent")}</label>
          <select id="dx-extent" name="dx_extent" value={periodontitis ? extent : ""} disabled={!periodontitis} onChange={(e) => setExtent(e.target.value)}>
            <option value="">—</option>{DX_EXTENTS.map((x) => <option key={x.value} value={x.value}>{x[lang]}</option>)}
          </select></div>
      </div>
      <div className="grid cols-3">
        <div className="field"><label htmlFor="dx-rbl">{t("فقد العظم الشعاعي في أسوأ موقع (%)", "Radiographic bone loss at the worst site (%)")}</label>
          <input id="dx-rbl" name="dx_rbl_pct" className="ltr" inputMode="numeric" maxLength={3} value={rbl} onChange={(e) => setRbl(e.target.value.replace(/\D/g, ""))} /></div>
        <div className="field"><label htmlFor="dx-lost">{t("أسنان فُقدت بسبب اللثة", "Teeth lost to periodontitis")}</label>
          <input id="dx-lost" name="dx_teeth_lost_perio" className="ltr" inputMode="numeric" maxLength={2} value={lost} onChange={(e) => setLost(e.target.value.replace(/\D/g, ""))} /></div>
        <div className="field"><label htmlFor="pe-visit">{t("ربط المخطط بزيارة", "Linked visit")}</label>
          <select id="pe-visit" name="encounter_id" value={visit} onChange={(e) => setVisit(e.target.value)}>
            <option value="">{t("— بلا زيارة —", "— no visit —")}</option>{visits.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select></div>
      </div>
      <div className="field"><label htmlFor="dx-note">{t("ملاحظة التشخيص", "Diagnosis note")}</label>
        <textarea id="dx-note" name="dx_note" rows={2} maxLength={2000} defaultValue={initial.dx_note ?? ""} /></div>
    </fieldset>
  );
}
