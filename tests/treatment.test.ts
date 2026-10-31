import { describe, expect, it } from "vitest";
import { ITEM_NEXT, costTotals, itemNext, planProgress, plannedByTooth, byPhase, treatmentError } from "@/lib/treatment";

describe("treatment life cycle", () => {
  it("nothing is completed before it was accepted", () => {
    expect(ITEM_NEXT.proposed).not.toContain("completed");
    expect(ITEM_NEXT.planned).not.toContain("completed");
    expect(ITEM_NEXT.accepted).toContain("completed");
    expect(itemNext("completed")).toEqual([]);
  });
  it("a clinician through a share is never offered 'accepted'", () => {
    expect(itemNext("proposed", true)).not.toContain("accepted");
    expect(itemNext("proposed", false)).toContain("accepted");
  });
});

describe("plan progress", () => {
  it("counts completed and referred as done, ignores cancelled", () => {
    expect(planProgress([{ status: "completed" }, { status: "referred" }, { status: "accepted" }, { status: "cancelled" }])).toEqual({ done: 2, total: 3, pct: 67 });
    expect(planProgress([])).toEqual({ done: 0, total: 0, pct: 0 });
  });
});

describe("planned treatment per tooth", () => {
  it("only open treatments of current plans", () => {
    const m = plannedByTooth([
      { status: "accepted", title: "A", items: [{ name: "Crown", status: "accepted", teeth: [36] }, { name: "Filling", status: "completed", teeth: [16] }] },
      { status: "superseded", title: "Old", items: [{ name: "Old crown", status: "cancelled", teeth: [36] }] },
    ] as never);
    expect(m.get(36)?.map((x) => x.name)).toEqual(["Crown"]);
    expect(m.has(16)).toBe(false);
  });
});

describe("costs", () => {
  it("the latest kind wins (final over quote over estimate); totals per currency, never mixed", () => {
    const items = [{ id: "a", status: "completed" }, { id: "b", status: "accepted" }, { id: "c", status: "cancelled" }];
    const costs = [
      { id: "1", item_id: "a", amount: 100, currency: "SAR", kind: "estimate", note: null },
      { id: "2", item_id: "a", amount: 120, currency: "SAR", kind: "final", note: null },
      { id: "3", item_id: "b", amount: "50.5", currency: "USD", kind: "quoted", note: null },
      { id: "4", item_id: "c", amount: 999, currency: "SAR", kind: "estimate", note: null },
    ];
    const { byItem, totals } = costTotals(items, costs);
    expect(byItem.get("a")?.amount).toBe(120);
    expect(totals).toEqual([{ currency: "SAR", amount: 120, done: 120 }, { currency: "USD", amount: 50.5, done: 0 }]);
  });
});

describe("phases and errors", () => {
  it("groups by phase in order", () => {
    expect(byPhase([{ phase: 2 }, { phase: 1 }, { phase: 2 }]).map(([p, l]) => [p, l.length])).toEqual([[1, 1], [2, 2]]);
  });
  it("explains the database refusals", () => {
    const t = (_a: string, e: string) => e;
    expect(treatmentError("surgical_confirmation_required", t)).toMatch(/explicit confirmation/);
    expect(treatmentError("something else", t)).toBeNull();
  });
});
