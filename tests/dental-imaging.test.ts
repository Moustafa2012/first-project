import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ANNOTATION_COLORS, BONE_LEVELS, BONE_PATTERNS, INITIAL_VIEW, MAX_ZOOM, MIN_ZOOM, SEXTANTS, SHAPE_KEYS, boneLevelsFromForm, clampZoom, isWholeMouth,
  parseBoneLevels, parseShapes, rotateBy, sextantOf, summarizeBoneLevels, toNormalized, worstBoneLevel, zoomAt,
} from "@/lib/dental-imaging";
import { IMAGING_MODALITY } from "@/lib/labels";
import { parseExamForm } from "@/lib/dental";

const t = (a: string, e: string) => e;
const sql = readFileSync(join(__dirname, "../supabase/migrations/0025_dental_imaging.sql"), "utf8");

describe("the specification matches the database (migration 0025)", () => {
  it("accepts the same modalities", () => {
    const m = /imaging_studies_modality_check check \(modality in\s*\(([^)]*)\)/.exec(sql)![1];
    const inDb = [...m.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(IMAGING_MODALITY.map((o) => o.value).sort()).toEqual(inDb);
    for (const v of ["periapical", "bitewing", "occlusal", "intraoral_photo", "extraoral_photo", "cbct", "cephalometric", "panoramic", "dental_xray"]) expect(inDb).toContain(v);
  });
  it("has the same whole-mouth modalities", () => {
    const m = /p_modality in \(([^)]*)\)/.exec(sql)![1];
    expect([...m.matchAll(/'([a-z]+)'/g)].map((x) => x[1])).toEqual(["panoramic", "cbct", "cephalometric"]);
  });
  it("has the same sextants, levels and patterns", () => {
    const fn = sql.slice(sql.indexOf("function app.bone_levels_ok"), sql.indexOf("grant execute on function app.bone_levels_ok"));
    expect([...fn.matchAll(/'(s\d)'/g)].map((x) => x[1]).slice(0, 6)).toEqual(SEXTANTS.map((s) => s.key));
    for (const [k] of BONE_LEVELS) expect(fn).toContain(`'${k}'`);
    for (const [k] of BONE_PATTERNS) expect(fn).toContain(`'${k}'`);
  });
  it("has the same shape types, keys and colours", () => {
    const fn = sql.slice(sql.indexOf("function app.annotation_shapes_ok"), sql.indexOf("grant execute on function app.annotation_shapes_ok"));
    for (const [type, keys] of Object.entries(SHAPE_KEYS)) {
      expect(fn).toContain(`when '${type}' then array[${keys.map((k) => `'${k}'`).join(", ")}]`);
    }
    for (const c of ANNOTATION_COLORS) expect(fn).toContain(`'${c}'`);
  });
});

describe("whole-mouth images", () => {
  it("are panoramic, CBCT and cephalometric images naming no tooth", () => {
    expect(isWholeMouth("panoramic", null)).toBe(true);
    expect(isWholeMouth("cbct", [])).toBe(true);
    expect(isWholeMouth("cephalometric", undefined)).toBe(true);
    expect(isWholeMouth("panoramic", [16])).toBe(false);
    expect(isWholeMouth("periapical", null)).toBe(false);
    expect(isWholeMouth("dental_xray", null)).toBe(false);
    expect(isWholeMouth(null, null)).toBe(false);
  });
});

