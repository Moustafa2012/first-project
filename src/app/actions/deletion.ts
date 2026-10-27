"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { hasServiceRole } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { explainError, requireUser } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { UUID_RE } from "@/lib/data";
import { purgePatient } from "@/lib/purge";
import type { FormState } from "@/components/ui/client";

/** Re-checks the password of the signed-in user without touching their session (a throw-away client). */
async function passwordOk(email: string, password: string): Promise<boolean> {
  if (!email || !password) return false;
  const { url, key } = publicEnv();
  const c = createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  return !error;
}

const field = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function requestDeletion(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const user = await requireUser();
  const pid = field(fd, "_pid");
  if (!UUID_RE.test(pid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (fd.get("ack") !== "on") return { error: t("أكّد أنك فهمت ما سيحدث.", "Confirm that you understand what will happen.") };
  if (!(await passwordOk(user.email ?? "", String(fd.get("password") ?? "")))) return { error: t("كلمة المرور غير صحيحة.", "Incorrect password.") };
  const { error } = await createClient().rpc("patient_request_deletion", { p_patient: pid, p_confirm: field(fd, "confirm") });
  if (error) return { error: explainError(error, t) };
  revalidatePath("/patients", "layout");
  return { ok: true, redirectTo: `/patients/${pid}/delete` };
}

export async function restoreFile(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = field(fd, "_pid");
  if (!UUID_RE.test(pid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { error } = await createClient().rpc("patient_cancel_deletion", { p_patient: pid });
  if (error) return { error: explainError(error, t) };
  revalidatePath("/patients", "layout");
  return { ok: true, redirectTo: `/patients/${pid}` };
}

/** "Delete now": the file is already pending; the owner types the name and the password again. */
export async function deleteNow(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const user = await requireUser();
  const pid = field(fd, "_pid");
  if (!UUID_RE.test(pid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  if (!hasServiceRole()) return { error: t("الحذف النهائي غير مُفعَّل على الخادم.", "Permanent deletion is not enabled on the server.") };
  if (!(await passwordOk(user.email ?? "", String(fd.get("password") ?? "")))) return { error: t("كلمة المرور غير صحيحة.", "Incorrect password.") };

  const supabase = createClient();
  const [{ data: p }, { data: m }] = await Promise.all([
    supabase.from("patients").select("id, full_name, mrn, deletion_requested_at").eq("id", pid).maybeSingle(),
    supabase.from("patient_members").select("role").eq("patient_id", pid).eq("user_id", user.id).is("revoked_at", null).maybeSingle(),
  ]);
  if (!p || !m || (m.role !== "owner" && m.role !== "guardian")) return { error: t("ليست لديك صلاحية لهذه العملية.", "You do not have permission for this action.") };
  if (!p.deletion_requested_at) return { error: t("اطلب الحذف أولاً.", "Request deletion first.") };
  const typed = field(fd, "confirm").toLowerCase();
  if (typed !== String(p.full_name).trim().toLowerCase() && typed !== String(p.mrn).toLowerCase()) return { error: explainError({ message: "confirmation_mismatch" }, t) };
  try {
    await purgePatient(pid, true);
  } catch (e) {
    return { error: explainError(e, t) };
  }
  return { ok: true, redirectTo: "/patients?deleted=1" };
}
