import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { Chip, Empty, KV } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/ui/client";
import { saveSpecialtyRecord } from "@/app/actions/specialty";
import { invalidateEntity } from "@/app/actions/entities";

interface FieldSpec { key: string; type: "text" | "textarea" | "number" | "date" | "select"; required?: boolean; unit?: string; label_ar: string; label_en: string; options?: { value: string; label_ar: string; label_en: string }[] }
interface RT { id: string; code: string; name_ar: string; name_en: string; fields: FieldSpec[] }

export async function SpecialtyRecords({ pid, specialtyId, returnPath }: { pid: string; specialtyId: string; returnPath: string }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const supabase = createClient();
  const [access, { data: rts }, { data: recs }] = await Promise.all([
    getAccess(pid),
    supabase.from("specialty_record_types").select("id, code, name_ar, name_en, fields").eq("specialty_id", specialtyId).eq("is_active", true).order("sort"),
    supabase.from("specialty_records").select("*").eq("patient_id", pid).eq("specialty_id", specialtyId).eq("record_status", "active").order("occurred_on", { ascending: false }).limit(200),
  ]);
  const types = (rts ?? []) as RT[];
  if (types.length === 0) return null;
  const byId = new Map(types.map((x) => [x.id, x]));
  const rows = (recs ?? []) as { id: string; record_type_id: string; occurred_on: string; data: Record<string, unknown>; notes: string | null }[];
  return (
    <section className="card">
      <div className="card-head"><h2>{t("سجلات متخصصة", "Specialty-specific records")} <span className="muted small">({rows.length})</span></h2></div>
      {access.canWrite && types.map((rt) => (
        <details className="fold no-print" key={rt.id} style={{ marginBlockEnd: ".6rem" }}>
          <summary>+ {lang === "ar" ? rt.name_ar : rt.name_en}</summary>
          <div className="fold-body">
            <ActionForm action={saveSpecialtyRecord} className="stack">
              <input type="hidden" name="_pid" value={pid} /><input type="hidden" name="_type" value={rt.id} /><input type="hidden" name="_path" value={returnPath} />
              <div className="form-grid">
                <div className="field"><label>{t("التاريخ", "Date")} <span className="req">*</span></label><input type="date" name="occurred_on" required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
                {rt.fields.map((f) => (
                  <div className={`field${f.type === "textarea" ? " wide" : ""}`} key={f.key}>
                    <label htmlFor={`${rt.id}_${f.key}`}>{lang === "ar" ? f.label_ar : f.label_en}{f.unit ? ` (${f.unit})` : ""}{f.required && <span className="req"> *</span>}</label>
                    {f.type === "select" ? (
                      <select id={`${rt.id}_${f.key}`} name={`f_${f.key}`} required={f.required} defaultValue=""><option value="">—</option>{f.options!.map((o) => <option key={o.value} value={o.value}>{lang === "ar" ? o.label_ar : o.label_en}</option>)}</select>
                    ) : f.type === "textarea" ? <textarea id={`${rt.id}_${f.key}`} name={`f_${f.key}`} rows={2} required={f.required} maxLength={4000} />
                      : <input id={`${rt.id}_${f.key}`} name={`f_${f.key}`} type={f.type === "date" ? "date" : "text"} inputMode={f.type === "number" ? "decimal" : undefined} dir={f.type === "number" ? "ltr" : undefined} required={f.required} />}
                  </div>
                ))}
                <div className="field wide"><label>{t("ملاحظات", "Notes")}</label><textarea name="notes" rows={2} maxLength={4000} /></div>
              </div>
              <div><SubmitButton>{t("حفظ", "Save")}</SubmitButton></div>
            </ActionForm>
          </div>
        </details>
      ))}
      {rows.length === 0 ? <Empty>{t("لا توجد سجلات.", "No records.")}</Empty> : rows.map((r) => {
        const rt = byId.get(r.record_type_id);
        const kv: [string, React.ReactNode][] = (rt?.fields ?? []).map((f) => {
          const v = r.data[f.key];
          if (v == null || v === "") return [lang === "ar" ? f.label_ar : f.label_en, null];
          const shown = f.type === "select" ? (lang === "ar" ? f.options?.find((o) => o.value === v)?.label_ar : f.options?.find((o) => o.value === v)?.label_en) ?? String(v) : f.type === "date" ? fmtDate(String(v), lang, tz) : String(v);
          return [lang === "ar" ? f.label_ar : f.label_en, f.unit ? `${shown} ${f.unit}` : shown];
        });
        return (
          <article className="rec" key={r.id}>
            <div className="row between"><span className="row"><span className="rec-title">{rt ? (lang === "ar" ? rt.name_ar : rt.name_en) : ""}</span><Chip tone="muted">{fmtDate(r.occurred_on, lang, tz)}</Chip></span></div>
            <KV items={kv} />
            {r.notes && <p className="rec-body">{r.notes}</p>}
            {access.canWrite && (
              <ActionForm action={invalidateEntity} className="row no-print" >
                <input type="hidden" name="_slug" value="specialty-records" /><input type="hidden" name="_pid" value={pid} /><input type="hidden" name="_id" value={r.id} /><input type="hidden" name="_path" value={returnPath} />
                <input name="reason" type="text" required minLength={3} placeholder={t("سبب الإبطال", "Reason")} aria-label={t("السبب", "Reason")} style={{ maxWidth: 240 }} />
                <ConfirmButton message={t("إبطال هذا السجل؟", "Invalidate this record?")}>{t("بالخطأ", "In error")}</ConfirmButton>
              </ActionForm>)}
          </article>
        );
      })}
    </section>
  );
}
