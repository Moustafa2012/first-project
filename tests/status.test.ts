import { describe, expect, it } from "vitest";
import { nextStatuses, statusLabel } from "@/lib/status";

describe("status life cycle", () => {
  it("offers the next statuses of a diagnosis, including ruling it out", () => {
    expect(nextStatuses("conditions", "active").map((o) => o.value)).toEqual(["resolved", "inactive", "remission", "refuted"]);
    expect(nextStatuses("conditions", "resolved").map((o) => o.value)).toEqual(["recurrence"]);
  });
  it("does not let the account rule out a clinician's diagnosis, nor move a ruled-out one", () => {
    expect(nextStatuses("conditions", "active", { contributed: true }).map((o) => o.value)).not.toContain("refuted");
    expect(nextStatuses("conditions", "active", { certainty: "refuted" })).toEqual([]);
  });
  it("covers medications and allergies", () => {
    expect(nextStatuses("medications", "active").map((o) => o.value)).toEqual(["on_hold", "stopped", "completed"]);
    expect(nextStatuses("medications", "stopped").map((o) => o.value)).toEqual(["active"]);
    expect(nextStatuses("allergies", "resolved").map((o) => o.value)).toEqual(["active"]);
    expect(nextStatuses("procedures", "x")).toEqual([]);
  });
  it("names statuses and certainty in both languages", () => {
    expect(statusLabel("clinical_status", "resolved", "ar", "conditions")).toBe("شُفي / انتهى");
    expect(statusLabel("certainty", "refuted", "en", "conditions")).toBeTruthy();
    expect(statusLabel("status", "on_hold", "en", "medications")).toBe("On hold");
  });
});