describe("the bone-level reading", () => {
  it("places permanent teeth in their sextants", () => {
    expect(sextantOf(18)).toBe("s1"); expect(sextantOf(14)).toBe("s1");
    expect(sextantOf(13)).toBe("s2"); expect(sextantOf(21)).toBe("s2"); expect(sextantOf(23)).toBe("s2");
    expect(sextantOf(24)).toBe("s3"); expect(sextantOf(28)).toBe("s3");
    expect(sextantOf(38)).toBe("s4"); expect(sextantOf(34)).toBe("s4");
    expect(sextantOf(33)).toBe("s5"); expect(sextantOf(41)).toBe("s5"); expect(sextantOf(43)).toBe("s5");
    expect(sextantOf(44)).toBe("s6"); expect(sextantOf(48)).toBe("s6");
    expect(sextantOf(55)).toBeNull();
    // every permanent tooth is in exactly one sextant
    const all = SEXTANTS.flatMap((s) => s.teeth);
    expect(new Set(all).size).toBe(32); expect(all.length).toBe(32);
  });
  it("parses and cleans a reading", () => {
    expect(parseBoneLevels(null)).toEqual({ levels: null });
    expect(parseBoneLevels({})).toEqual({ levels: null });
    expect(parseBoneLevels({ s1: { level: "coronal_third", pattern: "horizontal" }, s6: { level: "none" } }))
      .toEqual({ levels: { s1: { level: "coronal_third", pattern: "horizontal" }, s6: { level: "none" } } });
  });
  it("refuses what the database refuses", () => {
    for (const bad of [{ s7: { level: "none" } }, { s1: { level: "severe" } }, { s1: { level: "none", pattern: "curved" } }, { s1: { pattern: "mixed" } },
      { s1: { level: "none", extra: 1 } }, { s1: "none" }, [], "x"]) {
      expect(parseBoneLevels(bad)).toEqual({ error: true });
    }
  });
  it("reads the form fields", () => {
    const f: Record<string, string> = { bone_s2_level: "middle_third", bone_s2_pattern: "vertical", bone_s5_level: "none" };
    expect(boneLevelsFromForm((n) => f[n] ?? "")).toEqual({ levels: { s2: { level: "middle_third", pattern: "vertical" }, s5: { level: "none" } } });
    expect(boneLevelsFromForm(() => "")).toEqual({ levels: null });
    expect(boneLevelsFromForm((n) => (n === "bone_s1_pattern" ? "mixed" : ""))).toEqual({ error: true });
    expect(boneLevelsFromForm((n) => (n === "bone_s1_level" ? "nonsense" : ""))).toEqual({ error: true });
  });
  it("summarises it in one line, in both languages", () => {
    const levels = { s1: { level: "coronal_third", pattern: "horizontal" }, s4: { level: "middle_third" } };
    expect(summarizeBoneLevels(levels, "en")).toBe("S1 Coronal third (15–33%) (Horizontal) · S4 Middle third");
    expect(summarizeBoneLevels(levels, "ar")).toContain("S1 الثلث التاجي");
    expect(summarizeBoneLevels(null, "en")).toBe("");
    expect(worstBoneLevel(levels)).toBe("middle_third");
    expect(worstBoneLevel({ s1: { level: "none" } })).toBe("none");
    expect(worstBoneLevel(null)).toBeNull();
  });
});

describe("annotation shapes", () => {
  const ok = [
    { type: "arrow", x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6 }, { type: "circle", cx: 0.5, cy: 0.5, r: 0.1, color: "red" },
    { type: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.3 }, { type: "text", x: 0.4, y: 0.4, text: "  RCT?  " },
  ];
  it("accepts the four kinds and trims text", () => {
    const r = parseShapes(ok);
    expect("shapes" in r && r.shapes.length).toBe(4);
    expect("shapes" in r && r.shapes[3]).toEqual({ type: "text", x: 0.4, y: 0.4, text: "RCT?" });
  });
  it("refuses coordinates outside 0-1, unknown or missing data", () => {
    for (const bad of [[], {}, [{ type: "arrow", x1: 2, y1: 0, x2: 0, y2: 0 }], [{ type: "line" }], [{ type: "circle", cx: 0.5, cy: 0.5 }],
      [{ type: "circle", cx: 0.5, cy: 0.5, r: 0 }], [{ type: "text", x: 0.1, y: 0.1, text: " " }], [{ type: "text", x: 0.1, y: 0.1, text: "x".repeat(201) }],
      [{ type: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2, onclick: "x" }], [{ type: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2, color: "pink" }],
      [{ type: "rect", x: -0.1, y: 0.1, w: 0.2, h: 0.2 }], [{ type: "rect", x: Number.NaN, y: 0, w: 0.2, h: 0.2 }], Array(51).fill(ok[0])]) {
      expect(parseShapes(bad)).toEqual({ error: true });
    }
  });
});

