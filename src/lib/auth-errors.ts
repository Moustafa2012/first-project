/** Maps what Supabase Auth answers to a message the user can act on. Never echoes the raw server text. */
type Tr = (ar: string, en: string) => string;
export interface AuthLikeError { status?: number; code?: string; name?: string; message?: string; weak_password?: { reasons?: string[] } }

const RATE_CODES = new Set(["over_request_rate_limit", "over_email_send_rate_limit", "over_sms_send_rate_limit"]);

export type AuthContext = "login" | "signup" | "password" | "reset";

export function authErrorMessage(e: AuthLikeError | null | undefined, t: Tr, ctx: AuthContext): string {
  const code = e?.code ?? "";
  const status = e?.status ?? 0;
  if (RATE_CODES.has(code) || status === 429) {
    if (code === "over_email_send_rate_limit") {
      return t("تجاوز الخادم حد رسائل التأكيد المسموح بها. حاول بعد ساعة، أو اطلب من المسؤول ضبط خدمة بريد (SMTP) للمشروع.", "The confirmation-email limit was reached. Try again in an hour, or ask the administrator to configure SMTP for the project.");
    }
    return t("محاولات كثيرة في وقت قصير. انتظر بضع دقائق ثم حاول مجدداً.", "Too many attempts in a short time. Wait a few minutes and try again.");
  }
  if (e?.name === "AuthRetryableFetchError" || status >= 500) {
    return t("الخدمة غير متاحة مؤقتاً. حاول بعد قليل.", "The service is temporarily unavailable. Please try again shortly.");
  }
  switch (code) {
    case "invalid_credentials": return t("البريد أو كلمة المرور غير صحيحة.", "Incorrect email or password.");
    case "email_not_confirmed": return t("لم يُؤكَّد بريدك بعد. افتح رسالة التأكيد التي أرسلناها ثم سجّل الدخول.", "Your email is not confirmed yet. Open the confirmation message we sent, then sign in.");
    case "user_banned": return t("هذا الحساب موقوف. تواصل مع المسؤول.", "This account is suspended. Contact the administrator.");
    case "user_already_exists": case "email_exists": return t("هذا البريد مسجل مسبقاً. سجّل الدخول.", "This email is already registered. Sign in instead.");
    case "weak_password": {
      const r = e?.weak_password?.reasons ?? [];
      if (r.includes("pwned")) return t("كلمة المرور هذه ظهرت في تسريبات معروفة. اختر غيرها.", "That password appears in known data leaks. Choose another one.");
      if (r.includes("characters")) return t("كلمة المرور تحتاج حروفاً صغيرة وكبيرة وأرقاماً.", "The password needs lowercase and uppercase letters and digits.");
      return t("كلمة المرور ضعيفة. اختر كلمة أطول وأقوى.", "The password is too weak. Choose a longer, stronger one.");
    }
    case "same_password": return t("كلمة المرور الجديدة يجب أن تختلف عن الحالية.", "The new password must be different from the current one.");
    case "email_address_invalid": case "validation_failed": return t("عنوان البريد غير مقبول.", "The email address was not accepted.");
    case "signup_disabled": return t("التسجيل غير متاح حالياً.", "Sign-up is currently disabled.");
    case "session_not_found": case "session_expired": case "refresh_token_not_found": return t("انتهت جلستك. سجّل الدخول مجدداً.", "Your session ended. Sign in again.");
    default:
      if (ctx === "login") return t("البريد أو كلمة المرور غير صحيحة.", "Incorrect email or password.");
      if (ctx === "signup") return t("تعذر إنشاء الحساب. حاول لاحقاً.", "Could not create the account. Please try again later.");
      if (ctx === "password") return t("تعذر تحديث كلمة المرور.", "Could not update the password.");
      return t("تعذر تنفيذ العملية. حاول لاحقاً.", "The action could not be completed. Please try again later.");
  }
}
