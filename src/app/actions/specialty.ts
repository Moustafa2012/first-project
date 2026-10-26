"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { explainError, requireUser } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { UUID_RE } from "@/lib/data";
import { parseLocaleNumber } from "@/lib/clinical/number";
import type { FormState } from "@/components/ui/client";

interface FieldSpec { key: string; type: string; required?: boolean; label_ar: string; label_en: string; options?: { value: string }[] }

/** Saves a specialty form whose shape comes from public.specialty_record_types (validated again by the database). */
export async function saveSpecialtyRecord(_: FormState, fd: FormData): Promise<FormState> {
  const { t, lang } = i18n();
  await requireUser();
  const pid = String(fd.get("_pid") ?? ""), typeId = String(fd.get("_type") ?? ""), path = String(fd.get("_path") ?? "");
  if (!UUID_RE.test(pid) || !UUID_RE.test(typeId)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const supabase = createClient();
  const { data: rt } = await supabase.from("specialty_record_types").select("specialty_id, fields").eq("id", typeId).eq("is_active", true).maybeSingle();
  if (!rt) return { error: t("نوع السجل غير موجود.", "Unknown record type.") };
  const occurred = String(fd.get("occurred_on") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurred)) return { error: t("أدخل تاريخاً صحيحاً.", "Enter a valid date.") };

  const data: Record<string, unknown> = {};
  for (const f of rt.fields as FieldSpec[]) {
    const raw = String(fd.get(`f_${f.key}`) ?? "").trim();
    const label = lang === "ar" ? f.label_ar : f.label_en;
    if (!raw) { if (f.required) return { error: t(`الحقل مطلوب: ${label}`, `Required: ${label}`) }; continue; }
    if (f.type === "number") {
      const n = parseLocaleNumber(raw);
      if (n == null) return { error: t(`رقم غير صالح: ${label}`, `Invalid number: ${label}`) };
      data[f.key] = n;
    } else if (f.type === "select") {
      if (!f.options?.some((o) => o.value === raw)) return { error: t(`اختيار غير صالح: ${label}`, `Invalid choice: ${label}`) };
      data[f.key] = raw;
    } else data[f.key] = raw.slice(0, 4000);
  }
  const { error } = await supabase.from("specialty_records").insert({
    patient_id: pid, specialty_id: rt.specialty_id, record_type_id: typeId, occurred_on: occurred, data,
    notes: String(fd.get("notes") ?? "").trim().slice(0, 4000) || null,
  });
  if (error) return { error: explainError(error, t) };
  revalidatePath(path.startsWith(`/patients/${pid}`) ? path : `/patients/${pid}`);
  return { ok: true, message: t("تم الحفظ.", "Saved.") };
}
