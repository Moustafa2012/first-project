import { Camera, Trash2 } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { Avatar } from "@/components/Avatar";

/** Picture upload. Posts to /api/avatar (validates the bytes, stores in a private bucket, serves through the server). */
export function PhotoForm({ target, pid, name, src, returnTo, status, canEdit = true }: {
  target: "user" | "patient"; pid?: string; name: string; src: string | null; returnTo: string; status?: { photo?: string; error?: string }; canEdit?: boolean;
}) {
  const { t } = i18n();
  const msg: Record<string, string> = {
    too_large: t("الصورة أكبر من 2 ميغابايت.", "The picture is larger than 2 MB."),
    bad_type: t("الصيغة غير مدعومة. استخدم JPG أو PNG أو WebP.", "Unsupported format. Use JPG, PNG or WebP."),
    no_file: t("اختر صورة أولاً.", "Choose a picture first."),
    storage_unconfigured: t("تخزين الصور غير مُفعَّل على الخادم.", "Picture storage is not enabled on the server."),
  };
  const id = `photo-${target}`;
  return (
    <div className="photo-form">
      <Avatar name={name} src={src} size="lg" />
      <div className="stack" style={{ flex: 1, minWidth: 0 }}>
        {status?.photo === "saved" && <p className="form-msg ok" role="status">{t("تم تحديث الصورة.", "Picture updated.")}</p>}
        {status?.photo === "removed" && <p className="form-msg ok" role="status">{t("أُزيلت الصورة.", "Picture removed.")}</p>}
        {status?.error && <p className="form-msg err" role="alert">{msg[status.error] ?? t("تعذر رفع الصورة. حاول مرة أخرى.", "The picture could not be saved. Please try again.")}</p>}
        {canEdit ? (
          <>
            <form method="post" action="/api/avatar" encType="multipart/form-data" className="row">
              <input type="hidden" name="target" value={target} />{pid && <input type="hidden" name="pid" value={pid} />}<input type="hidden" name="returnTo" value={returnTo} />
              <label htmlFor={id} className="sr-only">{t("اختر صورة", "Choose a picture")}</label>
              <input id={id} name="file" type="file" accept="image/jpeg,image/png,image/webp" required style={{ flex: 1, minWidth: 200 }} />
              <button className="btn primary"><Camera size={16} aria-hidden="true" />{t("رفع الصورة", "Upload")}</button>
            </form>
            {src && (
              <form method="post" action="/api/avatar" encType="multipart/form-data">
                <input type="hidden" name="target" value={target} />{pid && <input type="hidden" name="pid" value={pid} />}<input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="remove" value="1" />
                <button className="btn danger sm"><Trash2 size={14} aria-hidden="true" />{t("إزالة الصورة", "Remove picture")}</button>
              </form>
            )}
            <p className="hint small muted" style={{ margin: 0 }}>{t("JPG أو PNG أو WebP، حتى 2 ميغابايت. تُحفظ في تخزين خاص ولا تُشارك مع الأطباء.", "JPG, PNG or WebP, up to 2 MB. Stored privately and never shared with doctors.")}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
