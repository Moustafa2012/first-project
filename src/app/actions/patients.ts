"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { explainError, requireUser } from "@/lib/auth";
import { i18n } from "@/lib/i18n";
import { ABO, RH, SEX, ALLERGY_ASSERTION } from "@/lib/labels";
import { UUID_RE } from "@/lib/data";
import type { FormState } from "@/components/ui/client";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
const oneOf = (v: string, list: { value: string }[]) => list.some((o) => o.value === v);

export async function createPatient(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const name = str(fd, "full_name");
  const dob = str(fd, "date_of_birth");
  if (name.length < 2) return { error: t("أدخل الاسم الكامل.", "Enter the full name.") };
  if (!DATE_RE.test(dob) || Number.isNaN(Date.parse(dob))) return { error: t("أدخل تاريخ ميلاد صحيحاً.", "Enter a valid date of birth.") };
  if (dob > new Date().toISOString().slice(0, 10)) return { error: t("تاريخ الميلاد لا يمكن أن يكون في المستقبل.", "Date of birth cannot be in the future.") };
  const sex = str(fd, "sex") || "unspecified";
  const abo = str(fd, "blood_abo");
  const rh = str(fd, "blood_rh");
  const rel = str(fd, "relationship") === "dependent" ? "dependent" : "self";
  if (!oneOf(sex, SEX) || (abo && !oneOf(abo, ABO)) || (rh && !oneOf(rh, RH))) return { error: t("بيانات غير صالحة.", "Invalid data.") };

  const { data, error } = await createClient().rpc("create_patient", {
    p_full_name: name, p_date_of_birth: dob, p_sex: sex, p_full_name_en: str(fd, "full_name_en") || null,
    p_nationality: str(fd, "nationality", 80) || null, p_blood_abo: abo || null, p_blood_rh: rh || null,
    p_phone: str(fd, "phone", 40) || null, p_email: str(fd, "email") || null, p_relationship: rel,
    p_confirm_distinct: fd.get("confirm_distinct") === "on",
  });
  if (error) return { error: explainError(error, t) };
  revalidatePath("/patients");
  return { ok: true, redirectTo: `/patients/${data as string}` };
}

export async function updatePatient(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const pid = str(fd, "_pid");
  if (!UUID_RE.test(pid)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const name = str(fd, "full_name");
  const dob = str(fd, "date_of_birth");
  const sex = str(fd, "sex");
  const abo = str(fd, "blood_abo");
  const rh = str(fd, "blood_rh");
  const assertion = str(fd, "allergy_assertion");
  if (name.length < 2 || !DATE_RE.test(dob)) return { error: t("الاسم وتاريخ الميلاد مطلوبان.", "Name and date of birth are required.") };
  if (!oneOf(sex, SEX) || (abo && !oneOf(abo, ABO)) || (rh && !oneOf(rh, RH)) || !oneOf(assertion, ALLERGY_ASSERTION)) return { error: t("بيانات غير صالحة.", "Invalid data.") };

  const supabase = createClient();
  if (assertion === "none_known") {
    const { count } = await supabase.from("allergies").select("id", { count: "exact", head: true })
      .eq("patient_id", pid).eq("status", "active").eq("record_status", "active");
    if (count) return { error: t("توجد حساسيات نشطة مسجلة؛ لا يمكن تحديد «لا توجد حساسية معروفة».", "Active allergies are recorded; “no known allergies” cannot be set.") };
  }
  const { data, error } = await supabase.from("patients").update({
    full_name: name, full_name_en: str(fd, "full_name_en") || null, date_of_birth: dob, sex,
    nationality: str(fd, "nationality", 80) || null, blood_abo: abo || null, blood_rh: rh || null,
    blood_group_verified: fd.get("blood_group_verified") === "on",
    phone: str(fd, "phone", 40) || null, email: str(fd, "email") || null,
    address_line: str(fd, "address_line", 300) || null, city: str(fd, "city", 100) || null, country: str(fd, "country", 100) || null,
    allergy_assertion: assertion,
  }).eq("id", pid).select("id");
  if (error) return { error: explainError(error, t) };
  if (!data?.length) return { error: t("لا تملك صلاحية التعديل.", "You may not edit this file.") };
  revalidatePath(`/patients/${pid}`, "layout");
  return { ok: true, message: t("تم الحفظ.", "Saved.") };
}

type Simple = "emergency_contacts" | "patient_insurance" | "patient_identifiers";

export async function saveSimple(_: FormState, fd: FormData): Promise<FormState> {
  const { t } = i18n();
  await requireUser();
  const table = str(fd, "_table") as Simple;
  const pid = str(fd, "_pid");
  if (!UUID_RE.test(pid) || !["emergency_contacts", "patient_insurance", "patient_identifiers"].includes(table)) return { error: t("طلب غير صالح.", "Invalid request.") };
  let row: Record<string, unknown>;
  if (table === "emergency_contacts") {
    const full = str(fd, "full_name"); const phone = str(fd, "phone", 40);
    if (full.length < 2 || phone.length < 5) return { error: t("الاسم والهاتف مطلوبان.", "Name and phone are required.") };
    row = { full_name: full, phone, relation: str(fd, "relation") || null, is_legal_representative: fd.get("is_legal_representative") === "on" };
  } else if (table === "patient_insurance") {
    const provider = str(fd, "provider");
    if (!provider) return { error: t("اسم شركة التأمين مطلوب.", "Insurance provider is required.") };
    row = { provider, policy_number: str(fd, "policy_number") || null, class_name: str(fd, "class_name") || null,
      valid_from: DATE_RE.test(str(fd, "valid_from")) ? str(fd, "valid_from") : null, valid_to: DATE_RE.test(str(fd, "valid_to")) ? str(fd, "valid_to") : null };
  } else {
    const type = str(fd, "id_type"); const value = str(fd, "id_value", 60);
    if (!["national_id", "residency", "passport", "other"].includes(type) || value.length < 3) return { error: t("نوع الهوية ورقمها مطلوبان.", "ID type and number are required.") };
    row = { id_type: type, id_value: value };
  }
  const supabase = createClient();
  const { error } = table === "patient_identifiers"
    ? await supabase.from(table).upsert({ ...row, patient_id: pid }, { onConflict: "patient_id,id_type" })
    : await supabase.from(table).insert({ ...row, patient_id: pid });
  if (error) return { error: explainError(error, t) };
  revalidatePath(`/patients/${pid}/profile`);
  return { ok: true, message: t("تم الحفظ.", "Saved.") };
}

export async function deleteSimple(fd: FormData) {
  await requireUser();
  const table = str(fd, "_table");
  const pid = str(fd, "_pid");
  const id = str(fd, "_id");
  if (!UUID_RE.test(pid) || !UUID_RE.test(id) || !["emergency_contacts", "patient_insurance"].includes(table)) return;
  await createClient().from(table).delete().eq("id", id).eq("patient_id", pid);
  revalidatePath(`/patients/${pid}/profile`);
}
