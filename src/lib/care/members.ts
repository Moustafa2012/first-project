/**
 * Members invited by link. An owner or guardian invites an account by e-mail as a viewer (reads) or an editor (reads and writes);
 * neither can share the file, manage members or delete it. Nothing is mailed: the invite is a link, valid for 7 days, that only
 * the account with the invited address can use; only its hash is stored. The database enforces all of it (migration 0031).
 */

export type InviteAccess = "viewer" | "editor";
export const INVITE_ACCESS: InviteAccess[] = ["viewer", "editor"];
export const INVITE_DAYS = 7;

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const normalizeEmail = (v: string) => v.trim().toLowerCase();
export const validEmail = (v: string) => v.length <= 254 && EMAIL_RE.test(v);
/** Tokens are made by the database: 24 random bytes in url-safe base64 (32 characters). */
export const validInviteToken = (t: string) => /^[A-Za-z0-9_-]{20,128}$/.test(t);
export const invitePath = (token: string) => `/invite/${token}`;
export const inviteLink = (origin: string, token: string) => `${origin.replace(/\/+$/, "")}${invitePath(token)}`;

export interface InviteRow { id: string; invited_email: string; access: InviteAccess; created_at: string; expires_at: string; accepted_at: string | null; revoked_at: string | null }
export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export function inviteStatus(i: Pick<InviteRow, "accepted_at" | "revoked_at" | "expires_at">, now = Date.now()): InviteStatus {
  if (i.accepted_at) return "accepted";
  if (i.revoked_at) return "revoked";
  return Date.parse(i.expires_at) <= now ? "expired" : "pending";
}

/** Whole days (rounded up) left before the invite expires; 0 when it already has. */
export function daysLeft(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 86_400_000));
}

export interface MemberRow { user_id: string; full_name: string; email: string; role: string; can_write: boolean; can_share: boolean; joined_at: string; revoked_at: string | null }
export type MemberKind = "owner" | "guardian" | "editor" | "viewer" | "clinician";

/** What a member is called: owners and guardians by role, a caregiver by the access they were invited with. */
export function memberKind(m: Pick<MemberRow, "role" | "can_write">): MemberKind {
  if (m.role === "owner" || m.role === "guardian" || m.role === "clinician") return m.role;
  return m.can_write ? "editor" : "viewer";
}

/** Only a caregiver or clinician can be revoked; owners and guardians never. */
export const canRevoke = (m: Pick<MemberRow, "role" | "revoked_at">) => !m.revoked_at && (m.role === "caregiver" || m.role === "clinician");
