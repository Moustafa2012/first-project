"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { explainError, requireUser } from "@/lib/auth";
import { i18n, type T } from "@/lib/i18n";
import { UUID_RE } from "@/lib/data";
import { verifyPassword } from "@/lib/password-check";
import type { FormState } from "@/components/ui/client";

const field = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function explainAccountError(e: { message?: string; code?: string } | null, t: T): string {
  const m = String(e?.message ?? "");
  if (/email_mismatch/.test(m)) return t("البريد المكتوب لا يطابق بريد حسابك.", "The email you typed does not match your account's email.");
  if (/shared_files_remain/.test(m)) return t("لديك ملفات مشتركة مع آخرين. انقل ملكيتها أو أزل المشاركين منها أولاً (انظر القائمة أدناه).", "You have files shared with other people. Transfer their ownership or remove the other members first (see the list below).");
  if (/last_admin/.test(m)) return t("أنت المدير الوحيد للنظام. عيّن مديراً آخر قبل حذف حسابك.", "You are the only administrator. Make another account an administrator before deleting yours.");
  if (/already_pending/.test(m)) return t("حذف الحساب مجدول مسبقاً.", "Deleting the account is already scheduled.");
  if (/invalid_target/.test(m)) return t("لا يمكن اختيار هذا الشخص.", "That person cannot be chosen.");
  if (/file_pending_deletion/.test(m)) return t("الملف مجدول للحذف ولا يمكن نقل ملكيته.", "The file is scheduled for deletion and cannot be handed over.");
  return explainError(e, t);
}

/** Schedules the deletion of the signed-in user's own account: typed e-mail + password, then every device is signed out. */
export async function requestAccountDeletion(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  const user = await requireUser();
  if (fd.get("ack") !== "on") return { error: t("أكّد أنك فهمت ما سيحدث.", "Confirm that you understand what will happen.") };
  if (!(await verifyPassword(user.email ?? "", String(fd.get("password") ?? "")))) return { error: t("كلمة المرور غير صحيحة.", "Incorrect password.") };
  const supabase = createClient();
  const { data, error } = await supabase.rpc("account_request_deletion", { p_confirm: field(fd, "confirm") });
  if (error) return { error: explainAccountError(error, t) };
  const on = String(data ?? "").slice(0, 10);
  await supabase.auth.signOut({ scope: "global" });
  return { ok: true, redirectTo: `/login?deleted=1${/^\d{4}-\d{2}-\d{2}$/.test(on) ? `&on=${on}` : ""}` };
}

/** Hands a shared file to another member so that the account can be deleted without taking the file with it. */
export async function transferFileOwnership(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = field(fd, "_pid"), to = field(fd, "to");
  if (!UUID_RE.test(pid) || !UUID_RE.test(to)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { error } = await createClient().rpc("patient_transfer_ownership", { p_patient: pid, p_to: to });
  if (error) return { error: explainAccountError(error, t) };
  revalidatePath("/account");
  return { ok: true, message: t("انتقلت ملكية الملف.", "Ownership of the file was transferred.") };
}

/** Removes another member's access to a shared file. */
export async function removeFileMember(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = field(fd, "_pid"), who = field(fd, "user");
  if (!UUID_RE.test(pid) || !UUID_RE.test(who)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const { error } = await createClient().rpc("patient_remove_member", { p_patient: pid, p_user: who });
  if (error) return { error: explainAccountError(error, t) };
  revalidatePath("/account");
  return { ok: true, message: t("أُزيلت مشاركته من الملف.", "Their access to the file was removed.") };
}
