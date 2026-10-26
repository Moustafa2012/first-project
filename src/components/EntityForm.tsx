import { i18n, type Lang } from "@/lib/i18n";
import { SOURCE } from "@/lib/labels";
import type { EntityDef, FieldDef } from "@/lib/entities";
import type { Row, Specialty } from "@/lib/types";
import { ActionForm, DateTimeField, SubmitButton } from "@/components/ui/client";
import { saveEntity } from "@/app/actions/entities";

export function FieldInput({ def, value, lang, specialties, prefix }: { def: FieldDef; value: unknown; lang: Lang; specialties: Specialty[]; prefix: string }) {
  const id = `${prefix}_${def.name}`;
  const label = lang === "ar" ? def.ar : def.en;
  const v = value == null ? "" : String(value);
  const wrap = (input: React.ReactNode) => (
    <div className={`field${def.wide ? " wide" : ""}`}>
      <label htmlFor={id}>{label}{def.required && <span className="req" aria-hidden="true"> *</span>}</label>
      {input}
      {def.hint && <span className="hint">{lang === "ar" ? def.hint[0] : def.hint[1]}</span>}
    </div>
  );
  switch (def.kind) {
    case "textarea":
      return wrap(<textarea id={id} name={def.name} defaultValue={v} rows={def.rows ?? 3} required={def.required} maxLength={def.maxLength ?? 4000} />);
    case "select":
      return wrap(
        <select id={id} name={def.name} defaultValue={v || (typeof def.dflt === "string" ? def.dflt : "")} required={def.required}>
          {!def.required && <option value="">—</option>}
          {def.options!.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}
        </select>,
      );
    case "specialty":
      return wrap(
        <select id={id} name={def.name} defaultValue={v}>
          <option value="">—</option>
          {specialties.map((s) => <option key={s.id} value={s.id}>{lang === "ar" ? s.name_ar : s.name_en}</option>)}
        </select>,
      );
    case "checkbox":
      return (
        <div className={`field${def.wide ? " wide" : ""}`}>
          <label className="check"><input type="checkbox" name={def.name} defaultChecked={value === true || (value == null && def.dflt === true)} />{label}</label>
        </div>
      );
    case "datetime":
      return wrap(<DateTimeField name={def.name} defaultValue={v || null} required={def.required} blank={def.blank} />);
    case "number":
      return wrap(<input id={id} name={def.name} type="number" step={def.step ?? "any"} min={def.min} max={def.max} defaultValue={v} required={def.required} inputMode="decimal" />);
    case "date":
      return wrap(<input id={id} name={def.name} type="date" defaultValue={v} required={def.required} />);
    default:
      return wrap(<input id={id} name={def.name} type="text" defaultValue={v} required={def.required} maxLength={def.maxLength ?? 300} />);
  }
}

export function EntityForm({
  entity, pid, row, specialties, returnPath, links = {}, defaults = {}, submitLabel,
}: {
  entity: EntityDef; pid: string; row?: Row; specialties: Specialty[]; returnPath: string;
  links?: Record<string, string>; defaults?: Record<string, string>; submitLabel?: string;
}) {
  const { lang, t } = i18n();
  const prefix = `${entity.slug}_${row?.id ?? "new"}`;
  return (
    <ActionForm action={saveEntity} className="stack" resetOnSuccess={!row}>
      <input type="hidden" name="_slug" value={entity.slug} />
      <input type="hidden" name="_pid" value={pid} />
      <input type="hidden" name="_path" value={returnPath} />
      {row && <input type="hidden" name="_id" value={row.id} />}
      {Object.entries(links).map(([k, v]) => <input key={k} type="hidden" name={`_link_${k}`} value={v} />)}
      <div className="form-grid">
        {entity.fields.map((fd) => (
          <FieldInput key={fd.name} def={fd} lang={lang} specialties={specialties} prefix={prefix}
            value={row ? row[fd.name] : defaults[fd.name]} />
        ))}
      </div>
      <details className="fold">
        <summary>{t("مصدر المعلومة", "Where this information came from")}</summary>
        <div className="fold-body form-grid">
          <div className="field">
            <label htmlFor={`${prefix}_source`}>{t("المصدر", "Source")}</label>
            <select id={`${prefix}_source`} name="source" defaultValue={(row?.source as string) ?? "self"}>
              {SOURCE.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${prefix}_source_detail`}>{t("اسم الجهة / الجهاز", "Facility / device name")}</label>
            <input id={`${prefix}_source_detail`} name="source_detail" type="text" defaultValue={(row?.source_detail as string) ?? ""} maxLength={300} />
          </div>
        </div>
      </details>
      <div><SubmitButton pending={t("جارٍ الحفظ…", "Saving…")}>{submitLabel ?? t("حفظ", "Save")}</SubmitButton></div>
    </ActionForm>
  );
}
