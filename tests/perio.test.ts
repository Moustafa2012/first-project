import { describe, expect, it } from "vitest";
import {
  calAt, calOf, comparePerio, depthTone, emptyTooth, furcationsOf, parsePerioTeeth, readSite, sideOrder, siteComplete, siteName, summarize,
  type PerioTooth,
} from "@/lib/perio";

const tooth = (n: number, pd: number[], gm?: (number | null)[], extra: Partial<PerioTooth> = {}): PerioTooth =>
  ({ ...emptyTooth(n), pd, gm: gm ?? null, ...extra });

const tooth16Deep = () => [tooth(16, [3, 3, 7, 3, 3, 3], [0, 0, 0, 0, 0, 0])];

describe("attachment level", () => {
  it("is PD minus the margin: recession is negative and adds, overgrowth is positive and subtracts", () => {
    expect(calAt(4, -2)).toBe(6);
    expect(calAt(5, 2)).toBe(3);
    expect(calAt(3, null)).toBe(3);
    expect(calAt(null, -2)).toBeNull();
    expect(calOf(tooth(16, [3, 2, 5, 4, 3, 6], [0, -1, -2, 0, null, 1]))).toEqual([3, 3, 7, 4, 3, 5]);
  });
  it("colours depths 1–3 / 4–5 / 6+", () => {
    expect([depthTone(3), depthTone(4), depthTone(5), depthTone(6), depthTone(null)]).toEqual(["ok", "warn", "warn", "deep", null]);
  });
});

describe("anatomy", () => {
  it("charts the furcations each tooth has", () => {
    expect(furcationsOf(16)).toEqual(["b", "m", "d"]);
    expect(furcationsOf(36)).toEqual(["b", "l"]);
    expect(furcationsOf(14)).toEqual(["m", "d"]);
    expect(furcationsOf(44)).toEqual([]);
    expect(furcationsOf(11)).toEqual([]);
  });
  it("draws the distal site on the outside of each half of the arch", () => {
    expect(sideOrder(16, "buccal")).toEqual([0, 1, 2]);
    expect(sideOrder(26, "buccal")).toEqual([2, 1, 0]);
    expect(sideOrder(46, "lingual")).toEqual([3, 4, 5]);
    expect(sideOrder(36, "lingual")).toEqual([5, 4, 3]);
  });
  it("names the sites per tooth", () => {
    expect(siteName(0, 16, "en")).toBe("distobuccal");
    expect(siteName(4, 16, "en")).toBe("palatal");
    expect(siteName(5, 36, "en")).toBe("mesiolingual");
    expect(siteName(1, 11, "en")).toBe("labial");
    expect(siteName(2, 26, "ar")).toBe("أنسي-خدّي");
  });
});

describe("summary", () => {
  it("counts over the probed sites only", () => {
    const s = summarize([
      tooth(16, [3, 2, 5, 4, 3, 6], [0, -1, -2, 0, null, 1], { bop: [false, false, true, false, false, true], plaque: [true, false, false, false, false, false], mobility: 1, furcation_b: 2 }),
      tooth(11, [2, 2, 2, 2, 2, 2]),
      { ...emptyTooth(46), missing: true },
    ]);
    expect(s).toMatchObject({ teeth: 2, missing: 1, sites: 12, bop: 2, bopPct: 17, plaque: 1, plaquePct: 8, pd4: 3, pd6: 1, maxCal: 7, mobile: 1, furcations: 1 });
    expect(s.meanPd).toBe(2.9);
    expect(s.meanCal).toBe(3.1);
  });
  it("has no percentages without probing", () => {
    expect(summarize([]).bopPct).toBeNull();
  });
});

