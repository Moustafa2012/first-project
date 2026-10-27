export type ShareStatus = "active" | "locked" | "expired" | "revoked";

export interface ShareListRow {
  id: string; patient_id: string; title: string; recipient_label: string | null; scope_kind: string; token_hint: string | null;
  created_by: string; created_at: string; expires_at: string; revoked_at: string | null; revoke_reason: string | null;
  locked_until: string | null; lock_count: number; failed_attempts: number; max_attempts: number; access_count: number;
  last_accessed_at: string | null; allow_download: boolean; allow_print: boolean; allow_notes: boolean; include_sensitive: boolean;
}

export const SHARE_COLUMNS =
  "id, patient_id, title, recipient_label, scope_kind, token_hint, created_by, created_at, expires_at, revoked_at, revoke_reason, locked_until, lock_count, failed_attempts, max_attempts, access_count, last_accessed_at, allow_download, allow_print, allow_notes, include_sensitive";

export function shareStatus(s: Pick<ShareListRow, "revoked_at" | "expires_at" | "locked_until">, now = Date.now()): ShareStatus {
  if (s.revoked_at) return "revoked";
  if (Date.parse(s.expires_at) <= now) return "expired";
  if (s.locked_until && Date.parse(s.locked_until) > now) return "locked";
  return "active";
}

export const STATUS_LABEL: Record<ShareStatus, { ar: string; en: string; tone: "ok" | "warn" | "muted" | "bad" }> = {
  active: { ar: "نشطة", en: "Active", tone: "ok" }, locked: { ar: "مقفلة مؤقتاً", en: "Locked", tone: "warn" },
  expired: { ar: "منتهية", en: "Expired", tone: "muted" }, revoked: { ar: "ملغاة", en: "Revoked", tone: "bad" },
};

export const SCOPE_LABEL: Record<string, { ar: string; en: string }> = {
  full: { ar: "الملف الكامل", en: "Full file" }, specialty: { ar: "تخصص", en: "Specialty" }, custom: { ar: "سجلات مختارة", en: "Selected records" },
};
