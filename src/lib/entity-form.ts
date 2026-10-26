import type { EntityDef, FieldDef } from "@/lib/entities";
import { SOURCE } from "@/lib/labels";
import { UUID_RE } from "@/lib/uuid";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses and validates a submitted form against the entity definition. Unknown fields are ignored. */
export function parseEntityForm(def: EntityDef, fd: FormData, t: (ar: string, en: string) => string): { row: Record<string, unknown> } | { error: string } {
  const row: Record<string, unknown> = {};
  const fields: FieldDef[] = [
    ...def.fields,
    { name: "source", ar: "المصدر", en: "Source", kind: "select", options: SOURCE },
    { name: "source_detail", ar: "تفاصيل المصدر", en: "Source detail", kind: "text", maxLength: 300 },
  ];
  for (const fld of fields) {
    const label = t(fld.ar, fld.en);
    if (fld.kind === "checkbox") { row[fld.name] = fd.get(fld.name) === "on"; continue; }
    const raw = String(fd.get(fld.name) ?? "").trim();
    if (raw === "") {
      if (fld.required) return { error: t(`الحقل مطلوب: ${label}`, `Required: ${label}`) };
      if (fld.name === "source") { row.source = "self"; continue; }
      row[fld.name] = null;
      continue;
    }
    switch (fld.kind) {
      case "text": case "textarea":
        if (raw.length > (fld.maxLength ?? 4000)) return { error: t(`النص طويل جداً: ${label}`, `Too long: ${label}`) };
        row[fld.name] = raw; break;
      case "date":
        if (!DATE_RE.test(raw) || Number.isNaN(Date.parse(raw))) return { error: t(`تاريخ غير صالح: ${label}`, `Invalid date: ${label}`) };
        row[fld.name] = raw; break;
      case "datetime": {
        const d = new Date(raw);
        if (Number.isNaN(+d)) return { error: t(`وقت غير صالح: ${label}`, `Invalid time: ${label}`) };
        row[fld.name] = d.toISOString(); break;
      }
      case "number": {
        const n = Number(raw);
        if (!Number.isFinite(n) || (fld.min != null && n < fld.min) || (fld.max != null && n > fld.max)) return { error: t(`رقم غير صالح: ${label}`, `Invalid number: ${label}`) };
        row[fld.name] = n; break;
      }
      case "select":
        if (!fld.options?.some((o) => o.value === raw)) return { error: t(`اختيار غير صالح: ${label}`, `Invalid choice: ${label}`) };
        row[fld.name] = raw; break;
      case "specialty":
        if (!UUID_RE.test(raw)) return { error: t(`تخصص غير صالح`, `Invalid specialty`) };
        row[fld.name] = raw; break;
    }
  }
  return { row };
}
