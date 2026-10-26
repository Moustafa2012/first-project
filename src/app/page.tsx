import Link from "next/link";
import { redirect } from "next/navigation";
import { FileHeart, Share2, LineChart, Layers } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { isConfigured } from "@/lib/env";
import { i18n } from "@/lib/i18n";
import { Topbar } from "@/components/Topbar";
import { Banner } from "@/components/ui";

export default async function Home() {
  const { t } = i18n();
  if (isConfigured() && (await currentUser())) redirect("/patients");
  const features = [
    [Layers, t("ملف صحي موحد", "One unified health file"), t("سجل رئيسي لكل مريض تتفرع منه ملفات الأقسام الطبية دون تكرار البيانات.", "A master record per patient with specialty files that share allergies, conditions and medications without copies.")],
    [LineChart, t("تتبع عبر الزمن", "Tracked over time"), t("ضغط، سكر، وزن، وتحاليل الدم والبول والبراز برسوم بيانية ومقارنة بين الفترات.", "Blood pressure, glucose, weight and blood/urine/stool tests with charts and period comparison.")],
    [Share2, t("مشاركة آمنة بـ PIN", "Secure PIN sharing"), t("رابط غير قابل للتخمين مع رمز PIN ومدة محددة ونطاق دقيق وإلغاء فوري وسجل وصول.", "An unguessable link plus PIN, expiry, exact scope, instant revocation and an access log.")],
    [FileHeart, t("مصدر وتوثيق لكل معلومة", "Provenance for every entry"), t("كل سجل يحمل تاريخ الحدث وتاريخ التسجيل ومصدره ومن أدخله، ولا يُمحى التاريخ الطبي.", "Every entry keeps event date, entry date, source and author; history is never erased.")],
  ] as const;
  return (
    <>
      <Topbar signedIn={false} />
      <main className="container">
        {!isConfigured() && (
          <Banner tone="warn" title={t("لم يُضبط الاتصال بقاعدة البيانات", "Database connection is not configured")}>
            {t("انسخ .env.example إلى .env.local وأدخل بيانات مشروع Supabase.", "Copy .env.example to .env.local and enter your Supabase project settings.")}
          </Banner>
        )}
        <section style={{ padding: "3rem 0 2rem", maxWidth: 760 }}>
          <h1 style={{ fontSize: "2.2rem" }}>{t("السجل الصحي الإلكتروني المتكامل", "A complete electronic health record")}</h1>
          <p className="muted" style={{ fontSize: "1.1rem" }}>
            {t("دوّن بياناتك الصحية وتاريخك الطبي وكل قياس وتحليل، وشاركها مع طبيبك بالقدر الذي تختاره فقط.",
               "Keep your health data, history, every measurement and test — and share exactly what you choose with your doctor.")}
          </p>
          <div className="row">
            <Link className="btn primary" href="/signup">{t("إنشاء حساب", "Create account")}</Link>
            <Link className="btn" href="/login">{t("تسجيل الدخول", "Sign in")}</Link>
          </div>
        </section>
        <div className="grid cols-4">
          {features.map(([I, title, body]) => (
            <div className="card" key={title}><I size={22} aria-hidden="true" color="var(--accent)" /><h3 style={{ marginBlockStart: ".5rem" }}>{title}</h3><p className="muted small">{body}</p></div>
          ))}
        </div>
        <p className="muted small" style={{ marginBlockStart: "2rem" }}>
          {t("المنصة أداة لتنظيم المعلومات ولا تقدم تشخيصاً أو علاجاً. التنبيهات مؤشرات تستدعي تقييم مختص.", "This platform organises information; it does not diagnose or treat. Flags are prompts for professional assessment.")}
        </p>
      </main>
    </>
  );
}
