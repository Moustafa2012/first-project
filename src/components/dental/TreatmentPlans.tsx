import { ClipboardList, FileDown, GitBranch, Plus, Printer, Scissors } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { fmtPartialDate } from "@/lib/format";
import { SURFACES, fmtSurfaces, surfaceCode, surfaceName } from "@/lib/dental";
import {
  COST_KIND, CURRENCIES, ITEM_STATUS, OPEN_ITEM, OPEN_PLAN, PLAN_NEXT, PLAN_STATUS, PROC_CATEGORY, byPhase, costTotals, fmtMoney, itemNext, planProgress,
  type CatalogItem, type TreatmentCost, type TreatmentPlan,
} from "@/lib/treatment";
import { lbl } from "@/lib/labels";
import { Chip, Empty } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton, type FormAction } from "@/components/ui/client";
import { TreatmentStatusForm } from "./TreatmentStatus";

/** What the viewer may do: the patient manages everything; a clinician through a share moves treatments along and notes their own cost. */
export interface TreatmentActions {
  hidden: Record<string, string>;
  status: FormAction;
  clinician?: boolean;
  planStatus?: FormAction;
  newVersion?: FormAction;
  createPlan?: FormAction;
  addItem?: FormAction;
  addCost?: FormAction;
  invalidate?: FormAction;
  pdfHref?: (planId: string) => string;
}
export interface ProblemRef { id: string; name: string; teeth: number[] | null }

const tone = (s: string) => (s === "completed" ? "ok" : s === "cancelled" || s === "declined" || s === "superseded" ? "muted" : s === "in_progress" || s === "scheduled" ? "info" : s === "accepted" ? "ok" : "warn");

/** The treatment form: a catalogue procedure (grouped) or a name, the teeth (unless the chart gives the tooth), surfaces, the problem, the phase. */
export function TreatmentItemForm({
  action, hidden, catalog, problems, lang, idPrefix, formId, plans, externalTeeth, submitLabel,
}: {
  action: FormAction; hidden: Record<string, string>; catalog: CatalogItem[]; problems: ProblemRef[]; lang: Lang; idPrefix: string; formId?: string;
  /** offered plans (an open plan, or "a new plan"); omitted when the plan is fixed in `hidden._plan` */
  plans?: { id: string; title: string }[]; externalTeeth?: boolean; submitLabel?: string;
}) {
  const ar = lang === "ar";
  const t = (a: string, e: string) => (ar ? a : e);
  return (
    <ActionForm action={action} className="stack" id={formId}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="form-grid">
        {plans && (
          <div className="field"><label htmlFor={`${idPrefix}-plan`}>{t("ضمن خطة", "In plan")}</label>
            <select id={`${idPrefix}-plan`} name="_plan" defaultValue={plans[0]?.id ?? "new"}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              <option value="new">{t("خطة جديدة", "A new plan")}</option>
            </select></div>
        )}
        <div className="field wide"><label htmlFor={`${idPrefix}-code`}>{t("الإجراء", "Procedure")}</label>
          <select id={`${idPrefix}-code`} name="catalog_code" defaultValue="">
            <option value="">{t("— اختر من القائمة، أو اكتب الاسم أدناه —", "— choose from the list, or type the name below —")}</option>
            {PROC_CATEGORY.map((c) => {
              const list = catalog.filter((x) => x.category === c.value);
              return list.length ? (
                <optgroup key={c.value} label={c[lang]}>
                  {list.map((x) => <option key={x.code} value={x.code}>{ar ? x.name_ar : x.name_en}{x.surgical ? t(" (جراحي)", " (surgical)") : ""}</option>)}
                </optgroup>) : null;
            })}
          </select></div>
        <div className="field"><label htmlFor={`${idPrefix}-name`}>{t("أو اسم آخر", "Or another name")}</label><input id={`${idPrefix}-name`} name="name" maxLength={200} /></div>
        {!externalTeeth && (
          <div className="field"><label htmlFor={`${idPrefix}-teeth`}>{t("الأسنان (FDI)", "Teeth (FDI)")}</label>
            <input id={`${idPrefix}-teeth`} name="teeth" inputMode="numeric" placeholder={t("مثل: 16 أو 36، 37", "e.g. 16 or 36, 37")} dir="ltr" /></div>
        )}
        <fieldset className="field wide surf-pick"><legend>{t("الأسطح (للحشوات، سن واحد)", "Surfaces (fillings, one tooth)")}</legend>
          {SURFACES.map((s) => <label key={s} className="pill"><input type="checkbox" name="surfaces" value={s} /><span className="ltr">{surfaceCode(s, 16)}</span> {surfaceName(s, 16, lang)}</label>)}
        </fieldset>
        {problems.length > 0 && (
          <div className="field"><label htmlFor={`${idPrefix}-cond`}>{t("يعالج المشكلة", "Treats the problem")}</label>
            <select id={`${idPrefix}-cond`} name="condition_id" defaultValue={problems.length === 1 ? problems[0].id : ""}>
              <option value="">—</option>
              {problems.map((p) => <option key={p.id} value={p.id}>{p.name}{p.teeth?.length ? ` (${p.teeth.join("، ")})` : ""}</option>)}
            </select></div>
        )}
        <div className="field"><label htmlFor={`${idPrefix}-phase`}>{t("المرحلة / الترتيب", "Phase / order")}</label>
          <input id={`${idPrefix}-phase`} name="phase" type="number" min={1} max={20} defaultValue={1} /></div>
        <div className="field wide"><label htmlFor={`${idPrefix}-notes`}>{t("ملاحظة", "Note")}</label><input id={`${idPrefix}-notes`} name="notes" maxLength={2000} /></div>
      </div>
      <div><SubmitButton>{submitLabel ?? t("إضافة العلاج", "Add the treatment")}</SubmitButton></div>
    </ActionForm>
  );
}

