import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getTz } from "@/lib/auth";
import { localDate } from "@/lib/format";
import { toItems, type FeedRow, type ReminderItem } from "@/lib/care/reminders";
import type { AbnormalLab, AttentionRow } from "@/lib/care/attention";

/** Today in the viewer's time zone (YYYY-MM-DD). */
export const today = () => localDate(new Date(), getTz());

/** The number on the bell: asked of the database in one round trip, 0 when it cannot answer (the bell then shows nothing). */
export const getReminderCount = cache(async (): Promise<number> => {
  try {
    const { data, error } = await createClient().rpc("care_reminder_count", { p_today: today(), p_tz: getTz() });
    return error || typeof data !== "number" ? 0 : data;
  } catch { return 0; }
});

/** The reminders of one file, or of every file the account can read. */
export async function getReminders(patientId?: string): Promise<ReminderItem[]> {
  const day = today();
  const { data } = await createClient().rpc("care_reminder_feed", { ...(patientId ? { p_patient: patientId } : {}), p_horizon: 30, p_today: day, p_tz: getTz() });
  return toItems(Array.isArray(data) ? (data as FeedRow[]).map((r) => ({ ...r, due_on: String(r.due_on).slice(0, 10) })) : [], day);
}

/** One count per indicator per file, for every file the account can read. */
export async function getAttention(): Promise<AttentionRow[]> {
  const { data } = await createClient().rpc("care_attention", { p_today: today(), p_tz: getTz() });
  return Array.isArray(data) ? (data as AttentionRow[]).map((r) => ({ ...r, n: Number(r.n) })) : [];
}

export async function getAbnormalLabs(patientId: string): Promise<AbnormalLab[]> {
  const { data } = await createClient().rpc("care_abnormal_labs", { p_patient: patientId, p_today: today() });
  return Array.isArray(data) ? (data as AbnormalLab[]).map((r) => ({ ...r, value_num: r.value_num == null ? null : Number(r.value_num), ref_low: r.ref_low == null ? null : Number(r.ref_low),
    ref_high: r.ref_high == null ? null : Number(r.ref_high), prev_value: r.prev_value == null ? null : Number(r.prev_value) })) : [];
}
