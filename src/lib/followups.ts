/*
 * What is waiting to happen in a file: recalls that are due, treatments accepted or scheduled but not done, visits
 * that asked for a follow-up nobody came back for, appointments. Pure functions (tested in tests/followups.test.ts).
 */

export interface Recall { id: string; kind: string; label: string | null; interval_months: number; due_on: string; last_done_on: string | null; status: string; notes?: string | null }
export type DueState = "overdue" | "due_soon" | "upcoming" | "undated";
export interface FollowUp { key: string; source: "recall" | "treatment" | "visit" | "appointment"; title: string; date: string | null; state: DueState; detail?: string; href?: string }

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);

/** Overdue before today; due soon within `soon` days; otherwise upcoming. */
export function dueState(date: string | null, today: string, soon = 30): DueState {
  if (!date) return "undated";
  const d = days(date.slice(0, 10), today);
  return d < 0 ? "overdue" : d <= soon ? "due_soon" : "upcoming";
}

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

interface ItemIn { id: string; name: string; status: string; scheduled_for: string | null; teeth?: number[] | null; plan?: string }
interface VisitIn { id: string; started_at: string; follow_up_date: string | null; reason: string | null; specialty_id: string | null }
interface ApptIn { id: string; scheduled_at: string; status: string; reason: string | null }

export function pendingFollowUps(o: {
  today: string; recalls?: Recall[]; items?: ItemIn[]; visits?: VisitIn[]; appointments?: ApptIn[];
  label: { recall: (r: Recall) => string; acceptedNotScheduled: string; inProgress: string; visitFollowUp: string; appointment: string; appointmentPast: string };
  base?: string;
}): FollowUp[] {
  const out: FollowUp[] = [];
  for (const r of o.recalls ?? []) {
    if (r.status !== "active") continue;
    const state = dueState(r.due_on, o.today);
    if (state === "overdue" || state === "due_soon") out.push({ key: `r${r.id}`, source: "recall", title: o.label.recall(r), date: r.due_on, state, href: o.base && `${o.base}/dental?tab=followup` });
  }
  for (const i of o.items ?? []) {
    const what = `${i.teeth?.length ? `${i.teeth.join("، ")} — ` : ""}${i.name}`;
    if (i.status === "scheduled") out.push({ key: `t${i.id}`, source: "treatment", title: what, date: i.scheduled_for, state: dueState(i.scheduled_for, o.today), detail: i.plan, href: o.base && `${o.base}/dental?tab=treatment` });
    else if (i.status === "accepted") out.push({ key: `t${i.id}`, source: "treatment", title: what, date: null, state: "undated", detail: o.label.acceptedNotScheduled, href: o.base && `${o.base}/dental?tab=treatment` });
    else if (i.status === "in_progress") out.push({ key: `t${i.id}`, source: "treatment", title: what, date: null, state: "undated", detail: o.label.inProgress, href: o.base && `${o.base}/dental?tab=treatment` });
  }
  // a visit asked for a follow-up: pending until a later visit of the same specialty (from a week before that date)
  const visits = o.visits ?? [];
  for (const v of visits) {
    if (!v.follow_up_date || days(o.today, v.follow_up_date) > 90) continue;
    const came = visits.some((w) => w.id !== v.id && w.started_at > v.started_at && (w.specialty_id ?? "") === (v.specialty_id ?? "")
      && days(w.started_at.slice(0, 10), v.follow_up_date!) >= -7);
    if (!came) out.push({ key: `v${v.id}`, source: "visit", title: v.reason ?? o.label.visitFollowUp, date: v.follow_up_date, state: dueState(v.follow_up_date, o.today), detail: o.label.visitFollowUp, href: o.base && `${o.base}/visits/${v.id}` });
  }
  for (const a of o.appointments ?? []) {
    if (a.status !== "scheduled") continue;
    const state = dueState(a.scheduled_at, o.today);
    out.push({ key: `a${a.id}`, source: "appointment", title: a.reason ?? o.label.appointment, date: a.scheduled_at, state, detail: state === "overdue" ? o.label.appointmentPast : o.label.appointment, href: o.base && `${o.base}/appointments` });
  }
  const rank: Record<DueState, number> = { overdue: 0, due_soon: 1, undated: 2, upcoming: 3 };
  return out.sort((a, b) => rank[a.state] - rank[b.state] || String(a.date ?? "9999").localeCompare(String(b.date ?? "9999")));
}
