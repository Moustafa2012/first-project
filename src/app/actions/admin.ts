"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentProfile, explainError, requireUser } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import type { FormState } from "@/components/ui/client";

export async function saveSpecialty(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  if ((await currentProfile())?.role !== "admin") return { error: t("للمسؤولين فقط.", "Administrators only.") };
  const id = String(fd.get("_id") ?? "");
  const code = String(fd.get("code") ?? "").trim();
  const row = {
    name_ar: String(fd.get("name_ar") ?? "").trim(), name_en: String(fd.get("name_en") ?? "").trim(),
    icon: String(fd.get("icon") ?? "folder").trim().slice(0, 40) || "folder", kind: fd.get("kind") === "support" ? "support" : "clinical",
    sort: Math.trunc(Number(fd.get("sort") ?? 0)) || 0, is_active: fd.get("is_active") === "on",
  };
  if (!row.name_ar || !row.name_en) return { error: t("الاسمان العربي والإنجليزي مطلوبان.", "Arabic and English names are required.") };
  const supabase = createClient();
  const { error } = id
    ? await supabase.from("medical_specialties").update(row).eq("id", id)
    : await supabase.from("medical_specialties").insert({ ...row, code });
  if (error) return { error: /check constraint|code/.test(error.message) ? t("الرمز: حروف إنجليزية صغيرة وأرقام و_ فقط.", "Code: lowercase letters, digits and _ only.") : explainError(error, t) };
  revalidatePath("/admin/specialties");
  return { ok: true, message: t("تم الحفظ.", "Saved.") };
}
