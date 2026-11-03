import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, FileHeart, Share2, LineChart, Layers, ShieldCheck } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { isConfigured } from "@/lib/env";
import { i18n } from "@/lib/i18n";
import { Topbar } from "@/components/Topbar";
import { Banner } from "@/components/ui";
import { Footer } from "@/components/Footer";
import { HeroArt } from "@/components/HeroArt";

export default async function Home() {
  const { t } = i18n();
  if (isConfigured() && (await currentUser())) redirect("/patients");
  const features = [
    [Layers, t("ملف صحي موحد", "One unified health file"), t("سجل رئيسي لكل مريض تتفرع منه ملفات الأقسام الطبية دون تكرار البيانات.", "A master record per patient with specialty files that share allergies, conditions and medications without copies.")],
    [LineChart, t("تتبع عبر الزمن", "Tracked over time"), t("ضغط، سكر، وزن، وتحاليل الدم والبول والبراز برسوم بيانية ومقارنة بين الفترات.", "Blood pressure, glucose, weight and blood/urine/stool tests with charts and period comparison.")],
    [Share2, t("مشاركة آمنة بـ PIN", "Secure PIN sharing"), t("رابط غير قابل للتخمين مع رمز PIN ومدة محددة ونطاق دقيق وإلغاء فوري وسجل وصول.", "An unguessable link plus PIN, expiry, exact scope, instant revocation and an access log.")],
    [FileHeart, t("مصدر وتوثيق لكل معلومة", "Provenance for every entry"), t("كل سجل يحمل تاريخ الحدث وتاريخ التسجيل ومصدره ومن أدخله، ولا يُمحى التاريخ الطبي.", "Every entry keeps event date, entry date, source and author; history is never erased.")],
  ] as const;
  const steps = [
    [t("أنشئ ملفاً لكل فرد", "Create a file per person"), t("لك ولأطفالك ولمن ترعاهم، وكل ملف مستقل تماماً.", "For you, your children and those you care for; each file is fully independent.")],
    [t("دوّن وتتبّع", "Record and track"), t("أضف القياسات والتحاليل والأدوية والزيارات والمستندات.", "Add measurements, tests, medications, visits and documents.")],
    [t("شارك بأمان", "Share securely"), t("أنشئ رابطاً مع PIN بنطاق ومدة محددين، وألغِه متى شئت.", "Create a PIN-protected link with a precise scope and expiry; revoke any time.")],
  ] as const;
  const trust = [
    t("عزل كامل للبيانات بين الحسابات على مستوى قاعدة البيانات", "Strict per-account data isolation enforced in the database"),
    t("لا حذف للسجلات الطبية؛ التصحيح يحفظ النسخة السابقة", "Medical records are never deleted; corrections keep the previous version"),
    t("سجل وصول كامل لكل مشاركة (محاولات PIN والمستندات المفتوحة)", "Full access log per share (PIN attempts, documents opened)"),
    t("المستندات في تخزين خاص ولا تُعرض إلا عبر الخادم", "Documents live in private storage and are served only through the server"),
  ];
  return (
    <>
      <Topbar signedIn={false} />
      <main id="main" className="container">
        {!isConfigured() && (
          <Banner tone="warn" title={t("لم يُضبط الاتصال بقاعدة البيانات", "Database connection is not configured")}>
            {t("انسخ .env.example إلى .env.local وأدخل بيانات مشروع Supabase.", "Copy .env.example to .env.local and enter your Supabase project settings.")}
          </Banner>
        )}
        <section className="hero">
          <div>
            <span className="eyebrow"><ShieldCheck size={14} aria-hidden="true" />{t("سجل صحي إلكتروني آمن", "Secure electronic health record")}</span>
            <h1>{t("السجل الصحي الإلكتروني المتكامل", "A complete electronic health record")}</h1>
            <p>
              {t("دوّن بياناتك الصحية وتاريخك الطبي وكل قياس وتحليل، وشاركها مع طبيبك بالقدر الذي تختاره فقط.",
                 "Keep your health data, history, every measurement and test — and share exactly what you choose with your doctor.")}
            </p>
            <div className="row" style={{ marginBlockStart: "1.25rem" }}>
              <Link className="btn primary lg" href="/signup">{t("إنشاء حساب", "Create account")}</Link>
              <Link className="btn lg" href="/login">{t("تسجيل الدخول", "Sign in")}</Link>
            </div>
          </div>
          <div className="hero-art"><HeroArt /></div>
        </section>

        <section className="section">
          <h2>{t("كل ما يحتاجه ملفك الصحي", "Everything a health file needs")}</h2>
          <p className="lead">{t("أدوات مصممة للدقة والخصوصية والوضوح.", "Tools designed for accuracy, privacy and clarity.")}</p>
          <div className="grid cols-4">
            {features.map(([I, title, body]) => (
              <div className="card feature" key={title}><div className="ficon"><I size={22} aria-hidden="true" /></div><h3>{title}</h3><p className="muted small">{body}</p></div>
            ))}
          </div>
        </section>

        <section className="section">
          <h2>{t("كيف تعمل المنصة", "How it works")}</h2>
          <p className="lead">{t("ثلاث خطوات بسيطة.", "Three simple steps.")}</p>
          <ol className="steps">
            {steps.map(([title, body]) => <li key={title}><h3>{title}</h3><p className="muted small" style={{ margin: 0 }}>{body}</p></li>)}
          </ol>
        </section>

        <section className="section">
          <h2>{t("الخصوصية والأمان أولاً", "Privacy and safety first")}</h2>
          <p className="lead">{t("ضمانات مُطبَّقة في النظام وليست وعوداً.", "Guarantees built into the system, not promises.")}</p>
          <div className="trust">{trust.map((x) => <div key={x}><CheckCircle2 size={18} aria-hidden="true" /><span>{x}</span></div>)}</div>
        </section>
      </main>
      <Footer />
    </>
  );
}
