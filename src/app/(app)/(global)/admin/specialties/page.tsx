import { notFound } from "next/navigation";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { currentProfile } from "@/lib/auth";
import { Banner, Card, PageHead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { saveSpecialty } from "@/app/actions/admin";
import type { Specialty } from "@/lib/types";

export default async function AdminSpecialties() {
  const { t } = i18n();
  if ((await currentProfile())?.role !== "admin") notFound();
  const { data } = await createClient().from("medical_specialties").select("*").order("kind").order("sort");
  const list = (data ?? []) as Specialty[];
  const form = (s?: Specialty) => (
    <ActionForm action={saveSpecialty} className="stack" resetOnSuccess={!s}>
      {s && <input type="hidden" name="_id" value={s.id} />}
      <div className="form-grid">
        {!s && <div className="field"><label>{t("الرمز (إنجليزي)", "Code")}</label><input name="code" required pattern="[a-z][a-z0-9_]{1,40}" dir="ltr" /></div>}
        <div className="field"><label>{t("الاسم بالعربية", "Arabic name")}</label><input name="name_ar" defaultValue={s?.name_ar} required /></div>
        <div className="field"><label>{t("الاسم بالإنجليزية", "English name")}</label><input name="name_en" defaultValue={s?.name_en} dir="ltr" required /></div>
        <div className="field"><label>{t("الأيقونة", "Icon")}</label><input name="icon" defaultValue={s?.icon ?? "folder"} dir="ltr" /></div>
        <div className="field"><label>{t("النوع", "Kind")}</label><select name="kind" defaultValue={s?.kind ?? "clinical"}><option value="clinical">{t("تخصص سريري", "Clinical")}</option><option value="support">{t("قسم مساند", "Supporting")}</option></select></div>
        <div className="field"><label>{t("الترتيب", "Order")}</label><input name="sort" type="number" defaultValue={s?.sort ?? 0} /></div>
        <div className="field"><label className="check" style={{ marginBlockStart: "1.7rem" }}><input type="checkbox" name="is_active" defaultChecked={s?.is_active ?? true} />{t("فعّال", "Active")}</label></div>
      </div>
      <div><SubmitButton>{t("حفظ", "Save")}</SubmitButton></div>
    </ActionForm>
  );
  return (
    <>
      <PageHead title={t("إدارة التخصصات الطبية", "Manage medical specialties")} sub={t("إضافة تخصص أو تعديله لا يتطلب تغييراً في بنية قاعدة البيانات.", "Adding or editing a specialty needs no database schema change.")} />
      <Banner tone="info">{t("لدى المسؤول صلاحية الكتالوج والحسابات فقط، ولا يرى أي بيانات طبية للمرضى.", "Administrators manage the catalog and accounts only and cannot see any patient’s medical data.")}</Banner>
      <Card title={t("تخصص جديد", "New specialty")}>{form()}</Card>
      {list.map((s) => (
        <details className="fold" key={s.id}><summary>{s.name_ar} · {s.name_en} <span className="muted small ltr">{s.code}{s.is_active ? "" : " (inactive)"}</span></summary><div className="fold-body">{form(s)}</div></details>
      ))}
    </>
  );
}