export function TreatmentPlans({
  plans, costs = [], catalog, problems, actions, lang, today, contributors = {},
}: {
  plans: TreatmentPlan[]; costs?: TreatmentCost[]; catalog: CatalogItem[]; problems: ProblemRef[]; actions: TreatmentActions; lang: Lang; today: string;
  contributors?: Record<string, string>;
}) {
  const ar = lang === "ar";
  const t = (a: string, e: string) => (ar ? a : e);
  const itemLabels = Object.fromEntries(ITEM_STATUS.map((s) => [s.value, s[lang]]));
  const planLabels = Object.fromEntries(PLAN_STATUS.map((s) => [s.value, s[lang]]));
  const day = (v: string | null) => (v ? fmtPartialDate(v, "day", lang) : "");
  const probName = (id: string | null) => problems.find((p) => p.id === id)?.name;
  const current = plans.filter((p) => OPEN_PLAN.has(p.status));
  const past = plans.filter((p) => !OPEN_PLAN.has(p.status));
  const titleOf = (id: string | null) => plans.find((p) => p.id === id)?.title;
  const h = actions.hidden;

  const planCard = (p: TreatmentPlan) => {
    const prog = planProgress(p.items);
    const open = OPEN_PLAN.has(p.status);
    const { byItem, totals } = costTotals(p.items, costs);
    const hasSurgical = p.items.some((i) => i.surgical && OPEN_ITEM.has(i.status));
    return (
      <article className={`plan-card${open ? "" : " closed"}`} key={p.id} id={`plan-${p.id}`}>
        <div className="row between">
          <div>
            <h3 style={{ margin: 0 }}><ClipboardList size={17} aria-hidden="true" /> {p.title}
              {" "}<Chip tone={tone(p.status)}>{planLabels[p.status] ?? p.status}</Chip>
              {p.version > 1 && <Chip tone="muted">{t(`النسخة ${p.version}`, `Version ${p.version}`)}</Chip>}
              {p.contributed_by && <Chip tone="info">{t(`اقترحها ${contributors[p.contributed_by] ?? "طبيب"} عبر رابط`, `Proposed by ${contributors[p.contributed_by] ?? "a doctor"} via a link`)}</Chip>}</h3>
            <p className="small muted" style={{ margin: ".2rem 0 0" }}>
              {[p.presented_by && t(`المقترِح: ${p.presented_by}`, `Proposed by: ${p.presented_by}`), p.presented_on && day(p.presented_on),
                p.accepted_on && t(`اعتُمدت ${day(p.accepted_on)}`, `accepted ${day(p.accepted_on)}`),
                p.alternative_of && t(`بديل عن: ${titleOf(p.alternative_of) ?? "خطة أخرى"}`, `Alternative to: ${titleOf(p.alternative_of) ?? "another plan"}`)].filter(Boolean).join(" · ")}
            </p>
          </div>
          {actions.pdfHref && (
            <span className="row" style={{ gap: ".3rem" }}>
              <a className="btn sm" href={actions.pdfHref(p.id)} target="_blank" rel="noopener"><Printer size={14} aria-hidden="true" />{t("طباعة الخطة والموافقة", "Print plan & consent")}</a>
              {totals.length > 0 && <a className="small" href={`${actions.pdfHref(p.id)}?costs=1`} target="_blank" rel="noopener">{t("مع التكاليف", "with costs")}</a>}
            </span>
          )}
        </div>
        <div className="plan-progress" role="img" aria-label={t(`التقدم: ${prog.done} من ${prog.total}`, `Progress: ${prog.done} of ${prog.total}`)}>
          <div className="bar"><span style={{ inlineSize: `${prog.pct}%` }} /></div>
          <span className="small">{t(`منجز ${prog.done} من ${prog.total}`, `${prog.done} of ${prog.total} done`)} ({prog.pct}%)</span>
        </div>
        {p.notes && <p className="small">{p.notes}</p>}

        {p.items.length === 0 ? <Empty>{t("لا علاجات في هذه الخطة بعد.", "No treatments in this plan yet.")}</Empty> : byPhase(p.items).map(([phase, list]) => (
          <div key={phase} className="plan-phase">
            <h4>{t(`المرحلة ${phase}`, `Phase ${phase}`)}</h4>
            <ul className="tooth-list">
              {list.map((i) => {
                const next = open ? itemNext(i.status, actions.clinician) : [];
                const cost = byItem.get(i.id);
                return (
                  <li key={i.id} className={`treat-item st-${i.status}`} data-item={i.id}>
                    <div className="row between">
                      <span>
                        {i.teeth?.length ? <strong className="ltr">{i.teeth.join("، ")}{i.surfaces?.length && i.teeth.length === 1 ? ` ${fmtSurfaces(i.surfaces, i.teeth[0])}` : ""}</strong> : null}
                        {i.teeth?.length ? " — " : ""}<strong>{i.name}</strong>
                        {i.surgical && <Chip tone="warn"><Scissors size={12} aria-hidden="true" /> {t("جراحي", "Surgical")}</Chip>}
                        {" "}<Chip tone={tone(i.status)}>{itemLabels[i.status] ?? i.status}</Chip>
                        {i.contributed_by && <Chip tone="info">{t("من الطبيب عبر رابط", "From the doctor via a link")}</Chip>}
                      </span>
                      {cost && <span className="small nowrap">{fmtMoney(cost.amount, cost.currency, lang)} <span className="muted">· {lbl(COST_KIND, cost.kind, lang)}</span></span>}
                    </div>
                    <div className="small muted">
                      {[probName(i.condition_id) && t(`يعالج: ${probName(i.condition_id)}`, `Treats: ${probName(i.condition_id)}`),
                        i.status === "scheduled" && i.scheduled_for && t(`الموعد ${day(i.scheduled_for)}`, `on ${day(i.scheduled_for)}`),
                        i.completed_on && t(`أُنجز ${day(i.completed_on)}`, `done ${day(i.completed_on)}`),
                        i.status_reason, i.notes].filter(Boolean).join(" · ")}
                    </div>
                    {(next.length > 0 || (actions.addCost && i.status !== "cancelled")) && (
                      <div className="row" style={{ gap: ".4rem" }}>
                        {next.length > 0 && (
                          <details className="fold"><summary>{t("تغيير الحالة", "Change status")}</summary><div className="fold-body">
                            <TreatmentStatusForm action={actions.status} hidden={{ ...h, _id: i.id }} next={next} labels={itemLabels} surgical={i.surgical}
                              lang={lang} today={today} idPrefix={`ts-${i.id.slice(0, 8)}`} />
                          </div></details>
                        )}
                        {actions.addCost && i.status !== "cancelled" && (
                          <details className="fold"><summary>{cost ? t("تحديث التكلفة", "Update the cost") : t("إضافة تكلفة", "Add a cost")}</summary><div className="fold-body">
                            <ActionForm action={actions.addCost} className="row">
                              {Object.entries({ ...h, _id: i.id }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                              <input name="amount" required inputMode="decimal" placeholder={t("المبلغ", "Amount")} aria-label={t("المبلغ", "Amount")} style={{ inlineSize: "8rem" }} dir="ltr" />
                              <select name="currency" defaultValue={cost?.currency ?? "SAR"} aria-label={t("العملة", "Currency")}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
                              <select name="kind" defaultValue="estimate" aria-label={t("النوع", "Kind")}>{COST_KIND.map((k) => <option key={k.value} value={k.value}>{k[lang]}</option>)}</select>
                              <input name="note" maxLength={300} placeholder={t("ملاحظة", "Note")} aria-label={t("ملاحظة", "Note")} style={{ flex: 1, minWidth: 120 }} />
                              <SubmitButton className="btn sm">{t("حفظ", "Save")}</SubmitButton>
                            </ActionForm>
                            <p className="small muted" style={{ margin: ".3rem 0 0" }}>{actions.clinician
                              ? t("تكلفتك تظهر لك وللمريض فقط.", "Your cost is visible to you and the patient only.")
                              : t("التكاليف خاصة بك: لا تظهر في أي مشاركة.", "Costs are private: never included in a share.")}</p>
                          </div></details>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {totals.length > 0 && (
          <p className="small plan-total">{t("المجموع", "Total")}: {totals.map((x) => `${fmtMoney(x.amount, x.currency, lang)}${x.done ? t(` (منها منجز ${fmtMoney(x.done, x.currency, lang)})`, ` (${fmtMoney(x.done, x.currency, lang)} done)`) : ""}`).join(" · ")}
            <span className="muted"> — {t("لكل عملة على حدة.", "per currency, never mixed.")}</span></p>
        )}

        {open && (
          <div className="row" style={{ gap: ".4rem", marginBlockStart: ".5rem" }}>
            {actions.addItem && (
              <details className="fold"><summary><Plus size={14} aria-hidden="true" /> {t("إضافة علاج إلى هذه الخطة", "Add a treatment to this plan")}</summary><div className="fold-body">
                <TreatmentItemForm action={actions.addItem} hidden={{ ...h, _plan: p.id }} catalog={catalog} problems={problems} lang={lang} idPrefix={`ti-${p.id.slice(0, 8)}`} />
              </div></details>
            )}
            {actions.planStatus && (PLAN_NEXT[p.status] ?? []).length > 0 && (
              <details className="fold"><summary>{t("اعتماد / حالة الخطة", "Accept / plan status")}</summary><div className="fold-body">
                <TreatmentStatusForm action={actions.planStatus} hidden={{ ...h, _id: p.id }} next={PLAN_NEXT[p.status]} labels={planLabels} surgical={hasSurgical}
                  lang={lang} today={today} idPrefix={`ps-${p.id.slice(0, 8)}`} withDate={false} />
              </div></details>
            )}
            {actions.newVersion && (
              <details className="fold"><summary><FileDown size={14} aria-hidden="true" /> {t("نسخة جديدة", "New version")}</summary><div className="fold-body">
                <ActionForm action={actions.newVersion} className="row">
                  {Object.entries({ ...h, _id: p.id }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                  <input name="reason" maxLength={500} placeholder={t("سبب التعديل (مثلاً: تغيّر السعر)", "Why (e.g. the price changed)")} aria-label={t("السبب", "Reason")} style={{ flex: 1, minWidth: 180 }} />
                  <SubmitButton className="btn sm">{t("إنشاء نسخة جديدة", "Create a new version")}</SubmitButton>
                </ActionForm>
                <p className="small muted" style={{ margin: ".3rem 0 0" }}>{t("تنتقل العلاجات غير المنجزة إلى النسخة الجديدة مقترحةً، وتبقى هذه النسخة محفوظة.", "Treatments not yet done move to the new version as proposals; this version is kept.")}</p>
              </div></details>
            )}
            {actions.createPlan && (
              <details className="fold"><summary><GitBranch size={14} aria-hidden="true" /> {t("خيار بديل", "An alternative")}</summary><div className="fold-body">
                <TreatmentItemForm action={actions.createPlan} hidden={{ ...h, alternative_of: p.id, title: t(`بديل: ${p.title}`, `Alternative: ${p.title}`) }}
                  catalog={catalog} problems={problems} lang={lang} idPrefix={`ta-${p.id.slice(0, 8)}`} submitLabel={t("إنشاء الخيار البديل", "Create the alternative")} />
                <p className="small muted" style={{ margin: ".3rem 0 0" }}>{t("اعتماد أحد الخيارين يجعل الآخر «غير معتمد».", "Accepting one option declines the other.")}</p>
              </div></details>
            )}
            {actions.invalidate && !p.contributed_by && (
              <details className="fold"><summary>{t("أُدخلت خطأً", "Entered in error")}</summary><div className="fold-body">
                <ActionForm action={actions.invalidate} className="row">
                  {Object.entries({ ...h, _id: p.id, _table: "treatment_plans" }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                  <input name="reason" required minLength={3} maxLength={500} placeholder={t("السبب", "Reason")} aria-label={t("السبب", "Reason")} style={{ flex: 1, minWidth: 160 }} />
                  <ConfirmButton message={t("إبطال الخطة وعلاجاتها؟ تبقى في السجل مع السبب.", "Invalidate the plan and its treatments? They stay in the history with the reason.")}>{t("إبطال", "Invalidate")}</ConfirmButton>
                </ActionForm>
              </div></details>
            )}
          </div>
        )}
      </article>
    );
  };

  return (
    <div className="stack">
      {actions.createPlan && (
        <details className="fold" id="new-plan">
          <summary><Plus size={14} aria-hidden="true" /> {t("خطة علاج جديدة", "New treatment plan")}</summary>
          <div className="fold-body">
            <ActionForm action={actions.createPlan} className="stack">
              {Object.entries(h).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <div className="form-grid">
                <div className="field wide"><label htmlFor="np-title">{t("عنوان الخطة", "Plan title")}</label>
                  <input id="np-title" name="title" maxLength={200} placeholder={t("مثلاً: علاج الأسنان الخلفية", "e.g. Back teeth treatment")} /></div>
                <div className="field"><label htmlFor="np-by">{t("اقترحها (الطبيب)", "Proposed by (dentist)")}</label><input id="np-by" name="presented_by" maxLength={200} /></div>
                <div className="field wide"><label htmlFor="np-notes">{t("ملاحظات", "Notes")}</label><input id="np-notes" name="plan_notes" maxLength={4000} /></div>
              </div>
              <p className="small muted" style={{ margin: 0 }}>{t("تبدأ الخطة مسودة؛ أضف العلاجات إليها، أو من لوحة السن في المخطط.", "The plan starts as a draft; add treatments to it here or from a tooth's panel on the chart.")}</p>
              <div><SubmitButton>{t("إنشاء الخطة", "Create the plan")}</SubmitButton></div>
            </ActionForm>
          </div>
        </details>
      )}
      {current.length === 0 ? <Empty>{t("لا خطة علاج حالية.", "No current treatment plan.")}</Empty> : current.map(planCard)}
      {past.length > 0 && (
        <details className="fold" id="past-plans">
          <summary>{t(`الخطط السابقة والمستبدلة (${past.length})`, `Past and superseded plans (${past.length})`)}</summary>
          <div className="fold-body stack">{past.map(planCard)}</div>
        </details>
      )}
    </div>
  );
}
