import { BellRing, CalendarClock, CheckCircle2 } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { fmtPartialDate } from "@/lib/format";
import { lbl, RECALL_KIND, RECALL_STATUS } from "@/lib/labels";
import { addMonths, dueState, type FollowUp, type Recall } from "@/lib/followups";
import { Chip, Empty } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { addRecall, recallDone, setRecallStatus } from "@/app/actions/recalls";

const tone = (s: string) => (s === "overdue" ? "bad" : s === "due_soon" ? "warn" : s === "undated" ? "info" : "muted");

/** The list of what is waiting (most urgent first). */
export function PendingList({ items, lang, empty }: { items: FollowUp[]; lang: Lang; empty?: string }) {
  const t = (a: string, e: string) => (lang === "ar" ? a : e);
  const stateLabel: Record<string, string> = { overdue: t("متأخر", "Overdue"), due_soon: t("قريب", "Due soon"), upcoming: t("قادم", "Upcoming"), undated: t("بلا موعد", "No date") };
  if (!items.length) return <Empty>{empty ?? t("لا شيء معلّق.", "Nothing pending.")}</Empty>;
  return (
    <ul className="tooth-list followups">
      {items.map((f) => (
        <li key={f.key} className={`fu fu-${f.state}`}>
          <div className="row between">
            <span>{f.href ? <a href={f.href}><strong>{f.title}</strong></a> : <strong>{f.title}</strong>}{f.detail && <span className="muted small"> · {f.detail}</span>}</span>
            <span className="row" style={{ gap: ".3rem" }}>{f.date && <span className="small nowrap">{fmtPartialDate(f.date.slice(0, 10), "day", lang)}</span>}<Chip tone={tone(f.state)}>{stateLabel[f.state]}</Chip></span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Recalls: what repeats, when it is due, "done today", pause / stop, and a new one. */
export function RecallList({ recalls, pid, specialtyId, canWrite, lang, today }: { recalls: Recall[]; pid: string; specialtyId?: string | null; canWrite: boolean; lang: Lang; today: string }) {
  const t = (a: string, e: string) => (lang === "ar" ? a : e);
  const day = (v: string | null) => (v ? fmtPartialDate(v, "day", lang) : "—");
  const name = (r: Recall) => (r.kind === "other" ? r.label ?? "" : lbl(RECALL_KIND, r.kind, lang)) + (r.kind !== "other" && r.label ? ` — ${r.label}` : "");
  const live = recalls.filter((r) => r.status !== "stopped"), stopped = recalls.filter((r) => r.status === "stopped");
  const row = (r: Recall) => {
    const st = r.status === "active" ? dueState(r.due_on, today) : null;
    return (
      <li key={r.id} className={`recall${st ? ` fu-${st}` : ""}`} data-recall={r.kind}>
        <div className="row between">
          <span><BellRing size={14} aria-hidden="true" /> <strong>{name(r)}</strong> <span className="muted small">· {t(`كل ${r.interval_months} أشهر`, `every ${r.interval_months} months`)}</span></span>
          <span className="row" style={{ gap: ".3rem" }}>
            {r.status === "active"
              ? <><span className="small">{t("الموعد", "Due")} {day(r.due_on)}</span><Chip tone={tone(st!)}>{st === "overdue" ? t("متأخر", "Overdue") : st === "due_soon" ? t("قريب", "Due soon") : t("في موعده", "On track")}</Chip></>
              : <Chip tone="muted">{lbl(RECALL_STATUS, r.status, lang)}</Chip>}
          </span>
        </div>
        <div className="small muted">{t("آخر مرة", "Last done")}: {day(r.last_done_on)}{r.notes ? ` · ${r.notes}` : ""}</div>
        {canWrite && (
          <div className="row" style={{ gap: ".4rem" }}>
            {r.status === "active" && (
              <details className="fold"><summary><CheckCircle2 size={14} aria-hidden="true" /> {t("تم", "Done")}</summary><div className="fold-body">
                <ActionForm action={recallDone} className="row">
                  <input type="hidden" name="_pid" value={pid} /><input type="hidden" name="_id" value={r.id} />
                  <label className="small">{t("في", "On")} <input type="date" name="date" defaultValue={today} max={today} /></label>
                  <SubmitButton className="btn sm primary">{t("حفظ", "Save")}</SubmitButton>
                </ActionForm>
                <p className="small muted" style={{ margin: ".3rem 0 0" }}>{t("يُحسب الموعد التالي تلقائياً. وتسجيل فحص دوري أو تنظيف منجز يحدّثه وحده.", "The next date is set automatically. Recording a periodic exam or a completed cleaning also updates it.")}</p>
              </div></details>
            )}
            <ActionForm action={setRecallStatus} className="row">
              <input type="hidden" name="_pid" value={pid} /><input type="hidden" name="_id" value={r.id} />
              <input type="hidden" name="status" value={r.status === "active" ? "paused" : "active"} />
              <SubmitButton className="btn sm ghost">{r.status === "active" ? t("إيقاف مؤقت", "Pause") : t("استئناف", "Resume")}</SubmitButton>
            </ActionForm>
            {r.status !== "stopped" && (
              <ActionForm action={setRecallStatus} className="row">
                <input type="hidden" name="_pid" value={pid} /><input type="hidden" name="_id" value={r.id} /><input type="hidden" name="status" value="stopped" />
                <SubmitButton className="btn sm ghost">{t("إنهاء", "Stop")}</SubmitButton>
              </ActionForm>
            )}
          </div>
        )}
      </li>
    );
  };
  return (
    <div className="stack">
      {live.length === 0 ? <Empty>{t("لا فحوص دورية مسجلة. الشائع: فحص الأسنان كل 6 أشهر، والتنظيف كل 6 أشهر، وصور الأشعة المجنّحة كل 1–2 سنة حسب طبيبك.", "No recalls yet. Common: a dental check-up every 6 months, cleaning every 6 months, bitewing X-rays every 1–2 years as your dentist advises.")}</Empty>
        : <ul className="tooth-list">{live.map(row)}</ul>}
      {stopped.length > 0 && <details className="fold"><summary>{t(`المتوقفة (${stopped.length})`, `Stopped (${stopped.length})`)}</summary><div className="fold-body"><ul className="tooth-list">{stopped.map(row)}</ul></div></details>}
      {canWrite && (
        <details className="fold" id="new-recall" open={live.length === 0}>
          <summary><CalendarClock size={14} aria-hidden="true" /> {t("إضافة فحص دوري", "Add a recall")}</summary>
          <div className="fold-body">
            <ActionForm action={addRecall} className="stack">
              <input type="hidden" name="_pid" value={pid} /><input type="hidden" name="_spec" value={specialtyId ?? ""} />
              <div className="form-grid">
                <div className="field"><label htmlFor="rc-kind">{t("النوع", "Kind")}</label>
                  <select id="rc-kind" name="kind" defaultValue="dental_checkup">{RECALL_KIND.map((k) => <option key={k.value} value={k.value}>{k[lang]}</option>)}</select></div>
                <div className="field"><label htmlFor="rc-label">{t("الاسم (لـ«أخرى»)", "Name (for “Other”)")}</label><input id="rc-label" name="label" maxLength={120} /></div>
                <div className="field"><label htmlFor="rc-int">{t("كل (أشهر)", "Every (months)")}</label><input id="rc-int" name="interval_months" type="number" min={1} max={60} defaultValue={6} required /></div>
                <div className="field"><label htmlFor="rc-due">{t("الموعد القادم", "Next due")}</label><input id="rc-due" name="due_on" type="date" defaultValue={addMonths(today, 6)} required /></div>
                <div className="field wide"><label htmlFor="rc-notes">{t("ملاحظة", "Note")}</label><input id="rc-notes" name="notes" maxLength={1000} /></div>
              </div>
              <div><SubmitButton>{t("إضافة", "Add")}</SubmitButton></div>
            </ActionForm>
          </div>
        </details>
      )}
    </div>
  );
}
