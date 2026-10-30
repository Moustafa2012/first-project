"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { Plus, Trash2 } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import {
  DENTITION, DISEASE_KINDS, EVIDENCE, EXAM_KIND, FINDING_KIND, FINDING_SEVERITY, MATERIAL, ORAL_HYGIENE, SURFACES, TOOTH_STATUS,
  WHOLE_TOOTH_KINDS, archesFor, fmtSurfaces, surfaceCode, surfaceName, toothName, type Dentition, type Surface,
} from "@/lib/dental";
import { lbl, type Opt } from "@/lib/labels";
import type { FormAction, FormState } from "@/components/ui/client";
import { SubmitButton } from "@/components/ui/client";
import { Odontogram, type ChartTooth } from "./Odontogram";

interface Draft { key: number; tooth: number; surfaces: Surface[]; kind: string; evidence: string; severity: string; material: string; notes: string; condition_id: string }
const EMPTY = { kind: "caries", surfaces: [] as Surface[], evidence: "clinical", severity: "", material: "", notes: "", condition_id: "" };

const Sel = ({ id, label, value, onChange, opts, lang, blank }: { id: string; label: string; value: string; onChange: (v: string) => void; opts: Opt[]; lang: Lang; blank?: boolean }) => (
  <div className="field"><label htmlFor={id}>{label}</label>
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {blank && <option value="">—</option>}
      {opts.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}
    </select></div>
);

/**
 * Records one exam: choose a tooth on the chart, set its state and add what was found on which surfaces; everything is
 * saved together. Used by the patient (own account of past exams) and by a clinician through a contributing share.
 */