describe("comparison", () => {
  it("reports attachment loss of 2 mm or more, pocket reduction, and lost teeth", () => {
    const before = [tooth(16, [3, 3, 4, 3, 3, 3], [0, 0, 0, 0, 0, 0]), tooth(11, [5, 2, 2, 2, 2, 2]), tooth(46, [3, 3, 3, 3, 3, 3])];
    const after = [tooth(16, [3, 3, 5, 3, 3, 3], [0, 0, -1, 0, 0, 0]), tooth(11, [3, 2, 2, 2, 2, 2]), { ...emptyTooth(46), missing: true }];
    const c = comparePerio(before, after);
    expect(c.worse).toEqual([{ tooth: 16, site: 2, pdBefore: 4, pdAfter: 5, calBefore: 4, calAfter: 6, dCal: 2, dPd: 1 }]);
    expect(c.better.map((x) => [x.tooth, x.site, x.dPd])).toEqual([[11, 0, -2]]);
    expect(c.lostTeeth).toEqual([46]);
  });
  it("compares attachment only where the margin was measured in both charts or in neither (an empty margin is not the CEJ)", () => {
    // before: no margin; after: margin measured at -2 → the real attachment before is unknown, so no "worse" is invented
    const noMargin = [tooth(16, [3, 3, 4, 3, 3, 3])];
    const measured = [tooth(16, [3, 3, 4, 3, 3, 3], [0, 0, -2, 0, 0, 0])];
    expect(comparePerio(noMargin, measured).worse).toEqual([]);
    expect(comparePerio(measured, noMargin).worse).toEqual([]);
    // both without margin: the depth change stands for it
    expect(comparePerio(noMargin, [tooth(16, [3, 3, 6, 3, 3, 3])]).worse.map((x) => [x.tooth, x.site, x.dCal])).toEqual([[16, 2, 2]]);
    // both measured: a real loss is reported
    expect(comparePerio(measured, [tooth(16, [3, 3, 4, 3, 3, 3], [0, 0, -4, 0, 0, 0])]).worse.map((x) => x.dCal)).toEqual([2]);
    // a pocket that became shallower is still reported, whatever the margin
    expect(comparePerio(tooth16Deep(), noMargin).better.map((x) => x.site)).toEqual([2]);
  });
  it("ignores 1 mm changes (probing error)", () => {
    expect(comparePerio([tooth(16, [3, 3, 3, 3, 3, 3])], [tooth(16, [4, 3, 3, 3, 3, 2])]).worse).toEqual([]);
  });
});

describe("the chart payload", () => {
  it("keeps valid teeth and drops what the tooth cannot have", () => {
    const r = parsePerioTeeth(JSON.stringify([
      { tooth: 16, pd: [3, 2, 5, 4, 3, 6], gm: [null, null, null, null, null, null], bop: [false, false, false, false, false, false], furcation_b: 2, furcation_l: 1 },
      { tooth: 13, furcation_b: 2, mobility: 1 },
      { tooth: 46, missing: true, pd: [1, 1, 1, 1, 1, 1] },
    ]));
    expect("teeth" in r).toBe(true);
    if (!("teeth" in r)) return;
    const [t16, t13, t46] = r.teeth;
    expect(t16.gm).toBeNull();
    expect(t16.bop).toBeNull();
    expect([t16.furcation_b, t16.furcation_l]).toEqual([2, null]);
    expect([t13.furcation_b, t13.mobility]).toEqual([null, 1]);
    expect([t46.missing, t46.pd]).toEqual([true, null]);
  });
  it("refuses out-of-range values, wrong lengths, primary teeth and duplicates", () => {
    expect(parsePerioTeeth(JSON.stringify([{ tooth: 16, pd: [3, 3, 3, 3, 3, 25] }]))).toEqual({ error: "range" });
    expect(parsePerioTeeth(JSON.stringify([{ tooth: 16, pd: [3, 3, 3] }]))).toEqual({ error: "range" });
    expect(parsePerioTeeth(JSON.stringify([{ tooth: 16, mobility: 4 }]))).toEqual({ error: "range" });
    expect(parsePerioTeeth(JSON.stringify([{ tooth: 55 }]))).toEqual({ error: "invalid" });
    expect(parsePerioTeeth(JSON.stringify([{ tooth: 16 }, { tooth: 16 }]))).toEqual({ error: "invalid" });
    expect(parsePerioTeeth("not json")).toEqual({ error: "invalid" });
  });
});

describe("quick entry", () => {
  it("reads typed sites", () => {
    expect([readSite("3", 0, 20), readSite("-2", -15, 15), readSite("", 0, 20), readSite("-", -15, 15), readSite("25", 0, 20), readSite("a", 0, 20)])
      .toEqual([3, -2, null, null, "bad", "bad"]);
  });
  it("moves on after a digit, waits after 1 for depths, and after a lone sign", () => {
    expect([siteComplete("3"), siteComplete("1"), siteComplete("12"), siteComplete("-"), siteComplete("-1", false), siteComplete("1", false), siteComplete("-1"), siteComplete("-10")])
      .toEqual([true, false, true, false, true, true, false, true]);
  });
});
