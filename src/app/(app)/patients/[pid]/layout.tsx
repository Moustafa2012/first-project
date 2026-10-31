import Link from "next/link";
import { TriangleAlert, ShieldCheck, CircleHelp, Printer } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getPatient, getSpecialtyUsage } from "@/lib/data";
import { ageLabel } from "@/lib/format";
import { ALLERGY_SEVERITY, lbl, SEX } from "@/lib/labels";
import { SideNav, type NavItem } from "@/components/SideNav";
import { Chip } from "@/components/ui";
import { Avatar } from "@/components/Avatar";

export default async function PatientLayout({ children, params }: { children: React.ReactNode; params: { pid: string } }) {
  const { lang, t } = i18n();
  // one wave of round trips instead of three in a row
  const [p, access, used, { data: allergies }] = await Promise.all([
    getPatient(params.pid),
    getAccess(params.pid),
    getSpecialtyUsage(params.pid),
    createClient().from("allergies").select("substance, severity").eq("patient_id", params.pid).eq("status", "active").eq("record_status", "active").neq("certainty", "refuted").limit(6),
  ]);
  const base = `/patients/${p.id}`;

  // the menu follows the patient's journey: summary and core file, follow-up, the specialties this file uses (with a way
  // to open another), the general records, then documents and sharing
  const follow = t("المتابعة", "Follow-up"), specs = t("الأقسام الطبية", "Specialty files"), recs = t("السجلات", "Records"), docs = t("المستندات والمشاركة", "Documents & sharing");
  const items: NavItem[] = [
    { href: base, label: t("الملخص", "Summary"), short: t("الملخص", "Summary") },
    { href: `${base}/profile`, label: t("الملف الأساسي", "Core file"), short: t("الأساسي", "Core") },
    { href: `${base}/timeline`, label: t("الخط الزمني", "Timeline") },
    { href: `${base}/vitals`, label: t("القياسات (ضغط، سكر…)", "Vitals (BP, glucose…)"), short: t("القياسات", "Vitals"), group: follow },
    { href: `${base}/labs`, label: t("التحاليل المخبرية", "Lab results"), short: t("التحاليل", "Labs"), group: follow },
    { href: `${base}/test-orders`, label: t("الفحوصات المطلوبة", "Requested tests"), group: follow },
    { href: `${base}/care-plans`, label: t("خطط المتابعة", "Care plans"), group: follow },
    ...used.map((u): NavItem => ({
      href: u.code === "dentistry" ? `${base}/dental` : `${base}/specialties/${u.code}`,
      label: lang === "ar" ? u.name_ar : u.name_en, icon: u.icon, group: specs,
    })),
    { href: `${base}/specialties`, label: used.length ? t("فتح قسم آخر", "Open another specialty") : t("الأقسام الطبية", "Specialty files"), group: specs, exact: true },
    { href: `${base}/conditions`, label: t("الأمراض والتشخيصات", "Conditions"), group: recs },
    { href: `${base}/allergies`, label: t("الحساسية", "Allergies"), group: recs },
    { href: `${base}/medications`, label: t("الأدوية", "Medications"), group: recs },
    { href: `${base}/visits`, label: t("الزيارات", "Visits"), group: recs },
    { href: `${base}/procedures`, label: t("العمليات والإجراءات", "Procedures"), group: recs },
    { href: `${base}/imaging`, label: t("الأشعة والتصوير", "Imaging"), group: recs },
    { href: `${base}/appointments`, label: t("المواعيد", "Appointments"), group: recs },
    { href: `${base}/notes`, label: t("الملاحظات", "Notes"), group: recs },
    { href: `${base}/immunizations`, label: t("التطعيمات", "Immunizations"), group: recs },
    { href: `${base}/family-history`, label: t("التاريخ العائلي", "Family history"), group: recs },
    { href: `${base}/documents`, label: t("المستندات والتقارير", "Documents"), short: t("المستندات", "Files"), group: docs },
    ...(access.canShare ? [
      { href: `${base}/sharing`, label: t("المشاركة مع طبيب", "Share with a doctor"), group: docs },
      ...(access.canManage ? [{ href: `${base}/audit`, label: t("سجل التغييرات", "Change history"), group: docs }] : []),
    ] : []),
  ];

  const list = allergies ?? [];
  return (
    <>
      <header className="card patient-head" style={{ marginBlockEnd: "1.25rem" }}>
        <div className="row between">
          <div className="row" style={{ flexWrap: "nowrap", gap: ".9rem" }}>
            <Avatar name={lang === "en" && p.full_name_en ? p.full_name_en : p.full_name} src={p.photo_path ? `/api/avatar?p=${p.id}&v=${encodeURIComponent(p.updated_at)}` : null} />
          <div>
            <h1 style={{ marginBottom: ".1rem" }}>{lang === "en" && p.full_name_en ? p.full_name_en : p.full_name}</h1>
            <p className="muted" style={{ margin: 0 }}>
              <span className="ltr">{p.mrn}</span> · {ageLabel(p.date_of_birth, lang)} · {lbl(SEX, p.sex, lang)}
              {p.nationality ? ` · ${p.nationality}` : ""}
            </p>
          </div>
          </div>
          <div className="row">
            <a className="btn sm" href={`/api/patients/${p.id}/report?scope=full`} target="_blank" rel="noopener"><Printer size={14} aria-hidden="true" />{t("تقرير PDF", "PDF report")}</a>
            {p.blood_abo ? <Chip tone="info" title={p.blood_group_verified ? t("موثقة", "Verified") : t("غير موثقة", "Unverified")}>{t("الدم", "Blood")}: <span className="ltr">{p.blood_abo}{p.blood_rh ?? ""}</span>{p.blood_group_verified ? "" : " *"}</Chip> : <Chip tone="muted">{t("فصيلة الدم غير مسجلة", "Blood group not recorded")}</Chip>}
          </div>
        </div>
        <div style={{ marginBlockStart: ".75rem" }}>
          {list.length > 0 ? (
            <div className="banner bad" role="alert">
              <TriangleAlert size={18} aria-hidden="true" style={{ flex: "none", marginBlockStart: 3 }} />
              <div><strong>{t("حساسية موثقة", "Documented allergies")}:</strong>{" "}
                {list.map((a, i) => <span key={i}>{i ? "، " : ""}{a.substance} ({lbl(ALLERGY_SEVERITY, a.severity, lang)})</span>)}</div>
            </div>
          ) : p.allergy_assertion === "none_known" ? (
            <div className="banner ok"><ShieldCheck size={18} aria-hidden="true" /><div>{t("لا توجد حساسية معروفة (إقرار مسجل).", "No known allergies (recorded statement).")}</div></div>
          ) : (
            <div className="banner warn"><CircleHelp size={18} aria-hidden="true" /><div><strong>{t("حالة الحساسية غير معروفة", "Allergy status unknown")}</strong> — {t("لم تُسجَّل بعد؛ لا يعني ذلك عدم وجود حساسية.", "not recorded yet; this does not mean there are none.")}</div></div>
          )}
        </div>
      </header>
      {p.deletion_requested_at && (
        <div className="banner warn" role="alert" style={{ marginBlockEnd: "1rem" }}>
          <TriangleAlert size={18} aria-hidden="true" style={{ flex: "none", marginBlockStart: 3 }} />
          <div>
            <strong>{t("هذا الملف مجدول للحذف", "This file is scheduled for deletion")}</strong> — {t("للقراءة فقط. ", "read-only. ")}
            {access.canManage && <Link href={`${base}/delete`}>{t("استعادة أو حذف الآن", "Restore or delete now")}</Link>}
          </div>
        </div>
      )}
      <div className="layout">
        <SideNav items={items} label={t("أقسام الملف", "File sections")} moreLabel={t("المزيد", "More")} closeLabel={t("إغلاق", "Close")} />
        <div className="stack" style={{ minWidth: 0 }}>{children}</div>
      </div>
    </>
  );
}
