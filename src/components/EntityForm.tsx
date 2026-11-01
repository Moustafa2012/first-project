import { i18n, type Lang } from "@/lib/i18n";
import { DATE_PRECISION, SOURCE, type Opt } from "@/lib/labels";
import type { EntityDef, FieldDef, FormContext } from "@/lib/entities";
import type { Row, Specialty } from "@/lib/types";
import { ActionForm, DateTimeField, SubmitButton } from "@/components/ui/client";
import { TemplatePicker } from "@/components/TemplatePicker";
import { saveEntity } from "@/app/actions/entities";

export function FieldInput({ def, value, lang, specialties, prefix, precision, suggest, choices }: { def: FieldDef; value: unknown; lang: Lang; specialties: Specialty[]; prefix: string; precision?: unknown; suggest?: string[]; choices?: Opt[] }) {
  const id = `${prefix}_${def.name}`;
  const label = lang === "ar" ? def.ar : def.en;
  // a NOT NULL date with a database default ("today") is prefilled, never sent empty
  const v = value == null ? (def.kind === "date" && def.dflt === "today" ? new Date().toISOString().slice(0, 10) : "")
    : Array.isArray(value) ? value.join(", ") : String(value);
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
    case "link":
      return wrap(
        <select id={id} name={def.name} defaultValue={v}>
          <option value="">—</option>
          {(choices ?? []).map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}
        </select>,
      );
    case "checkbox":
      return (
        <div className={`field${def.wide ? " wide" : ""}`}>
          <label className="check"><input type="checkbox" name={def.name} defaultChecked={value === true || value === "true" || (value == null && def.dflt === true)} />{label}</label>
        </div>
      );
    case "datetime":
      return wrap(<DateTimeField name={def.name} defaultValue={v || null} required={def.required} blank={def.blank} />);
    case "teeth":
      return wrap(<input id={id} name={def.name} type="text" defaultValue={v} dir="ltr" inputMode="numeric" maxLength={200} placeholder="16, 26" />);
    case "number":
      return wrap(<input id={id} name={def.name} type="number" step={def.step ?? "any"} min={def.min} max={def.max} defaultValue={v} required={def.required} inputMode="decimal" />);
    case "date":
      if (def.precision) {
        return wrap(
          <div className="date-prec">
            <input id={id} name={def.name} type="date" defaultValue={v} required={def.required} />
            <select name={def.precision} defaultValue={typeof precision === "string" ? precision : "day"} aria-label={lang === "ar" ? `دقة ${label}` : `${label} precision`}>
              {DATE_PRECISION.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}
            </select>
          </div>,
        );
      }
      return wrap(<input id={id} name={def.name} type="date" defaultValue={v} required={def.required} />);
    default:
      return wrap(<>
        <input id={id} name={def.name} type="text" defaultValue={v} required={def.required} maxLength={def.maxLength ?? 300} list={suggest?.length ? `${id}_list` : undefined} />
        {suggest?.length ? <datalist id={`${id}_list`}>{suggest.map((x) => <option key={x} value={x} />)}</datalist> : null}
      </>);
  }
}

export function EntityForm({
  entity, pid, row, specialties, returnPath, links = {}, defaults = {}, submitLabel, context, formId, idPrefix,
}: {
  entity: EntityDef; pid: string; row?: Row; specialties: Specialty[]; returnPath: string;
  links?: Record<string, string>; defaults?: Record<string, string>; submitLabel?: string; context?: FormContext; formId?: string;
  /** keeps element ids unique when the same form appears twice on one page (e.g. a quick form above the full one) */
  idPrefix?: string;
}) {
  const { lang, t } = i18n();
  const prefix = `${idPrefix ? `${idPrefix}_` : ""}${entity.slug}_${row?.id ?? "new"}`;
  // what the place already knows is sent, not asked; fields that do not belong here are not shown (and left untouched)
  const fixed = context?.fixed ?? {};
  const narrow = context?.options ?? {};
  const external = context?.external ?? [];
  const fields = entity.fields
    .filter((f) => !(f.only === "dental" && !context?.dental) && !(f.name in fixed) && !external.includes(f.name) && (!context?.pick || context.pick.includes(f.name)))
    .map((f) => (narrow[f.name] && f.options ? { ...f, options: f.options.filter((o) => narrow[f.name].includes(o.value)) } : f));
  return (
    <ActionForm action={saveEntity} className="stack" resetOnSuccess={!row} id={formId}>
      <input type="hidden" name="_slug" value={entity.slug} />
      <input type="hidden" name="_pid" value={pid} />
      <input type="hidden" name="_path" value={returnPath} />
      {row && <input type="hidden" name="_id" value={row.id} />}
      {Object.entries(links).map(([k, v]) => <input key={k} type="hidden" name={`_link_${k}`} value={v} />)}
      <input type="hidden" name="_fields" value={[...fields.map((f) => f.name), ...Object.keys(fixed), ...external].join(",")} />
      {Object.entries(fixed).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {context?.templates && entity.bodyField && fields.some((f) => f.name === entity.bodyField) && (
        <>
          <TemplatePicker target={`${prefix}_${entity.bodyField}`} templates={context.templates} lang={lang} manageHref="/account#templates" />
        </>
      )}
      <div className="form-grid">
        {fields.map((fd) => (
          <FieldInput key={fd.name} def={fd} lang={lang} specialties={specialties} prefix={prefix} suggest={context?.suggest?.[fd.name]} choices={context?.choices?.[fd.name]}
            value={row ? row[fd.name] : defaults[fd.name]} precision={fd.precision && row ? row[fd.precision] : undefined} />
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
