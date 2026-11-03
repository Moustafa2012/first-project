import Link from "next/link";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { validInviteToken } from "@/lib/care/members";
import { Banner, Card } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { acceptInvite } from "@/app/actions/care";

export const dynamic = "force-dynamic";
export const metadata = { title: "دعوة", robots: { index: false, follow: false } };

/** The invitation link: the invited account (signed in with the invited e-mail address) sees what it is invited to, and accepts. */
export default async function InvitePage({ params }: { params: { token: string } }) {
  const { lang, t } = i18n();
  let status = "unavailable"; let info: { access?: string; patient_name?: string; patient_name_en?: string | null; expires_at?: string } = {};
  if (validInviteToken(params.token)) {
    const { data } = await createClient().rpc("member_invite_preview", { p_token: params.token });
    const r = (data ?? {}) as { status?: string } & typeof info;
    status = r.status ?? "unavailable"; info = r;
  }
  return (
    <div className="narrow">
      <Card title={t("دعوة إلى ملف صحي", "Invitation to a health file")}>
        {status === "ok" ? (
          <div className="stack">
            <p>{t(`دُعيت إلى ملف «${info.patient_name}» بصلاحية ${info.access === "editor" ? "محرّر (قراءة وإدخال سجلات)" : "مشاهد (قراءة فقط)"}.`,
                  `You were invited to the file “${lang === "en" && info.patient_name_en ? info.patient_name_en : info.patient_name}” as ${info.access === "editor" ? "an editor (read and add records)" : "a viewer (read only)"}.`)}</p>
            <p className="muted small">{t("لن تستطيع مشاركة الملف مع أطباء أو دعوة آخرين أو حذفه. يمكن لصاحب الملف إزالتك في أي وقت، ويمكنك المغادرة.", "You will not be able to share the file with doctors, invite others or delete it. The owner can remove you at any time, and you can leave.")}</p>
            <ActionForm action={acceptInvite} resetOnSuccess={false}>
              <input type="hidden" name="_t" value={params.token} />
              <SubmitButton pending={t("جارٍ القبول…", "Accepting…")}>{t("قبول الدعوة", "Accept the invitation")}</SubmitButton>
            </ActionForm>
          </div>
        ) : status === "email_mismatch" ? (
          <Banner tone="warn" title={t("هذه الدعوة لحساب آخر", "This invitation is for another account")}>{t("سجّل الدخول بالبريد الإلكتروني الذي وُجّهت إليه الدعوة، ثم افتح الرابط من جديد.", "Sign in with the e-mail address the invitation was written for, then open the link again.")}</Banner>
        ) : (
          <Banner tone="warn" title={t("الدعوة غير متاحة", "This invitation is not available")}>{t("الرابط غير صحيح، أو منتهٍ (7 أيام)، أو أُلغي، أو سبق استخدامه. اطلب من صاحب الملف دعوة جديدة.", "The link is wrong, expired (7 days), cancelled or already used. Ask the owner of the file for a new invitation.")}</Banner>
        )}
        <p className="small" style={{ marginBlockStart: "1rem" }}><Link href="/patients">{t("إلى ملفاتي", "Go to my files")}</Link></p>
      </Card>
    </div>
  );
}
