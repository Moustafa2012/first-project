import { describe, expect, it } from "vitest";
import { archLayout, panoramicPairs, rootsOf, smile, toothShape } from "@/lib/dental-anatomy";
import { ARCHES } from "@/lib/dental";

describe("schematic anatomy", () => {
  it("gives each tooth its usual number of roots", () => {
    const n = (t: number) => rootsOf(t, 40, 40).length;
    expect([11, 12, 13, 15, 21, 31, 33, 35, 41, 44, 45].map(n)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(n(14)).toBe(2);   // upper first premolar
    expect(n(24)).toBe(2);
    expect([16, 17, 18, 26, 27, 28].map(n)).toEqual([3, 3, 3, 3, 3, 3]);
    expect([36, 37, 38, 46, 47, 48].map(n)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(n(55)).toBe(3);   // upper primary molar
    expect(n(75)).toBe(2);   // lower primary molar
  });
  it("draws canines with the longest roots and molars widest", () => {
    expect(toothShape(13).roots[0].length).toBeGreaterThan(toothShape(11).roots[0].length);
    expect(toothShape(36).w).toBeGreaterThan(toothShape(35).w);
    expect(toothShape(51).w).toBeLessThan(toothShape(11).w);
  });
  it("lays an arch out left to right with a midline gap", () => {
    const l = archLayout(ARCHES.permanentUpper);
    expect(l.map((x) => x.tooth).slice(6, 10)).toEqual([12, 11, 21, 22]);
    for (let i = 1; i < l.length; i++) expect(l[i].cx).toBeGreaterThan(l[i - 1].cx);
    const gap = l[8].cx - l[8].w / 2 - (l[7].cx + l[7].w / 2);
    expect(gap).toBeCloseTo(10, 5);
  });
  it("pairs the arches per dentition and curves the occlusal plane like a smile", () => {
    expect(panoramicPairs("permanent")).toHaveLength(1);
    expect(panoramicPairs("mixed")).toHaveLength(2);
    expect(panoramicPairs("primary")[0][0]).toEqual(ARCHES.primaryUpper);
    expect(smile(500, 1000)).toBeCloseTo(0, 6);
    expect(smile(0, 1000)).toBeLessThan(-10);
  });
});
