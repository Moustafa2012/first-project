import Link from "next/link";
import { Plus, TriangleAlert } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { ageLabel } from "@/lib/format";
import { lbl, SEX } from "@/lib/labels";
import { Chip, Empty, PageHead } from "@/components/ui";
import type { PatientRow } from "@/lib/types";

export const metadata = { title: "المرضى" };

export default async function PatientsPage() {
  const { lang, t } = i18n();
  const supabase = createClient();
  const [{ data: patients }, { data: members }, { data: allergies }] = await Promise.all([
    supabase.from("patients").select("*").order("created_at"),
    supabase.from("patient_members").select("patient_id, role").is("revoked_at", null),
    supabase.from("allergies").select("patient_id").eq("status", "active").eq("record_status", "active"),
  ]);
  const roleOf = new Map((members ?? []).map((m) => [m.patient_id as string, m.role as string]));
  const allergic = new Set((allergies ?? []).map((a) => a.patient_id as string));
  const list = (patients ?? []) as PatientRow[];
  return (
    <>
      <PageHead
        title={t("ملفات المرضى", "Patient files")}
        sub={t("لكل مريض ملف صحي مستقل. يمكنك إدارة ملفك وملفات من ترعاهم (الأطفال مثلاً).", "Each patient has an independent health file. Manage your own and those you care for, such as children.")}
        actions={<Link className="btn primary" href="/patients/new"><Plus size={16} aria-hidden="true" />{t("ملف جديد", "New file")}</Link>}
      />
      {list.length === 0 ? (
        <Empty>
          <p>{t("لا توجد ملفات بعد. أنشئ ملفك الصحي الأول.", "No files yet. Create your first health file.")}</p>
          <Link className="btn primary" href="/patients/new">{t("إنشاء ملف", "Create a file")}</Link>
        </Empty>
      ) : (
        <div className="grid cols-3">
          {list.map((p) => (
            <Link key={p.id} href={`/patients/${p.id}`} className="card" style={{ textDecoration: "none", color: "inherit" }}>
              <h2 style={{ marginBlockEnd: ".2rem" }}>{lang === "en" && p.full_name_en ? p.full_name_en : p.full_name}</h2>
              <p className="muted small"><span className="ltr">{p.mrn}</span> · {ageLabel(p.date_of_birth, lang)} · {lbl(SEX, p.sex, lang)}</p>
              <div className="row">
                <Chip tone="info">{roleOf.get(p.id) === "guardian" ? t("ولي أمر", "Guardian") : roleOf.get(p.id) === "owner" ? t("ملفك", "Your file") : t("رعاية", "Care")}</Chip>
                {allergic.has(p.id) && <Chip tone="bad"><TriangleAlert size={13} aria-hidden="true" />{t("حساسية موثقة", "Allergies on file")}</Chip>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
