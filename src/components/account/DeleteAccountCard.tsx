import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { Banner, Card, Chip } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/ui/client";
import { removeFileMember, requestAccountDeletion, transferFileOwnership } from "@/app/actions/account-deletion";

interface Member { user_id: string; name: string; role: string }
interface SharedFile { id: string; mrn: string; name: string; members: Member[] }
interface AloneFile { id: string; mrn: string; name: string; pending: boolean }
interface Overview { alone: AloneFile[]; shared: SharedFile[]; last_admin: boolean }

/** Deleting the account: what it takes with it, what blocks it (shared files), and the confirmation form. */
export async function DeleteAccountCard({ email }: { email: string }) {
  const { t } = i18n();
  const { data } = await createClient().rpc("account_deletion_overview");
  const ov = (data as Overview | null) ?? { alone: [], shared: [], last_admin: false };
  const ROLE: Record<string, string> = { owner: t("مالك", "Owner"), guardian: t("وصيّ", "Guardian"), caregiver: t("مُرافق", "Caregiver"), clinician: t("طبيب", "Clinician") };
  return (
    <Card id="delete-account" title={t("حذف الحساب", "Delete account")}
      description={t("حذف حسابك نهائي بعد 30 يوماً. وخلال هذه المدة يكفي أن تسجّل الدخول مجدداً لإلغائه.", "Deleting your account becomes permanent after 30 days. Until then, signing in again cancels it.")}>
      <ul className="plain-list">
        <li>{t("الملفات الصحية التي تملكها وحدك تصبح للقراءة فقط، ثم تُحذف نهائياً بعد 30 يوماً بالطريقة نفسها لحذف الملف.", "Health files that only you own become read-only and are permanently deleted after 30 days, exactly like deleting a file.")}</li>
        <li>{t("كل روابط المشاركة التي أنشأتها تتوقف فوراً، ولا تعود بإلغاء الحذف.", "Every share link you created stops working at once, and does not come back if you cancel.")}</li>
        <li>{t("يُسجَّل خروجك من كل الأجهزة. تسجيل الدخول من جديد خلال 30 يوماً يلغي الحذف ويعيد ملفاتك.", "You are signed out of every device. Signing in again within 30 days cancels the deletion and restores your files.")}</li>
        <li>{t("لا يُمسّ شيء من بيانات الحسابات الأخرى. ما تبقى من سجلات في ملفات الآخرين يحتفظ بمعرّف مجهول لكاتبه، وسجل التدقيق الخاص بملفاتك المحذوفة يُحذف معها.", "Nothing of other accounts is touched. Records that remain in other people's files keep only an anonymous identifier for their author, and the audit trail of your deleted files goes with them.")}</li>
      </ul>

      {ov.last_admin && (
        <Banner tone="bad" title={t("أنت المدير الوحيد", "You are the only administrator")}>
          {t("عيّن حساباً آخر مديراً قبل أن تحذف حسابك.", "Make another account an administrator before you delete yours.")}
        </Banner>
      )}

      {ov.alone.length > 0 && (
        <div>
          <h3 className="sub-h">{t("ملفات تُحذف مع الحساب", "Files that go with the account")}</h3>
          <ul className="plain-list" aria-label={t("ملفات تُحذف مع الحساب", "Files that go with the account")}>
            {ov.alone.map((f) => (
              <li key={f.id}>{f.name} <span className="muted small ltr">{f.mrn}</span>{f.pending && <> <Chip tone="warn">{t("مجدول للحذف أصلاً", "already scheduled for deletion")}</Chip></>}</li>
            ))}
          </ul>
        </div>
      )}

      {ov.shared.length > 0 && (
        <div className="stack" id="shared-files">
          <Banner tone="warn" title={t("ملفات مشتركة مع آخرين تمنع حذف الحساب", "Files shared with other people block the deletion")}>
            {t("هذه الملفات تملكها أنت مع أشخاص آخرين، ولن تُحذف معك. انقل ملكية كل ملف إلى أحدهم، أو أزل الباقين من الملف، ثم عد إلى هنا.", "You own these files together with other people, and they are not deleted with you. Transfer each file to one of them, or remove the others from the file, then come back here.")}
          </Banner>
          {ov.shared.map((f) => (
            <section key={f.id} className="member-file" aria-label={f.name}>
              <h3 className="sub-h">{f.name} <span className="muted small ltr">{f.mrn}</span></h3>
              <ul className="plain-list">
                {f.members.map((m) => (
                  <li key={m.user_id} className="member-row">
                    <span><strong>{m.name}</strong> <Chip>{ROLE[m.role] ?? m.role}</Chip></span>
                    <span className="row">
                      <ActionForm action={transferFileOwnership}>
                        <input type="hidden" name="_pid" value={f.id} /><input type="hidden" name="to" value={m.user_id} />
                        <ConfirmButton className="btn sm" message={t(`نقل ملكية «${f.name}» إلى ${m.name}؟ تبقى لك صلاحية وصيّ حتى يُحذف حسابك.`, `Transfer “${f.name}” to ${m.name}? You stay a guardian until your account is deleted.`)}>
                          <span aria-hidden="true">{t("نقل الملكية إليه", "Make owner")}</span>
                          <span className="sr-only">{t(`نقل ملكية ${f.name} إلى ${m.name}`, `Make ${m.name} the owner of ${f.name}`)}</span>
                        </ConfirmButton>
                      </ActionForm>
                      <ActionForm action={removeFileMember}>
                        <input type="hidden" name="_pid" value={f.id} /><input type="hidden" name="user" value={m.user_id} />
                        <ConfirmButton message={t(`إزالة ${m.name} من الملف؟ لن يعود يراه.`, `Remove ${m.name} from the file? They will no longer see it.`)}>
                          <span aria-hidden="true">{t("إزالته من الملف", "Remove access")}</span>
                          <span className="sr-only">{t(`إزالة ${m.name} من ${f.name}`, `Remove ${m.name} from ${f.name}`)}</span>
                        </ConfirmButton>
                      </ActionForm>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {!ov.last_admin && ov.shared.length === 0 && (
        <ActionForm action={requestAccountDeletion} className="stack" resetOnSuccess={false}>
          <div className="field">
            <label htmlFor="del-confirm">{t("اكتب بريدك الإلكتروني للتأكيد", "Type your email to confirm")}</label>
            <input id="del-confirm" name="confirm" type="email" dir="ltr" required autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="del-confirm-hint" />
            <span id="del-confirm-hint" className="hint">{t("اكتب", "Type")} <bdi className="ltr">{email}</bdi></span>
          </div>
          <div className="field">
            <label htmlFor="del-password">{t("كلمة المرور", "Password")}</label>
            <input id="del-password" name="password" type="password" dir="ltr" required autoComplete="current-password" />
          </div>
          <label className="check"><input type="checkbox" name="ack" required /> {t("أفهم أن ملفاتي تُحذف نهائياً بعد 30 يوماً ما لم أسجّل الدخول قبل ذلك.", "I understand my files are permanently deleted after 30 days unless I sign in before then.")}</label>
          <div><SubmitButton className="btn danger" pending={t("جارٍ الجدولة…", "Scheduling…")}>{t("احذف حسابي", "Delete my account")}</SubmitButton></div>
        </ActionForm>
      )}
    </Card>
  );
}
