import { Printer, Siren } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getPatient } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { asCard } from "@/lib/care/emergency";
import { Banner, Card, Chip, Empty, PageHead } from "@/components/ui";
import { EmergencyCardView } from "@/components/care/EmergencyCardView";
import { EmergencyPanel } from "@/components/care/EmergencyPanel";

export const metadata = { title: "بطاقة الطوارئ" };

export default async function EmergencyPage({ params }: { params: { pid: string } }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const p = await getPatient(params.pid);
  const access = await getAccess(p.id);
  const supabase = createClient();
  const [{ data: raw }, { data: setting }, { data: logs }] = await Promise.all([
    supabase.rpc("emergency_preview", { p_patient: p.id }),
    access.canManage ? supabase.from("emergency_cards").select("enabled, include_sensitive, include_contacts, enabled_at, disabled_at, regenerated_at").eq("patient_id", p.id).maybeSingle() : Promise.resolve({ data: null }),
    access.canManage ? supabase.from("emergency_access_logs").select("id, event, at").eq("patient_id", p.id).order("at", { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
  ]);
  const card = asCard(raw);
  const enabled = Boolean(setting?.enabled);
  return (
    <>
      <div className="no-print">
        <PageHead title={t("بطاقة الطوارئ", "Emergency card")}
          sub={t("ملخص قصير لحالات الطوارئ: فصيلة الدم والحساسية والأمراض المزمنة والأدوية الدائمة والأجهزة وجهات الاتصال. يمكن طباعته أو إتاحته برمز QR لرابط للقراءة فقط.", "A short summary for emergencies: blood group, allergies, chronic conditions, long-term medicines, devices and contacts. Print it, or offer it through a QR code to a read-only link.")}
          actions={<a className="btn" href={`/api/patients/${p.id}/emergency/pdf`} target="_blank" rel="noopener"><Printer size={16} aria-hidden="true" />{t("بطاقة PDF", "PDF card")}</a>} />
      </div>
      {access.canManage && (
        <div className="no-print">
          <Card title={<><Siren size={18} aria-hidden="true" /> {t("الرابط العام للطوارئ", "Public emergency link")}</>}
            description={t("من يملك الرابط أو الرمز يرى هذه البطاقة فقط، بلا PIN. تُسجَّل كل مشاهدة، ويمكنك إيقافه أو تجديده في أي لحظة.", "Anyone with the link or code sees this card only, with no PIN. Every view is logged, and you can switch it off or renew it at any moment.")}>
            <EmergencyPanel pid={p.id} enabled={enabled} includeSensitive={Boolean(setting?.include_sensitive)} includeContacts={setting ? Boolean(setting.include_contacts) : true} canManage
              labels={{
                on: t("الرابط يعمل", "Link is on"), off: t("الرابط متوقف", "Link is off"), enable: t("تفعيل الرابط", "Switch the link on"), regenerate: t("تجديد الرابط", "Regenerate the link"),
                disable: t("إيقاف الرابط", "Switch the link off"), confirmRegenerate: t("تجديد الرابط يُبطل الرابط القديم وكل رمز مطبوع منه. متابعة؟", "Regenerating invalidates the old link and every code printed from it. Continue?"),
                confirmDisable: t("إيقاف الرابط؟ سيتوقف كل رمز QR مطبوع.", "Switch the link off? Every printed QR code will stop working."),
                sensitive: t("إظهار العناصر الحساسة أيضاً (أمراض وأدوية وسمتها «حساسة»)", "Also show items I marked sensitive (conditions and medicines)"),
                sensitiveHint: t("الافتراضي: لا تظهر. لا يظهر أي شيء آخر غير حقول البطاقة.", "By default they are left out. Nothing beyond the card fields is ever shown."),
                contacts: t("إظهار جهات الطوارئ وأرقامها", "Show the emergency contacts and their numbers"), save: t("حفظ", "Save"),
                linkTitle: t("رابطك الجديد", "Your new link"), linkWarn: t("يظهر الرابط والرمز الآن فقط؛ نحفظ بصمته لا الرابط نفسه. انسخه أو اطبع البطاقة الآن.", "The link and code are shown now only; we keep its fingerprint, not the link. Copy it or print the card now."),
                link: t("الرابط", "Link"), copy: t("نسخ", "Copy"), copied: t("تم النسخ", "Copied"), qr: t("رمز QR لرابط الطوارئ", "QR code of the emergency link"),
                pdfWithQr: t("بطاقة PDF برمز QR", "PDF card with QR"), print: t("طباعة هذه الصفحة", "Print this page"),
                hint: t("ضع الرمز على بطاقة المحفظة أو خلفية الهاتف. إن ضاع، جدّد الرابط فيتوقف القديم.", "Put the code on a wallet card or the phone lock screen. If it is lost, regenerate the link and the old one stops."),
              }} />
            {setting && <p className="muted small" style={{ marginBlockStart: ".6rem" }}>
              {setting.enabled_at ? `${t("فُعّل", "Switched on")}: ${fmtDateTime(setting.enabled_at, lang, tz)}` : ""}{setting.regenerated_at ? ` · ${t("جُدّد", "Regenerated")}: ${fmtDateTime(setting.regenerated_at, lang, tz)}` : ""}{setting.disabled_at && !setting.enabled ? ` · ${t("أُوقف", "Switched off")}: ${fmtDateTime(setting.disabled_at, lang, tz)}` : ""}</p>}
          </Card>
          <Card title={t("آخر الزيارات للرابط", "Latest visits to the link")}>
            {(logs ?? []).length === 0 ? <Empty>{t("لم يُفتح الرابط بعد.", "The link has not been opened yet.")}</Empty> : (logs ?? []).map((l) => (
              <div key={l.id} className="row between"><Chip tone={l.event === "viewed" ? "info" : "warn"}>{l.event === "viewed" ? t("فُتحت البطاقة", "Card opened") : t("محاولة على رابط موقوف", "Attempt on a switched-off link")}</Chip><span className="muted small">{fmtDateTime(l.at, lang, tz)}</span></div>))}
          </Card>
        </div>
      )}
      {card ? (
        <section className="print-area" aria-label={t("بطاقة الطوارئ", "Emergency card")}>
          <EmergencyCardView card={card} lang={lang} />
        </section>
      ) : <Banner tone="warn">{t("تعذر تحميل البطاقة.", "The card could not be loaded.")}</Banner>}
      <div className="no-print"><p className="muted small">{t("هذه هي البطاقة نفسها التي يراها من يفتح الرابط. الأمراض والأدوية المعلَّمة «حساسة» لا تظهر ما لم تسمح بذلك.", "This is the same card the link shows. Conditions and medicines marked sensitive are left out unless you allow them.")}</p></div>
    </>
  );
}
