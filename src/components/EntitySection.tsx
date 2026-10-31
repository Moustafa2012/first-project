import { Pencil, Plus, Eraser } from "lucide-react";
import { appliesToSex, forSex } from "@/lib/sex";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getPatient, getSpecialties, specialtyName } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtDate, fmtDateTime, fmtPartialDate } from "@/lib/format";
import { lbl, SOURCE, VERIFICATION } from "@/lib/labels";
import type { EntityDef, FormContext } from "@/lib/entities";
import { nextStatuses, STATUS_MODEL, statusLabel } from "@/lib/status";
import { localDate } from "@/lib/format";
import type { Row } from "@/lib/types";
import { Chip, Empty, KV } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/ui/client";
import { EntityForm } from "@/components/EntityForm";
import { invalidateEntity, setRecordStatus } from "@/app/actions/entities";

interface Props {
  entity: EntityDef;
  pid: string;
  returnPath: string;
  title?: React.ReactNode;
  /** only rows matching these column=value pairs (e.g. specialty_id, encounter_id) */
  filter?: Record<string, string | boolean | string[]>;
  /** links stored on newly created rows (e.g. encounter_id); also preselects form defaults */
  links?: Record<string, string>;
  defaults?: Record<string, string>;
  limit?: number;
  openForm?: boolean;
  compact?: boolean;
  id?: string;
  /** shown instead of "No records yet" (e.g. a "none known" statement) */
  empty?: React.ReactNode;
  /** the add button's wording in this context (default: "Add <singular>") */
  addLabel?: string;
  /** where the forms are opened from (fixed values, dental-only fields, narrowed choices) */
  context?: FormContext;
}

