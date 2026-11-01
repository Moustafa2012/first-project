import { notFound } from "next/navigation";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { currentProfile } from "@/lib/auth";
import { getTz } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { DEVICE_KIND } from "@/lib/labels";
import { PROC_CATEGORY } from "@/lib/treatment";
import { parseRuleRow, type SafetyRuleRow } from "@/lib/safety-rules";
import { Banner, Card, Chip, PageHead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { reviewSafetyRule, saveSafetyRule } from "@/app/actions/admin";

export const dynamic = "force-dynamic";

const SEVERITY = [["danger", "عالية", "High"], ["warn", "متوسطة", "Medium"], ["info", "معلومة", "Information"]] as const;

export default async function AdminSafetyRules() {
  const { lang, t } = i18n();
  const tz = getTz();
  if ((await currentProfile())?.role !== "admin") notFound();
  const supabase = createClient();
  const { data } = await supabase.from("safety_rules").select("*").order("sort");
  const rules = (data ?? []).map((r) => parseRuleRow(r as Record<string, unknown>));
  const reviewerIds = [...new Set(rules.map((r) => r.reviewed_by).filter((x): x is string => Boolean(x)))];
  const { data: people } = reviewerIds.length ? await supabase.from("profiles").select("id, full_name").in("id", reviewerIds) : { data: [] as { id: string; full_name: string }[] };
  const nameOf = (id: string | null | undefined) => (people ?? []).find((p) => p.id === id)?.full_name ?? "";
  const lines = (v: string[] | undefined) => (v ?? []).join("\n");

  const form = (r?: SafetyRuleRow) => {
    const m = r?.match ?? {};
    const p = (s: string) => `${r?.id ?? "new"}_${s}`;
    return (
      <ActionForm action={saveSafetyRule} className="stack" resetOnSuccess={!r} id={r ? `rule-${r.code}` : "rule-new"}>
        {r && <input type="hidden" name="_id" value={r.id} />}
        <div className="form-grid">
          {!r && <div className="field"><label htmlFor={p("code")}>{t("الرمز (إنجليزي)", "Code")}</label><input id={p("code")} name="code" required pattern="[a-z][a-z0-9_]{2,60}" dir="ltr" /></div>}
          <div className="field"><label htmlFor={p("sev")}>{t("الدرجة", "Severity")}</label>
            <select id={p("sev")} name="severity" defaultValue={r?.severity ?? "warn"}>{SEVERITY.map(([v, ar, en]) => <option key={v} value={v}>{lang === "ar" ? ar : en}</option>)}</select></div>
          <div className="field"><label htmlFor={p("spec")}>{t("رمز التخصص", "Specialty code")}</label><input id={p("spec")} name="specialty_code" defaultValue={r?.specialty_code ?? "dentistry"} dir="ltr" required /></div>
          <div className="field"><label htmlFor={p("sort")}>{t("الترتيب", "Order")}</label><input id={p("sort")} name="sort" type="number" defaultValue={r?.sort ?? 0} /></div>
          <div className="field wide"><label htmlFor={p("tar")}>{t("العنوان بالعربية", "Arabic title")}</label><input id={p("tar")} name="title_ar" defaultValue={r?.title_ar} required maxLength={120} /></div>
          <div className="field wide"><label htmlFor={p("ten")}>{t("العنوان بالإنجليزية", "English title")}</label><input id={p("ten")} name="title_en" defaultValue={r?.title_en} required dir="ltr" maxLength={120} /></div>
          <div className="field wide"><label htmlFor={p("mar")}>{t("الرسالة بالعربية", "Arabic message")}</label><textarea id={p("mar")} name="message_ar" rows={3} defaultValue={r?.message_ar} required maxLength={700} /></div>
          <div className="field wide"><label htmlFor={p("men")}>{t("الرسالة بالإنجليزية", "English message")}</label><textarea id={p("men")} name="message_en" rows={3} defaultValue={r?.message_en} required dir="ltr" maxLength={700} /></div>
          <div className="field wide"><label htmlFor={p("ref")}>{t("المرجع", "Reference")}</label><input id={p("ref")} name="reference" defaultValue={r?.reference ?? ""} maxLength={500} /></div>
        </div>
        <fieldset className="stack"><legend>{t("ما في الملف يُفعّل القاعدة (يكفي واحد)", "What in the file raises it (any one)")}</legend>
          <p className="small muted" style={{ margin: 0 }}>{t("كلمات مفتاحية، كل كلمة في سطر أو مفصولة بفاصلة؛ تُقارن بالأسماء بلا تشكيل ولا اختلاف في الهمزات.", "Keywords, one per line or comma separated; compared with the names in the file without diacritics or letter-form differences.")}</p>
          <div className="form-grid">
            <div className="field"><label htmlFor={p("c")}>{t("الأمراض والحالات", "Conditions")}</label><textarea id={p("c")} name="conditions" rows={3} dir="auto" defaultValue={lines(m.conditions)} /></div>
            <div className="field"><label htmlFor={p("m")}>{t("الأدوية", "Medicines")}</label><textarea id={p("m")} name="medications" rows={3} dir="auto" defaultValue={lines(m.medications)} /></div>
            <div className="field"><label htmlFor={p("a")}>{t("الحساسية", "Allergies")}</label><textarea id={p("a")} name="allergies" rows={3} dir="auto" defaultValue={lines(m.allergies)} /></div>
            <div className="field"><label htmlFor={p("h")}>{t("HbA1c يساوي أو يزيد على", "HbA1c at or above")}</label><input id={p("h")} name="hba1c_gte" type="number" step="0.1" min={3} max={20} dir="ltr" defaultValue={m.labs?.find((x) => x.code === "hba1c")?.gte ?? ""} /></div>
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: ".5rem" }}>
            <label className="check"><input type="checkbox" name="pregnancy" defaultChecked={Boolean(m.pregnancy)} />{t("الحمل", "Pregnancy")}</label>
            {DEVICE_KIND.filter((d) => d.value !== "other").map((d) => <label className="check small" key={d.value}><input type="checkbox" name="devices" value={d.value} defaultChecked={m.devices?.includes(d.value)} />{d[lang]}</label>)}
          </div>
        </fieldset>
        <fieldset className="stack"><legend>{t("ما تتعلق به القاعدة (اختياري)", "What it is about (optional)")}</legend>
          <p className="small muted" style={{ margin: 0 }}>{t("إن حدّدتَ إجراءات أو أدوية فلا تظهر القاعدة إلا بجانب علاج مخطط من هذا النوع أو دواء يُوصف؛ وإلا فهي تذكير عن المريض.", "With procedures or drugs chosen, the rule appears only next to a planned treatment of that kind or a drug being prescribed; otherwise it is a reminder about the patient.")}</p>
          <div className="row" style={{ flexWrap: "wrap", gap: ".5rem" }}>
            {PROC_CATEGORY.map((c) => <label className="check small" key={c.value}><input type="checkbox" name="proc_categories" value={c.value} defaultChecked={m.procedures?.categories?.includes(c.value)} />{c[lang]}</label>)}
          </div>
          <div className="form-grid">
            <div className="field"><label htmlFor={p("pc")}>{t("رموز إجراءات الكتالوج", "Procedure catalogue codes")}</label><textarea id={p("pc")} name="proc_codes" rows={2} dir="ltr" defaultValue={(m.procedures?.codes ?? []).join(", ")} /></div>
            <div className="field"><label htmlFor={p("d")}>{t("أدوية توصف", "Drugs being prescribed")}</label><textarea id={p("d")} name="drugs" rows={2} dir="auto" defaultValue={lines(m.drugs)} /></div>
          </div>
        </fieldset>
        <label className="check"><input type="checkbox" name="is_active" defaultChecked={r?.is_active ?? true} />{t("فعّالة (تظهر للمستخدمين)", "Active (shown to users)")}</label>
        <div><SubmitButton>{t("حفظ القاعدة", "Save the rule")}</SubmitButton></div>
      </ActionForm>
    );
  };

  return (
    <>
      <PageHead title={t("قواعد تنبيهات السلامة", "Safety alert rules")}
        sub={t("قواعد تُطابَق مع الملف والعلاج المخطط فتظهر تنبيهات للمراجعة. تفعيلها وتعديلها وتسجيل مراجعتها من هنا.", "Rules matched against the file and the planned treatment to show reminders to review. Activate, edit and record their review here.")} />
      <Banner tone="info">{t("أي تعديل على نص القاعدة أو شروطها يرفع نسختها ويُلغي مراجعتها حتى تراجعها من جديد. القواعد المبدئية غير مراجَعة سريرياً. ليس للمسؤول صلاحية على بيانات المرضى.",
        "Any change to what a rule says or when it applies raises its version and clears its review until you review it again. The starting rules have not been clinically reviewed. Administrators have no access to patient data.")}</Banner>
      <Card title={t("قاعدة جديدة", "New rule")}>{form()}</Card>
      {rules.map((r) => (
        <details className="fold" key={r.id} id={`r-${r.code}`}>
          <summary>
            <strong>{lang === "ar" ? r.title_ar : r.title_en}</strong>{" "}
            <Chip tone={r.severity === "danger" ? "bad" : r.severity === "warn" ? "warn" : "info"}>{SEVERITY.find((s) => s[0] === r.severity)?.[lang === "ar" ? 1 : 2]}</Chip>{" "}
            {r.is_active ? <Chip tone="ok">{t("فعّالة", "Active")}</Chip> : <Chip tone="muted">{t("معطّلة", "Inactive")}</Chip>}{" "}
            {r.reviewed_at ? <Chip tone="ok" title={nameOf(r.reviewed_by)}>{t("روجعت", "Reviewed")}</Chip> : <Chip tone="warn">{t("لم تُراجع", "Not reviewed")}</Chip>}{" "}
            <span className="muted small ltr">{r.code} · v{r.version}</span>
          </summary>
          <div className="fold-body stack">
            <p className="small muted" style={{ margin: 0 }}>
              {r.reviewed_at
                ? t(`راجعها ${nameOf(r.reviewed_by) || "مسؤول"} في ${fmtDateTime(r.reviewed_at, lang, tz)}`, `Reviewed by ${nameOf(r.reviewed_by) || "an administrator"} on ${fmtDateTime(r.reviewed_at, lang, tz)}`)
                : t("لم تُراجع هذه النسخة بعد.", "This version has not been reviewed yet.")}
            </p>
            {!r.reviewed_at && (
              <form action={reviewSafetyRule}><input type="hidden" name="_id" value={r.id} /><button className="btn sm primary">{t("سجّل أنني راجعتها", "Record that I reviewed it")}</button></form>
            )}
            {form(r)}
          </div>
        </details>
      ))}
    </>
  );
}
