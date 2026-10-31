"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, explainError } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { ENTITIES } from "@/lib/entities";
import { parseEntityForm } from "@/lib/entity-form";
import { STATUS_MODEL } from "@/lib/status";
import { UUID_RE } from "@/lib/data";
import type { FormState } from "@/components/ui/client";
import type { Row } from "@/lib/types";

function safePath(pid: string, p: string): string {
  return p.startsWith(`/patients/${pid}`) ? p : `/patients/${pid}`;
}

export async function saveEntity(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const user = await requireUser();
  const slug = String(fd.get("_slug") ?? "");
  const pid = String(fd.get("_pid") ?? "");
  const id = String(fd.get("_id") ?? "");
  const def = ENTITIES[slug];
  if (!def || !UUID_RE.test(pid) || (id && !UUID_RE.test(id))) return { error: t("طلب غير صالح.", "Invalid request.") };

  const parsed = parseEntityForm(def, fd, t);
  if ("error" in parsed) return { error: parsed.error };
  const row = parsed.row;

  // optional links preset by the page (e.g. add a diagnosis from inside a visit): whitelisted per entity
  for (const link of def.links ?? []) {
    const v = String(fd.get(`_link_${link}`) ?? "");
    if (v) { if (!UUID_RE.test(v)) return { error: t("ارتباط غير صالح.", "Invalid link.") }; row[link] = v; }
  }
  if (def.table === "conditions" && row.category === "chronic" && row.certainty === "refuted") {
    return { error: t("لا يمكن أن يكون المرض المزمن «منفياً». استخدم حالة «منتهية» أو احذفه بالخطأ.", "A chronic condition cannot be “refuted”; resolve it or mark it as entered in error.") };
  }

  const supabase = createClient();

  // a probable duplicate is reported once; ticking "save anyway" and resubmitting saves it
  if (!id && def.dupKey && fd.get("_dup_ok") !== "on") {
    const key = def.dupKey({ ...row, id: "" } as Row);
    if (key) {
      const { data: existing } = await supabase.from(def.table).select("*").eq("patient_id", pid).eq("record_status", "active")
        .order("recorded_at", { ascending: false }).limit(1000);
      const same = ((existing ?? []) as Row[]).filter((r) => def.dupKey!(r) === key);
      if (same.length) {
        const { lang } = i18n();
        const names = same.slice(0, 3).map((r) => `• ${def.titleOf(r, lang) || "—"}`).join("\n");
        return {
          error: t(`يبدو أن هذا السجل مسجل من قبل:\n${names}`, `This looks like a record that already exists:\n${names}`),
          confirm: { name: "_dup_ok", label: t("ليس تكراراً، احفظه رغم ذلك", "It is not a duplicate — save anyway") },
        };
      }
    }
  }

  const q = id
    ? supabase.from(def.table).update(row).eq("id", id).eq("patient_id", pid).select("id")
    : supabase.from(def.table).insert({ ...row, patient_id: pid }).select("id");
  const { data, error } = await q;
  if (error) return { error: explainError(error, t) };
  if (id && (!data || data.length === 0)) return { error: t("لم يُعثر على السجل أو لا تملك صلاحية تعديله.", "Record not found or you may not edit it.") };

  // keep the patient-level allergy assertion honest when allergies are added
  if (def.table === "allergies" && !id) {
    await supabase.from("patients").update({ allergy_assertion: "has_allergies" }).eq("id", pid).neq("allergy_assertion", "has_allergies");
  }
  void user;
  revalidatePath(safePath(pid, String(fd.get("_path") ?? "")));
  revalidatePath(`/patients/${pid}`);
  return { ok: true, message: t("تم الحفظ.", "Saved.") };
}

export async function invalidateEntity(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const slug = String(fd.get("_slug") ?? "");
  const pid = String(fd.get("_pid") ?? "");
  const id = String(fd.get("_id") ?? "");
  const reason = String(fd.get("reason") ?? "").trim();
  const def = ENTITIES[slug];
  if (!def || !UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (reason.length < 3) return { error: t("اكتب سبب الإبطال.", "Enter a reason.") };
  const { data, error } = await createClient().from(def.table)
    .update({ record_status: "entered_in_error", invalidated_reason: reason.slice(0, 500) }).eq("id", id).eq("patient_id", pid).select("id");
  if (error) return { error: explainError(error, t) };
  if (!data?.length) return { error: t("لم يُعثر على السجل.", "Record not found.") };
  revalidatePath(safePath(pid, String(fd.get("_path") ?? "")));
  revalidatePath(`/patients/${pid}`);
  return { ok: true, message: t("أُبطل السجل وبقي في التاريخ.", "Record invalidated and kept in the history.") };
}

/** Moves a diagnosis, medication or allergy to its next status in one step; the database keeps the history. */
export async function setRecordStatus(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = String(fd.get("_pid") ?? ""), id = String(fd.get("_id") ?? ""), table = String(fd.get("_table") ?? "");
  const status = String(fd.get("status") ?? ""), date = String(fd.get("effective_date") ?? ""), reason = String(fd.get("reason") ?? "").trim().slice(0, 500);
  const model = STATUS_MODEL[table];
  if (!model || !UUID_RE.test(pid) || !UUID_RE.test(id)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (!model.options.some((o) => o.value === status) && !(table === "conditions" && status === "refuted")) return { error: t("اختر الحالة الجديدة.", "Choose the new status.") };
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: t("تاريخ غير صالح.", "Invalid date.") };
  const { error } = await createClient().rpc("record_set_status", { p_table: table, p_id: id, p_status: status, p_reason: reason || null, p_date: date || null });
  if (error) {
    if (/date_in_future/.test(error.message)) return { error: t("التاريخ في المستقبل.", "The date is in the future.") };
    if (/not_found/.test(error.message)) return { error: t("لم يُعثر على السجل أو لا تملك صلاحية تعديله.", "Record not found or you may not edit it.") };
    return { error: explainError(error, t) };
  }
  revalidatePath(safePath(pid, String(fd.get("_path") ?? "")));
  revalidatePath(`/patients/${pid}`, "layout");
  return { ok: true, message: t("تغيّرت الحالة وحُفظ التغيير في سجلها.", "Status changed; the change is kept in its history.") };
}
