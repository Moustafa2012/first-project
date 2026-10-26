import { notFound } from "next/navigation";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getObsTypes, getPatient, getSpecialties } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { SHARE_MODULES } from "@/lib/labels";
import { Banner, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import { ShareCreateShell } from "@/components/ShareCreateShell";
import { createShare } from "@/app/actions/sharing";

export default async function NewSharePage({ params, searchParams }: { params: { pid: string }; searchParams: { specialty?: string } }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const p = await getPatient(params.pid);
  const access = await getAccess(p.id);
  if (!access.canShare) notFound();
  const [specs, types] = await Promise.all([getSpecialties(), getObsTypes()]);
  const preset = specs.find((s) => s.code === searchParams.specialty);
  const supabase = createClient();
  const act = { patient_id: p.id, record_status: "active" };
  const [enc, obs, docs, proc, img, notes, srec, plans] = await Promise.all([
    supabase.from("encounters").select("id, kind, reason, started_at").match(act).order("started_at", { ascending: false }).limit(40),
    supabase.from("observations").select("id, effective_at, value_num, value_num2, unit, type_id").eq("patient_id", p.id).in("status", ["final", "preliminary"]).order("effective_at", { ascending: false }).limit(40),
    supabase.from("medical_documents").select("id, title, document_date, sensitivity").match(act).order("uploaded_at", { ascending: false }).limit(40),
    supabase.from("procedures").select("id, name, performed_on").match(act).order("performed_on", { ascending: false }).limit(40),
    supabase.from("imaging_studies").select("id, modality, body_site, performed_on").match(act).order("performed_on", { ascending: false }).limit(40),
    supabase.from("clinical_notes").select("id, title, noted_at").match(act).order("noted_at", { ascending: false }).limit(40),
    supabase.from("specialty_records").select("id, occurred_on, specialty_id").match(act).order("occurred_on", { ascending: false }).limit(40),
    supabase.from("care_plans").select("id, title").match(act).limit(40),
  ]);
  const typeName = new Map(types.map((x) => [x.id, lang === "ar" ? x.name_ar : x.name_en]));
  const d = (v: string | null) => (v ? fmtDate(v, lang, tz) : "");
  const groups: [string, string, { id: string; label: string }[]][] = [
    ["encounters", t("الزيارات", "Visits"), (enc.data ?? []).map((r) => ({ id: r.id, label: `${d(r.started_at)} — ${r.reason ?? r.kind}` }))],
    ["observations", t("القياسات والتحاليل", "Measurements & results"), (obs.data ?? []).map((r) => ({ id: r.id, label: `${d(r.effective_at)} — ${typeName.get(r.type_id)}: ${r.value_num}${r.value_num2 != null ? "/" + r.value_num2 : ""} ${r.unit ?? ""}` }))],
    ["medical_documents", t("المستندات", "Documents"), (docs.data ?? []).map((r) => ({ id: r.id, label: `${r.title}${r.document_date ? " — " + d(r.document_date) : ""}${r.sensitivity === "restricted" ? " 🔒" : ""}` }))],
    ["procedures", t("الإجراءات", "Procedures"), (proc.data ?? []).map((r) => ({ id: r.id, label: `${d(r.performed_on)} — ${r.name}` }))],
    ["imaging_studies", t("الأشعة", "Imaging"), (img.data ?? []).map((r) => ({ id: r.id, label: `${d(r.performed_on)} — ${r.modality} ${r.body_site ?? ""}` }))],
    ["clinical_notes", t("الملاحظات", "Notes"), (notes.data ?? []).map((r) => ({ id: r.id, label: `${d(r.noted_at)} — ${r.title ?? ""}` }))],
    ["specialty_records", t("سجلات التخصص", "Specialty records"), (srec.data ?? []).map((r) => ({ id: r.id, label: d(r.occurred_on) }))],
    ["care_plans", t("خطط المتابعة", "Care plans"), (plans.data ?? []).map((r) => ({ id: r.id, label: r.title }))],
  ];
  const defaultInclude = new Set(preset ? ["other_conditions", "encounters", "observations", "procedures", "imaging", "specialty_records", "documents", "notes", "care_plans"] : ["other_conditions", "encounters", "observations", "procedures", "imaging", "documents"]);
  const labObsTypes = types.filter((x) => x.category !== "other");

  return (
    <>
      <PageHead title={t("مشاركة جديدة مع طبيب", "New share with a doctor")} sub={preset ? t(`ملف ${preset.name_ar}`, `${preset.name_en} file`) : undefined} />
      <Banner tone="info" title={t("يُرسَل دائماً (للسلامة)", "Always included (for safety)")}>
        {t("الاسم والعمر والجنس وفصيلة الدم، الحساسية، الأمراض المزمنة والخلقية، الأدوية الحالية. البنود المعلَّمة «حساسة» تُستثنى ما لم تسمح بها. رقم الهوية والعنوان لا يُشاركان أبداً.",
           "Name, age, sex, blood group, allergies, chronic & congenital conditions and current medications. Items marked “sensitive” are excluded unless you allow them. ID numbers and address are never shared.")}
      </Banner>
      <div className="card" style={{ marginBlockStart: "1rem" }}>
        <ShareCreateShell action={createShare} labels={{
          title: t("أُنشئت المشاركة", "Share created"), warn: t("انسخ الرابط والرمز الآن: لن يُعرضا مرة أخرى ولا نحتفظ بهما بصيغة مقروءة. أرسلهما بقناتين مختلفتين.", "Copy the link and PIN now: they will not be shown again and are not stored in readable form. Send them through two different channels."),
          link: t("رابط المشاركة", "Share link"), pin: t("رمز PIN", "PIN"), copy: t("نسخ", "Copy"), copied: t("تم النسخ", "Copied"), expires: t("تنتهي الصلاحية", "Expires"),
          done: t("إدارة المشاركة", "Manage this share"), hidePin: t("إخفاء", "Hide"), showPin: t("إظهار", "Show"),
        }}>
          <input type="hidden" name="_pid" value={p.id} />
          <div className="form-grid">
            <div className="field wide"><label htmlFor="title">{t("غرض المشاركة", "Purpose")} <span className="req">*</span></label><input id="title" name="title" required maxLength={200} defaultValue={preset ? t(`زيارة ${preset.name_ar}`, `${preset.name_en} visit`) : ""} /></div>
            <div className="field wide"><label htmlFor="recipient_label">{t("المستلم (اختياري)", "Recipient (optional)")}</label><input id="recipient_label" name="recipient_label" maxLength={200} placeholder={t("د. فلان — عيادة…", "Dr … — clinic …")} /></div>
          </div>

          <fieldset><legend>{t("النطاق", "Scope")}</legend>
            <div className="stack">
              <label className="check"><input type="radio" name="scope_kind" value="specialty" defaultChecked={Boolean(preset)} />{t("تخصص طبي واحد أو أكثر", "One or more specialties")}</label>
              <div className="grid cols-3" style={{ paddingInlineStart: "1.6rem" }}>
                {specs.map((s) => <label className="check small" key={s.id}><input type="checkbox" name="specialty" value={s.id} defaultChecked={preset?.id === s.id} />{lang === "ar" ? s.name_ar : s.name_en}</label>)}
              </div>
              <label className="check"><input type="radio" name="scope_kind" value="full" defaultChecked={!preset} />{t("الملف الصحي كاملاً (بحسب البنود أدناه)", "The whole health file (per the items below)")}</label>
              <label className="check"><input type="radio" name="scope_kind" value="custom" />{t("سجلات أختارها بنفسي (من القائمة في الأسفل)", "Only records I pick (from the list below)")}</label>
            </div>
          </fieldset>

          <fieldset><legend>{t("ما يُضاف فوق المعلومات الأساسية", "What is added on top of the essentials")}</legend>
            <div className="grid cols-2">
              {SHARE_MODULES.map((m) => <label className="check" key={m.value}><input type="checkbox" name="include" value={m.value} defaultChecked={defaultInclude.has(m.value)} />{m[lang]}</label>)}
            </div>
            <label className="check" style={{ marginBlockStart: ".6rem" }}><input type="checkbox" name="include_sensitive" />{t("اسمح بالبنود التي علَّمتها «حساسة» (حالات وأدوية)", "Allow items I marked “sensitive” (conditions and medications)")}</label>
          </fieldset>

          <div className="form-grid">
            <div className="field"><label htmlFor="date_from">{t("من تاريخ (اختياري)", "From date (optional)")}</label><input id="date_from" name="date_from" type="date" /></div>
            <div className="field"><label htmlFor="date_to">{t("إلى تاريخ (اختياري)", "To date (optional)")}</label><input id="date_to" name="date_to" type="date" /></div>
            <div className="field"><label htmlFor="expiry">{t("مدة الصلاحية", "Valid for")}</label>
              <select id="expiry" name="expiry" defaultValue="24h"><option value="1h">{t("ساعة", "1 hour")}</option><option value="24h">{t("24 ساعة", "24 hours")}</option><option value="3d">{t("3 أيام", "3 days")}</option><option value="7d">{t("7 أيام", "7 days")}</option><option value="30d">{t("30 يوماً (الحد الأقصى)", "30 days (maximum)")}</option></select></div>
            <div className="field"><label htmlFor="max_attempts">{t("محاولات PIN قبل القفل", "PIN attempts before lock")}</label><input id="max_attempts" name="max_attempts" type="number" min={3} max={10} defaultValue={5} /></div>
          </div>

          <details className="fold"><summary>{t("تحديد أنواع قياسات/تحاليل بعينها (اختياري — الافتراضي حسب النطاق)", "Limit to specific measurement / lab types (optional)")}</summary>
            <div className="fold-body grid cols-3">{labObsTypes.map((x) => <label className="check small" key={x.id}><input type="checkbox" name="obs_type" value={x.id} />{lang === "ar" ? x.name_ar : x.name_en}</label>)}</div></details>

          <details className="fold"><summary>{t("اختيار سجلات محددة (لنطاق «سجلات أختارها»)", "Pick specific records (for the “only records I pick” scope)")}</summary>
            <div className="fold-body stack">
              {groups.map(([tb, title, list]) => list.length > 0 && (
                <div key={tb}><h3>{title}</h3><div className="stack">{list.map((r) => <label className="check small" key={r.id}><input type="checkbox" name="item" value={`${tb}:${r.id}`} />{r.label}</label>)}</div></div>
              ))}
            </div></details>

          <fieldset><legend>{t("صلاحيات الطبيب", "Doctor permissions")}</legend>
            <div className="stack">
              <label className="check"><input type="checkbox" name="allow_download" />{t("السماح بتنزيل الملفات", "Allow downloading files")}</label>
              <label className="check"><input type="checkbox" name="allow_print" />{t("السماح بالطباعة", "Allow printing")}</label>
              <label className="check"><input type="checkbox" name="allow_notes" />{t("السماح بترك ملاحظة لي (لا تُضاف لسجلي إلا بعد مراجعتي)", "Allow leaving me a note (never added to my record without my review)")}</label>
            </div>
            <p className="small muted">{t("ملاحظة: لا يمكن منع الطبيب تقنياً من تصوير الشاشة؛ التنزيل والطباعة ضوابط واجهة.", "Note: a doctor cannot be technically prevented from taking a screenshot; download and print are interface controls.")}</p>
          </fieldset>
          <div><SubmitButton pending={t("جارٍ الإنشاء…", "Creating…")}>{t("إنشاء الرابط والرمز", "Create link & PIN")}</SubmitButton></div>
        </ShareCreateShell>
      </div>
    </>
  );
}
