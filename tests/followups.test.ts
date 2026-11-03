import { describe, expect, it } from "vitest";
import { addMonths, dueState, pendingFollowUps, type Recall } from "@/lib/followups";

const label = { recall: (r: Recall) => r.kind, acceptedNotScheduled: "accepted", inProgress: "in progress", visitFollowUp: "follow-up", appointment: "appt", appointmentPast: "missed?" };

describe("due dates", () => {
  it("overdue, due soon, upcoming", () => {
    expect(dueState("2026-10-30", "2026-10-31")).toBe("overdue");
    expect(dueState("2026-11-20", "2026-10-31")).toBe("due_soon");
    expect(dueState("2027-02-01", "2026-10-31")).toBe("upcoming");
    expect(dueState(null, "2026-10-31")).toBe("undated");
  });
  it("adds months without spilling into the next month", () => {
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonths("2026-01-15", 12)).toBe("2027-01-15");
  });
});

describe("pending follow-ups", () => {
  it("collects due recalls, open treatments, unanswered follow-ups and appointments, most urgent first", () => {
    const list = pendingFollowUps({
      today: "2026-10-31", label,
      recalls: [
        { id: "1", kind: "dental_checkup", label: null, interval_months: 6, due_on: "2026-10-01", last_done_on: null, status: "active" },
        { id: "2", kind: "dental_cleaning", label: null, interval_months: 6, due_on: "2027-04-01", last_done_on: null, status: "active" },
        { id: "3", kind: "dental_xray", label: null, interval_months: 12, due_on: "2026-01-01", last_done_on: null, status: "paused" },
      ],
      items: [
        { id: "a", name: "Crown", status: "scheduled", scheduled_for: "2026-11-05", teeth: [36] },
        { id: "b", name: "Filling", status: "accepted", scheduled_for: null },
        { id: "c", name: "Done", status: "completed", scheduled_for: null },
      ],
      visits: [
        { id: "v1", started_at: "2026-09-01T10:00:00Z", follow_up_date: "2026-10-15", reason: "Pain", specialty_id: "d" },
        { id: "v2", started_at: "2026-08-01T10:00:00Z", follow_up_date: "2026-08-20", reason: "Old", specialty_id: "d" },
      ],
      appointments: [{ id: "x", scheduled_at: "2026-11-02T09:00:00Z", status: "scheduled", reason: "Review" }],
    });
    expect(list.map((x) => x.key)).toEqual(["r1", "vv1", "ax", "ta", "tb"]);
    expect(list[0].state).toBe("overdue");
  });
});
