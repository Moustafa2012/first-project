import { TriangleAlert, ShieldCheck, CircleHelp } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getPatient } from "@/lib/data";
import { ageLabel } from "@/lib/format";
import { ALLERGY_SEVERITY, lbl, SEX } from "@/lib/labels";
import { SideNav, type NavItem } from "@/components/SideNav";
import { Chip } from "@/components/ui";

const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => Array.from(w)[0] ?? "").join("").toUpperCase();

export default async function PatientLayout({ children, params }: { children: React.ReactNode; params: { pid: string } }) {
  const { lang, t } = i18n();
  const p = await getPatient(params.pid);
  const access = await getAccess(p.id);
  const base = `/patients/${p.id}`;
  const { data: allergies } = await createClient().from("allergies")
    .select("substance, severity").eq("patient_id", p.id).eq("status", "active").eq("record_status", "active").neq("certainty", "refuted").limit(6);

  const items: NavItem[] = [
    { href: base, label: t("نظرة عامة", "Overview") },
    { href: `${base}/profile`, label: t("البيانات الشخصية", "Personal details") },
    { href: `${base}/timeline`, label: t("الخط الزمني", "Timeline") },
    { href: `${base}/conditions`, label: t("الأمراض والتشخيصات", "Conditions"), group: t("الملخص الصحي", "Health summary") },
    { href: `${base}/allergies`, label: t("الحساسية", "Allergies"), group: t("الملخص الصحي", "Health summary") },
    { href: `${base}/medications`, label: t("الأدوية", "Medications"), group: t("الملخص الصحي", "Health summary") },
    { href: `${base}/family-history`, label: t("التاريخ العائلي", "Family history"), group: t("الملخص الصحي", "Health summary") },
    { href: `${base}/immunizations`, label: t("التطعيمات", "Immunizations"), group: t("الملخص الصحي", "Health summary") },
    { href: `${base}/vitals`, label: t("القياسات (ضغط، سكر…)", "Vitals (BP, glucose…)"), group: t("التتبع", "Tracking") },
    { href: `${base}/labs`, label: t("التحاليل المخبرية", "Lab results"), group: t("التتبع", "Tracking") },
    { href: `${base}/test-orders`, label: t("الفحوصات المطلوبة", "Requested tests"), group: t("التتبع", "Tracking") },
    { href: `${base}/visits`, label: t("الزيارات", "Visits"), group: t("الرعاية", "Care") },
    { href: `${base}/procedures`, label: t("العمليات والإجراءات", "Procedures"), group: t("الرعاية", "Care") },
    { href: `${base}/imaging`, label: t("الأشعة والتصوير", "Imaging"), group: t("الرعاية", "Care") },
    { href: `${base}/appointments`, label: t("المواعيد", "Appointments"), group: t("الرعاية", "Care") },
    { href: `${base}/care-plans`, label: t("خطط المتابعة", "Care plans"), group: t("الرعاية", "Care") },
    { href: `${base}/notes`, label: t("الملاحظات", "Notes"), group: t("الرعاية", "Care") },
    { href: `${base}/specialties`, label: t("الأقسام الطبية", "Specialty files"), group: t("الملفات", "Files") },
    { href: `${base}/documents`, label: t("المستندات والتقارير", "Documents"), group: t("الملفات", "Files") },
    ...(access.canShare ? [
      { href: `${base}/sharing`, label: t("المشاركة مع طبيب", "Share with a doctor"), group: t("الخصوصية", "Privacy") },
      ...(access.canManage ? [{ href: `${base}/audit`, label: t("سجل التغييرات", "Change history"), group: t("الخصوصية", "Privacy") }] : []),
    ] : []),
  ];

  const list = allergies ?? [];
  return (
    <>
      <header className="card patient-head" style={{ marginBlockEnd: "1.25rem" }}>
        <div className="row between">
          <div className="row" style={{ flexWrap: "nowrap", gap: ".9rem" }}>
            <div className="avatar" aria-hidden="true">{initials(lang === "en" && p.full_name_en ? p.full_name_en : p.full_name)}</div>
          <div>
            <h1 style={{ marginBottom: ".1rem" }}>{lang === "en" && p.full_name_en ? p.full_name_en : p.full_name}</h1>
            <p className="muted" style={{ margin: 0 }}>
              <span className="ltr">{p.mrn}</span> · {ageLabel(p.date_of_birth, lang)} · {lbl(SEX, p.sex, lang)}
              {p.nationality ? ` · ${p.nationality}` : ""}
            </p>
          </div>
          </div>
          <div className="row">
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
      <div className="layout">
        <SideNav items={items} label={t("أقسام الملف", "File sections")} />
        <div className="stack" style={{ minWidth: 0 }}>{children}</div>
      </div>
    </>
  );
}
