import { notFound } from "next/navigation";
import { UserPlus } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getPatient } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { canRevoke, daysLeft, inviteStatus, memberKind, type InviteRow, type MemberRow } from "@/lib/care/members";
import { Banner, Card, Chip, Empty, PageHead } from "@/components/ui";
import { ActionForm, ConfirmButton } from "@/components/ui/client";
import { InviteForm } from "@/components/care/OneTimeLink";
import { inviteMember, revokeInvite, revokeMember } from "@/app/actions/care";

export const metadata = { title: "الأعضاء والدعوات" };

export default async function MembersPage({ params }: { params: { pid: string } }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const p = await getPatient(params.pid);
  const access = await getAccess(p.id);
  if (!access.canManage) notFound();
  const supabase = createClient();
  const [{ data: list }, { data: inv }] = await Promise.all([
    supabase.rpc("member_list", { p_patient: p.id }),
    supabase.from("patient_invites").select("id, invited_email, access, created_at, expires_at, accepted_at, revoked_at").eq("patient_id", p.id).order("created_at", { ascending: false }).limit(50),
  ]);
  const members = (Array.isArray(list) ? list : []) as MemberRow[];
  const invites = (inv ?? []) as InviteRow[];
  const kindLabel = { owner: t("المالك", "Owner"), guardian: t("ولي أمر", "Guardian"), editor: t("محرّر", "Editor"), viewer: t("مشاهد", "Viewer"), clinician: t("طبيب", "Clinician") };
  const stLabel = { pending: [t("بانتظار القبول", "Waiting"), "info"], accepted: [t("قُبلت", "Accepted"), "ok"], revoked: [t("أُلغيت", "Cancelled"), "muted"], expired: [t("منتهية", "Expired"), "muted"] } as const;
  return (
    <>
      <PageHead title={t("الأعضاء والدعوات", "Members & invitations")}
        sub={t("ادعُ حساباً آخر (ولي أمر ثانٍ، مرافق، قريب) لقراءة الملف أو تحريره. لا يُرسَل بريد: تحصل على رابط تنسخه وتسلّمه بنفسك.", "Invite another account (a second parent, a carer, a relative) to read or edit the file. No e-mail is sent: you get a link to copy and hand over yourself.")} />
      <Card title={<><UserPlus size={18} aria-hidden="true" /> {t("دعوة جديدة", "New invitation")}</>}>
        <InviteForm action={inviteMember} pid={p.id} labels={{
          title: t("رابط الدعوة جاهز", "The invitation link is ready"), warn: t("يظهر مرة واحدة فقط ولا نحفظه، ويصلح 7 أيام وللحساب بهذا البريد وحده. انسخه وأرسله بقناة تثق بها.", "It is shown once only and not kept; it works for 7 days and only for the account with this address. Copy it and send it through a channel you trust."),
          link: t("الرابط", "Link"), copy: t("نسخ", "Copy"), copied: t("تم النسخ", "Copied"), email: t("البريد الإلكتروني للمدعو", "Invitee's e-mail"), access: t("المستوى", "Level"),
          viewer: t("مشاهد: يقرأ الملف فقط", "Viewer: reads the file only"), editor: t("محرّر: يقرأ ويُدخل السجلات", "Editor: reads and adds records"), send: t("إنشاء رابط الدعوة", "Create the invitation link"), another: t("دعوة أخرى", "Another invitation"),
          hint: t("لا أحد منهما يستطيع المشاركة مع طبيب أو دعوة آخرين أو حذف الملف. يمكنك إزالته في أي لحظة.", "Neither can share with a doctor, invite others or delete the file. You can remove them at any moment."),
        }} />
      </Card>
      <Card title={t(`الأعضاء (${members.filter((m) => !m.revoked_at).length})`, `Members (${members.filter((m) => !m.revoked_at).length})`)}>
        {members.length === 0 ? <Empty>{t("لا أعضاء.", "No members.")}</Empty> : members.map((m) => (
          <article className="rec" key={m.user_id} data-testid="member-row">
            <div className="row between">
              <span className="row"><strong>{m.full_name}</strong><span className="muted small ltr">{m.email}</span>
                <Chip tone={m.revoked_at ? "muted" : "info"}>{kindLabel[memberKind(m)]}</Chip>{m.revoked_at && <Chip tone="muted">{t("أُزيل", "Removed")}</Chip>}</span>
              <span className="muted small">{m.revoked_at ? fmtDateTime(m.revoked_at, lang, tz) : fmtDate(m.joined_at, lang, tz)}</span>
            </div>
            {canRevoke(m) && (
              <ActionForm action={revokeMember} resetOnSuccess={false}><input type="hidden" name="_pid" value={p.id} /><input type="hidden" name="_user" value={m.user_id} />
                <ConfirmButton message={t("إزالة هذا العضو؟ ينتهي وصوله فوراً.", "Remove this member? Their access ends immediately.")}>{t("إزالة", "Remove")}</ConfirmButton></ActionForm>
            )}
          </article>
        ))}
      </Card>
      <Card title={t("الدعوات", "Invitations")}>
        {invites.length === 0 ? <Empty>{t("لا دعوات بعد.", "No invitations yet.")}</Empty> : invites.map((i) => {
          const st = inviteStatus(i);
          const [label, tone] = stLabel[st];
          return (
            <article className="rec" key={i.id} data-testid="invite-row">
              <div className="row between">
                <span className="row"><span className="ltr">{i.invited_email}</span><Chip tone={i.access === "editor" ? "warn" : "info"}>{i.access === "editor" ? kindLabel.editor : kindLabel.viewer}</Chip><Chip tone={tone}>{label}</Chip></span>
                <span className="muted small">{st === "pending" ? t(`تنتهي بعد ${daysLeft(i.expires_at)} يوم`, `expires in ${daysLeft(i.expires_at)} day(s)`) : fmtDate(i.created_at, lang, tz)}</span>
              </div>
              {st === "pending" && (
                <ActionForm action={revokeInvite} resetOnSuccess={false}><input type="hidden" name="_pid" value={p.id} /><input type="hidden" name="_id" value={i.id} />
                  <ConfirmButton message={t("إلغاء هذه الدعوة؟", "Cancel this invitation?")}>{t("إلغاء الدعوة", "Cancel invitation")}</ConfirmButton></ActionForm>
              )}
            </article>
          );
        })}
      </Card>
      <Banner tone="info">{t("للدعوة رابط واحد لا يُحفظ منه إلا بصمته. إن ضاع الرابط فأنشئ دعوة جديدة لنفس البريد فتحلّ محل القديمة.", "An invitation has one link of which only a fingerprint is kept. If the link is lost, create a new invitation for the same address; it replaces the old one.")}</Banner>
    </>
  );
}