export async function EntitySection({ entity, pid, returnPath, title, filter = {}, links = {}, defaults = {}, limit = 200, openForm = false, compact = false, id, empty, addLabel, context }: Props) {
  const { lang, t } = i18n();
  const tz = getTz();
  const [access, specialties, patient] = await Promise.all([getAccess(pid), getSpecialties(), getPatient(pid)]);
  const formSpecialties = forSex(specialties, patient.sex);
  let q = createClient().from(entity.table).select("*").eq("patient_id", pid);
  for (const [k, v] of Object.entries(filter)) q = Array.isArray(v) ? q.in(k, v) : q.eq(k, v);
  const { data, error } = await q.order(entity.order[0], { ascending: entity.order[1] === "asc", nullsFirst: false }).limit(limit);
  const rows = (data ?? []) as Row[];
  // the status history of these records (diagnoses, medications, allergies)
  const model = STATUS_MODEL[entity.table];
  type Hist = { record_id: string; field: string; from_value: string | null; to_value: string; effective_date: string | null; reason: string | null; changed_at: string };
  const history = new Map<string, Hist[]>();
  if (model && rows.length) {
    const { data: hs } = await createClient().from("status_history").select("record_id, field, from_value, to_value, effective_date, reason, changed_at")
      .eq("patient_id", pid).eq("table_name", entity.table).in("record_id", rows.map((r) => r.id)).order("changed_at");
    for (const h of (hs ?? []) as Hist[]) history.set(h.record_id, [...(history.get(h.record_id) ?? []), h]);
  }
  const today = localDate(new Date(), tz);
  const live = rows.filter((r) => r.record_status !== "entered_in_error");
  const dead = rows.filter((r) => r.record_status === "entered_in_error");
  const singular = lang === "ar" ? entity.singular.ar : entity.singular.en;

  const fmt = (r: Row) => {
    const v = entity.dateOf?.(r) ?? null;
    if (!v) return entity.datePrecision ? t("التاريخ غير معروف", "Date unknown") : "";
    if (entity.dateKind === "datetime") return fmtDateTime(v, lang, tz);
    return entity.datePrecision ? fmtPartialDate(v, r[entity.datePrecision], lang, tz) : fmtDate(v, lang, tz);
  };

  const card = (r: Row, isDead = false) => {
    const chips = entity.chipsOf?.(r, lang) ?? [];
    const chipTexts = new Set(chips.map((c) => c.text));
    const body = entity.bodyField ? (r[entity.bodyField] as string | null) : null;
    const kv: [string, React.ReactNode][] = entity.fields
      .filter((fd) => fd.name !== entity.bodyField && fd.kind !== "specialty" && fd.kind !== "checkbox")
      .map((fd): [string, React.ReactNode] => {
        const raw = r[fd.name];
        if (raw == null || raw === "") return [lang === "ar" ? fd.ar : fd.en, null];
        let shown: string;
        if (fd.kind === "select") shown = lbl(fd.options!, String(raw), lang);
        else if (fd.kind === "date") shown = fd.precision ? fmtPartialDate(String(raw), r[fd.precision], lang, tz) : fmtDate(String(raw), lang, tz);
        else if (fd.kind === "datetime") shown = fmtDateTime(String(raw), lang, tz);
        else shown = String(raw);
        if (fd.kind === "select" && chipTexts.has(shown)) return [lang === "ar" ? fd.ar : fd.en, null];
        if (fd.name === entity.fields[0].name && entity.titleOf(r, lang).includes(shown)) return [lang === "ar" ? fd.ar : fd.en, null];
        return [lang === "ar" ? fd.ar : fd.en, shown];
      });
    const spec = specialtyName(specialties, r.specialty_id as string | null, lang);
    const verification = String(r.verification ?? "reported");
    return (
      <article key={r.id} className={`rec${isDead ? " error" : ""}`}>
        <div className="row between">
          <div className="row" style={{ gap: ".4rem" }}>
            <span className="rec-title">{entity.titleOf(r, lang) || "—"}</span>
            {chips.map((c, i) => <Chip key={i} tone={c.tone}>{c.text}</Chip>)}
            {spec && <Chip tone="info">{spec}</Chip>}
            {isDead && <Chip tone="bad">{t("أُبطل", "Invalidated")}</Chip>}
            {r.contributed_by ? <Chip tone="info">{t("أضافه طبيب", "Added by a doctor")}</Chip> : null}
          </div>
          <span className="muted small nowrap">{fmt(r)}</span>
        </div>
        {body && <p className="rec-body">{body}</p>}
        {!compact && <KV items={kv} />}
        <div className="rec-meta">
          <span>{t("سُجّل في", "Entered")} {fmtDate(String(r.recorded_at), lang, tz)} · {r.contributed_by ? t("بواسطة طبيب عبر رابط مشاركة", "by a doctor through a share link") : r.recorded_by === access.userId ? t("بواسطتك", "by you") : r.recorded_by ? t("بواسطة مستخدم آخر", "by another user") : t("استيراد / النظام", "import / system")}</span>
          <span>{t("المصدر", "Source")}: {lbl(SOURCE, String(r.source ?? "self"), lang)}{r.source_detail ? ` (${String(r.source_detail)})` : ""}</span>
          <Chip tone={verification === "reported" ? "muted" : "ok"}>{lbl(VERIFICATION, verification, lang)}</Chip>
        </div>
        {isDead && <p className="small muted">{t("سبب الإبطال", "Reason")}: {String(r.invalidated_reason ?? "")}</p>}
        {model && (() => {
          // the first entry of the main status opens the history; later entries are the changes
          const hs = (history.get(r.id) ?? []).filter((h) => h.from_value != null || h.field === model.field);
          const changes = hs.filter((h) => h.from_value != null).length;
          if (!changes) return null;
          return (
          <details className="status-hist">
            <summary className="small">{t(`سجل الحالة (${changes} تغيير)`, `Status history (${changes} change${changes > 1 ? "s" : ""})`)}</summary>
            <ol className="small">{hs.map((h, i) => (
              <li key={i}><span className="muted">{fmtDate(h.effective_date ?? h.changed_at, lang, tz)}</span>{" — "}
                {h.from_value == null ? t(`سُجّل «${statusLabel(h.field, h.to_value, lang, entity.table)}»`, `recorded as “${statusLabel(h.field, h.to_value, lang, entity.table)}”`)
                  : t(`من «${statusLabel(h.field, h.from_value, lang, entity.table)}» إلى «${statusLabel(h.field, h.to_value, lang, entity.table)}»`,
                      `${statusLabel(h.field, h.from_value, lang, entity.table)} → ${statusLabel(h.field, h.to_value, lang, entity.table)}`)}
                {h.reason && <span> — {h.reason}</span>}</li>
            ))}</ol>
          </details>
          );
        })()}
        {access.canWrite && !isDead && model && (() => {
          const next = nextStatuses(entity.table, String(r[model.field] ?? ""), { certainty: r.certainty as string | undefined, contributed: Boolean(r.contributed_by) });
          if (!next.length) return null;
          return (
            <details className="fold status-fold no-print" style={{ marginBlockStart: ".5rem" }}>
              <summary>{t("تغيير الحالة", "Change status")} <span className="muted small">({t("الآن", "now")}: {statusLabel(model.field, String(r[model.field]), lang, entity.table)})</span></summary>
              <div className="fold-body">
                <ActionForm action={setRecordStatus} className="row status-form">
                  <input type="hidden" name="_table" value={entity.table} /><input type="hidden" name="_pid" value={pid} />
                  <input type="hidden" name="_id" value={r.id} /><input type="hidden" name="_path" value={returnPath} />
                  <fieldset className="status-pick"><legend className="sr-only">{t("الحالة الجديدة", "New status")}</legend>
                    {next.map((o, i) => <label key={o.value} className="pill"><input type="radio" name="status" value={o.value} required defaultChecked={i === 0} />{o[lang]}</label>)}
                  </fieldset>
                  <label className="small">{t("منذ", "Since")} <input type="date" name="effective_date" defaultValue={today} max={today} /></label>
                  <input name="status_reason" maxLength={500} placeholder={t("السبب أو كيف (اختياري)", "Reason or how (optional)")} aria-label={t("سبب تغيير الحالة", "Reason for the change")} style={{ flex: 1, minWidth: 180 }} />
                  <SubmitButton className="btn sm primary">{t("حفظ الحالة", "Save status")}</SubmitButton>
                </ActionForm>
              </div>
            </details>
          );
        })()}
        {access.canWrite && !isDead && (
          <div className="row no-print" style={{ marginBlockStart: ".5rem" }}>
            {r.contributed_by ? (
              <p className="small muted" style={{ flex: "1 1 100%", margin: 0 }}>{t("أضافه طبيب عبر رابط مشاركة: لا يُعدَّل محتواه، ويمكن إبطاله.", "Added by a doctor through a share link: its content is not edited, but it can be invalidated.")}</p>
            ) : (
              <details className="fold" style={{ flex: "1 1 100%" }}>
                <summary><Pencil size={14} aria-hidden="true" />{t("تعديل", "Edit")}</summary>
                <div className="fold-body"><EntityForm entity={entity} pid={pid} row={r} specialties={formSpecialties} returnPath={returnPath} links={links} context={context} /></div>
              </details>
            )}
            <details className="fold" style={{ flex: "1 1 100%" }}>
              <summary><Eraser size={14} aria-hidden="true" />{t("أُدخل بالخطأ", "Entered in error")}</summary>
              <div className="fold-body">
                <p className="small muted">{t("لا يُحذف السجل؛ يبقى في التاريخ مع السبب ومن أبطله.", "The record is not deleted; it stays in the history with the reason and who invalidated it.")}</p>
                <ActionForm action={invalidateEntity} className="row">
                  <input type="hidden" name="_slug" value={entity.slug} /><input type="hidden" name="_pid" value={pid} />
                  <input type="hidden" name="_id" value={r.id} /><input type="hidden" name="_path" value={returnPath} />
                  <input name="reason" type="text" required minLength={3} maxLength={500} placeholder={t("السبب", "Reason")} aria-label={t("السبب", "Reason")} style={{ flex: 1, minWidth: 180 }} />
                  <ConfirmButton message={t("إبطال هذا السجل؟", "Invalidate this record?")}>{t("إبطال", "Invalidate")}</ConfirmButton>
                </ActionForm>
              </div>
            </details>
          </div>
        )}
      </article>
    );
  };

  return (
    <section className="card" id={id} aria-label={String(title ?? (lang === "ar" ? entity.ar : entity.en))}>
      <div className="card-head">
        <h2>{title ?? (lang === "ar" ? entity.ar : entity.en)} <span className="muted small">({live.length})</span></h2>
      </div>
      {error && <p className="form-msg err">{t("تعذر تحميل السجلات.", "Could not load the records.")}</p>}
      {access.canWrite && (
        <details className="fold no-print" open={openForm} style={{ marginBlockEnd: ".9rem" }}>
          <summary><Plus size={16} aria-hidden="true" />{addLabel ?? t(`إضافة ${singular}`, `Add ${singular}`)}</summary>
          <div className="fold-body"><EntityForm entity={entity} pid={pid} specialties={formSpecialties} returnPath={returnPath} links={links} defaults={defaults} context={context} /></div>
        </details>
      )}
      {live.length === 0 ? (empty ?? <Empty>{t("لا توجد سجلات بعد.", "No records yet.")}</Empty>) : live.map((r) => card(r))}
      {dead.length > 0 && (
        <details style={{ marginBlockStart: ".9rem" }}>
          <summary className="muted small">{t(`سجلات مُبطلة (${dead.length})`, `Invalidated records (${dead.length})`)}</summary>
          <div style={{ marginBlockStart: ".5rem" }}>{dead.map((r) => card(r, true))}</div>
        </details>
      )}
    </section>
  );
}
