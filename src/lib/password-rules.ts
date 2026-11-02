/**
 * Password policy of the portal, kept in one place so the forms, the server actions and the hints agree.
 * Supabase Auth enforces its own minimum (the project setting, 6 by default) and a hard maximum of 72 characters
 * (bcrypt ignores everything after 72 bytes and GoTrue refuses longer passwords); the portal asks for more than the default.
 */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 72;

type Tr = (ar: string, en: string) => string;

/** What is wrong with a new password, or null. Length is measured in characters, the maximum in UTF-8 bytes as bcrypt does. */
export function passwordProblem(password: string, t: Tr): string | null {
  if (Array.from(password).length < PASSWORD_MIN) return t(`كلمة المرور يجب ألا تقل عن ${PASSWORD_MIN} أحرف.`, `Password must be at least ${PASSWORD_MIN} characters.`);
  if (new TextEncoder().encode(password).length > PASSWORD_MAX) return t(`كلمة المرور يجب ألا تزيد على ${PASSWORD_MAX} حرفاً.`, `Password must be at most ${PASSWORD_MAX} characters.`);
  if (/^\s|\s$/.test(password)) return t("كلمة المرور لا تبدأ بمسافة ولا تنتهي بها.", "Password must not start or end with a space.");
  if (new Set(Array.from(password)).size < 4) return t("كلمة المرور بسيطة جداً. اخلط أحرفاً وأرقاماً مختلفة.", "That password is too simple. Mix different letters and digits.");
  return null;
}

export const passwordHint = (t: Tr) => t(`من ${PASSWORD_MIN} إلى ${PASSWORD_MAX} حرفاً.`, `${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`);