export function ExamEditor({
  action, hidden, lang, today, defaultDentition, conditions = [], encounters = [], examiner = "", idPrefix = "ex", evidenceDefault = "clinical",
}: {
  action: FormAction; hidden: Record<string, string>; lang: Lang; today: string; defaultDentition: Dentition;
  conditions?: { id: string; name: string; teeth: number[] | null }[]; encounters?: { id: string; label: string }[]; examiner?: string;
  idPrefix?: string; evidenceDefault?: string;
}) {
  const ar = lang === "ar";
  const t = (a: string, e: string) => (ar ? a : e);
  const [state, formAction] = useFormState<FormState, FormData>(action, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const [dentition, setDentition] = useState<Dentition>(defaultDentition);
  const [selected, setSelected] = useState<number | null>(null);
  const [states, setStates] = useState<Record<number, string>>({});
  const [findings, setFindings] = useState<Draft[]>([]);
  const [draft, setDraft] = useState({ ...EMPTY, evidence: evidenceDefault });
  const [seq, setSeq] = useState(1);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setStates({}); setFindings([]); setSelected(null); setDraft({ ...EMPTY, evidence: evidenceDefault });
    }
  }, [state, evidenceDefault]);

  const teeth = useMemo(() => {
    const out: Record<number, ChartTooth> = {};
    for (const [k, v] of Object.entries(states)) out[Number(k)] = { status: v === "not_examined" ? null : v, findings: [] };
    for (const f of findings) (out[f.tooth] ??= { status: null, findings: [] }).findings.push(f);
    return out;
  }, [states, findings]);

  const whole = WHOLE_TOOTH_KINDS.has(draft.kind);
  const toggleSurface = (_t: number, s: Surface) => {
    if (whole) return;
    setDraft((d) => ({ ...d, surfaces: d.surfaces.includes(s) ? d.surfaces.filter((x) => x !== s) : [...d.surfaces, s] }));
  };
  const select = (tooth: number) => { if (tooth !== selected) setDraft((d) => ({ ...d, surfaces: [] })); setSelected(tooth); };
  const addFinding = () => {
    if (!selected) return;
    setFindings((fs) => [...fs, { key: seq, tooth: selected, ...draft, surfaces: whole ? [] : draft.surfaces }]);
    setSeq((n) => n + 1);
    setStates((st) => (st[selected] ? st : { ...st, [selected]: "present" }));
    setDraft((d) => ({ ...d, surfaces: [], notes: "" }));
  };
  const allPresent = () => {
    setStates((st) => {
      const out = { ...st };
      for (const tooth of archesFor(dentition).flat()) if (!out[tooth]) out[tooth] = "present";
      return out;
    });
  };
  const stateList = Object.entries(states).map(([k, v]) => ({ tooth: Number(k), status: v }));
  const byStatus = new Map<string, number[]>();
  for (const s of stateList) byStatus.set(s.status, [...(byStatus.get(s.status) ?? []), s.tooth].sort((a, b) => a - b));
  const linkable = conditions.filter((c) => !c.teeth || !selected || c.teeth.includes(selected));

  return (
    <form action={formAction} ref={formRef} className="stack exam-editor" id={`${idPrefix}-form`}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input type="hidden" name="states" value={JSON.stringify(stateList)} />
      <input type="hidden" name="findings" value={JSON.stringify(findings.map(({ key: _k, ...f }) => f))} />
      <div className="form-grid">
        <div className="field"><label htmlFor={`${idPrefix}_date`}>{t("تاريخ الفحص", "Exam date")} <span className="req">*</span></label>
          <input id={`${idPrefix}_date`} name="exam_date" type="date" required defaultValue={today} max={today} /></div>
        <div className="field"><label htmlFor={`${idPrefix}_kind`}>{t("نوع الفحص", "Kind of exam")}</label>
          <select id={`${idPrefix}_kind`} name="kind" defaultValue="comprehensive">{EXAM_KIND.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
        <div className="field"><label htmlFor={`${idPrefix}_dent`}>{t("نوع الإطباق", "Dentition")}</label>
          <select id={`${idPrefix}_dent`} name="dentition" value={dentition} onChange={(e) => setDentition(e.target.value as Dentition)}>
            {DENTITION.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
        <div className="field"><label htmlFor={`${idPrefix}_exr`}>{t("الفاحص", "Examiner")}</label>
          <input id={`${idPrefix}_exr`} name="examiner_name" maxLength={200} defaultValue={examiner} /></div>
        <div className="field"><label htmlFor={`${idPrefix}_fac`}>{t("العيادة / المنشأة", "Clinic / facility")}</label>
          <input id={`${idPrefix}_fac`} name="facility_name" maxLength={200} /></div>
        <div className="field"><label htmlFor={`${idPrefix}_hyg`}>{t("نظافة الفم", "Oral hygiene")}</label>
          <select id={`${idPrefix}_hyg`} name="oral_hygiene" defaultValue=""><option value="">—</option>{ORAL_HYGIENE.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
        {encounters.length > 0 && (
          <div className="field"><label htmlFor={`${idPrefix}_enc`}>{t("ضمن زيارة", "Within a visit")}</label>
            <select id={`${idPrefix}_enc`} name="encounter_id" defaultValue=""><option value="">—</option>{encounters.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select></div>
        )}
        <div className="field wide"><label htmlFor={`${idPrefix}_cc`}>{t("الشكوى الرئيسية", "Chief complaint")}</label>
          <input id={`${idPrefix}_cc`} name="chief_complaint" maxLength={1000} /></div>
      </div>

      <div className="exam-chart">
        <div className="row between">
          <strong>{t("اختر سناً على المخطط", "Choose a tooth on the chart")}</strong>
          <button type="button" className="btn sm" onClick={allPresent}>{t("علّم بقية الأسنان «موجود»", "Mark the other teeth “present”")}</button>
        </div>
        <Odontogram dentition={dentition} teeth={teeth} lang={lang} selected={selected} onSelect={select} onSurface={toggleSurface}
          marked={draft.surfaces} idPrefix={`${idPrefix}-t`} />
        <p className="hint">{t("الأسهم للتنقل بين الأسنان، Enter للاختيار، ثم M/O/D/B/L لتحديد الأسطح.", "Arrow keys move between teeth, Enter selects, then M/O/D/B/L toggle surfaces.")}</p>
      </div>

      {selected && (
        <section className="tooth-editor" aria-label={t(`السن ${selected}`, `Tooth ${selected}`)}>
          <h3><span className="ltr">{selected}</span> — {toothName(selected, lang)}</h3>
          <fieldset className="status-pick">
            <legend>{t("حالة السن في هذا الفحص", "Tooth state in this exam")}</legend>
            {TOOTH_STATUS.map((o) => (
              <label key={o.value} className={`pill${states[selected] === o.value ? " on" : ""}`}>
                <input type="radio" name={`_st_${selected}`} checked={states[selected] === o.value}
                  onChange={() => setStates((st) => ({ ...st, [selected]: o.value }))} />{o[lang]}
              </label>
            ))}
            {states[selected] && <button type="button" className="btn ghost sm" onClick={() => setStates(({ [selected]: _x, ...rest }) => rest)}>{t("إزالة", "Clear")}</button>}
          </fieldset>
          <div className="form-grid">
            <Sel id={`${idPrefix}_fk`} label={t("ما وُجد", "Finding")} value={draft.kind} onChange={(v) => setDraft((d) => ({ ...d, kind: v }))} opts={FINDING_KIND} lang={lang} />
            <Sel id={`${idPrefix}_fe`} label={t("الإثبات", "Evidence")} value={draft.evidence} onChange={(v) => setDraft((d) => ({ ...d, evidence: v }))} opts={EVIDENCE} lang={lang} />
            {DISEASE_KINDS.has(draft.kind)
              ? <Sel id={`${idPrefix}_fs`} label={t("الشدة", "Severity")} value={draft.severity} onChange={(v) => setDraft((d) => ({ ...d, severity: v }))} opts={FINDING_SEVERITY} lang={lang} blank />
              : <Sel id={`${idPrefix}_fm`} label={t("المادة", "Material")} value={draft.material} onChange={(v) => setDraft((d) => ({ ...d, material: v }))} opts={MATERIAL} lang={lang} blank />}
            {linkable.length > 0 && (
              <Sel id={`${idPrefix}_fc`} label={t("يدعم التشخيص", "Supports the diagnosis")} value={draft.condition_id} onChange={(v) => setDraft((d) => ({ ...d, condition_id: v }))}
                opts={linkable.map((c) => ({ value: c.id, ar: c.name, en: c.name }))} lang={lang} blank />
            )}
            <fieldset className="field wide surf-pick" disabled={whole}>
              <legend>{whole ? t("يخص السن كله", "Concerns the whole tooth") : t("الأسطح", "Surfaces")}</legend>
              {SURFACES.map((s) => (
                <label key={s} className={`pill${draft.surfaces.includes(s) ? " on" : ""}`} title={surfaceName(s, selected, lang)}>
                  <input type="checkbox" checked={draft.surfaces.includes(s)} onChange={() => toggleSurface(selected, s)} />
                  <span className="ltr">{surfaceCode(s, selected)}</span> {surfaceName(s, selected, lang)}
                </label>
              ))}
            </fieldset>
            <div className="field wide"><label htmlFor={`${idPrefix}_fn`}>{t("ملاحظة", "Note")}</label>
              <input id={`${idPrefix}_fn`} value={draft.notes} maxLength={2000} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} /></div>
          </div>
          <div><button type="button" className="btn" onClick={addFinding}><Plus size={16} aria-hidden="true" />{t("أضف إلى هذا السن", "Add to this tooth")}</button></div>
        </section>
      )}

      <section aria-label={t("ما سيُحفظ", "What will be saved")}>
        <h3>{t("ما سيُحفظ في هذا الفحص", "What this exam will save")}</h3>
        {stateList.length === 0 && findings.length === 0 ? <p className="muted small">{t("لم يُسجّل شيء بعد.", "Nothing recorded yet.")}</p> : (
          <ul className="exam-summary">
            {[...byStatus.entries()].map(([st, list]) => (
              <li key={st}><strong>{lbl(TOOTH_STATUS, st, lang)}:</strong> <span className="ltr">{list.join(", ")}</span></li>
            ))}
            {findings.map((f) => (
              <li key={f.key} className="row between">
                <span><span className="ltr">{f.tooth}{f.surfaces.length ? ` ${fmtSurfaces(f.surfaces, f.tooth)}` : ""}</span> — {lbl(FINDING_KIND, f.kind, lang)}
                  {f.material && ` (${lbl(MATERIAL, f.material, lang)})`} · <span className="muted">{lbl(EVIDENCE, f.evidence, lang)}</span></span>
                <button type="button" className="btn ghost sm" onClick={() => setFindings((fs) => fs.filter((x) => x.key !== f.key))}
                  aria-label={t(`حذف ${f.tooth} من المسودة`, `Remove ${f.tooth} from the draft`)}><Trash2 size={14} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="field"><label htmlFor={`${idPrefix}_notes`}>{t("ملاحظات الفحص", "Exam notes")}</label>
        <textarea id={`${idPrefix}_notes`} name="notes" rows={2} maxLength={4000} /></div>
      <div><SubmitButton pending={t("جارٍ الحفظ…", "Saving…")}>{t("حفظ الفحص", "Save the exam")}</SubmitButton></div>
      <div aria-live="polite">
        {state?.error && <p className={`form-msg ${state.confirm ? "warn" : "err"}`} role="alert">{state.error}</p>}
        {state?.confirm && <label className="form-confirm"><input type="checkbox" name={state.confirm.name} />{state.confirm.label}</label>}
        {state?.ok && state.message && <p className="form-msg ok">{state.message}</p>}
      </div>
    </form>
  );
}