describe("the viewer's geometry", () => {
  const box = { w: 400, h: 200 };
  it("maps the centre of the screen to the centre of the image", () => {
    expect(toNormalized(0, 0, box, INITIAL_VIEW)).toEqual({ x: 0.5, y: 0.5 });
    const c = toNormalized(200, 100, box, INITIAL_VIEW);
    expect(c.x).toBeCloseTo(1); expect(c.y).toBeCloseTo(1);
  });
  it("follows zoom and pan", () => {
    const v = { zoom: 2, rotate: 0, tx: 50, ty: -20 };
    // the image centre sits at (50, -20) on the screen
    const p = toNormalized(50, -20, box, v);
    expect(p.x).toBeCloseTo(0.5); expect(p.y).toBeCloseTo(0.5);
    // 100 px to the right of the centre at zoom 2 is 50 image pixels: 0.125 of the width
    expect(toNormalized(150, -20, box, v).x).toBeCloseTo(0.625);
  });
  it("follows rotation", () => {
    const v = { zoom: 1, rotate: 90, tx: 0, ty: 0 };
    // rotated a quarter turn clockwise, a point 100 px right of the centre of the screen is 100 px above the image centre
    const p = toNormalized(100, 0, box, v);
    expect(p.x).toBeCloseTo(0.5); expect(p.y).toBeCloseTo(0);
  });
  it("zooms about a point and keeps it still", () => {
    const v = zoomAt(INITIAL_VIEW, 2, 100, 50);
    expect(v.zoom).toBe(2);
    const before = toNormalized(100, 50, box, INITIAL_VIEW), after = toNormalized(100, 50, box, v);
    expect(after.x).toBeCloseTo(before.x); expect(after.y).toBeCloseTo(before.y);
  });
  it("limits the zoom and wraps the rotation", () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM); expect(clampZoom(0.001)).toBe(MIN_ZOOM);
    expect(zoomAt(INITIAL_VIEW, 1000, 0, 0).zoom).toBe(MAX_ZOOM);
    expect(rotateBy(INITIAL_VIEW, 90).rotate).toBe(90);
    expect(rotateBy({ ...INITIAL_VIEW, rotate: 270 }, 90).rotate).toBe(0);
    expect(rotateBy(INITIAL_VIEW, -90).rotate).toBe(270);
  });
});

describe("a radiographic finding names its image in the exam form", () => {
  const IMG = "11111111-1111-4111-8111-111111111111";
  const form = (findings: unknown[]) => {
    const fd = new FormData();
    fd.set("exam_date", "2026-01-01"); fd.set("findings", JSON.stringify(findings));
    return fd;
  };
  it("keeps the image id", () => {
    const r = parseExamForm(form([{ tooth: 36, kind: "periapical_lesion", evidence: "radiographic", imaging_id: IMG }]), t, "2026-11-01");
    expect("error" in r).toBe(false);
    if (!("error" in r)) expect(r.findings[0].imaging_id).toBe(IMG);
  });
  it("refuses an image on a finding that is not radiographic, or a bad id", () => {
    expect(parseExamForm(form([{ tooth: 36, kind: "caries", evidence: "clinical", imaging_id: IMG }]), t, "2026-11-01")).toHaveProperty("error");
    expect(parseExamForm(form([{ tooth: 36, kind: "caries", evidence: "radiographic", imaging_id: "nope" }]), t, "2026-11-01")).toHaveProperty("error");
  });
  it("leaves findings without an image alone", () => {
    const r = parseExamForm(form([{ tooth: 36, kind: "caries", evidence: "radiographic", imaging_id: "" }]), t, "2026-11-01");
    expect("error" in r).toBe(false);
    if (!("error" in r)) expect(r.findings[0]).not.toHaveProperty("imaging_id");
  });
});
