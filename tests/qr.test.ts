import { describe, expect, it } from "vitest";
import { byteCapacity, encodeQr, encodeQrWithMask, penalty, QR_MAX_VERSION, qrSvg, rawDataModules } from "@/lib/qr";
import reference from "./fixtures/qr-reference.json";

/**
 * The reference matrices were produced by an independent encoder (the Python `segno` package, level M, byte mode, the
 * same mask forced), and the codes our encoder produces were decoded back with OpenCV's QR decoder (see the slice notes).
 */
interface Ref { note: string; text: string; mask: number; version: number; size: number; hex: string }
const refs = reference as Ref[];

function fromHex(hex: string, size: number): boolean[][] {
  const bits = hex.match(/../g)!.map((h) => parseInt(h, 16).toString(2).padStart(8, "0")).join("");
  return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => bits[y * size + x] === "1"));
}
const ascii = (m: boolean[][]) => m.map((r) => r.map((c) => (c ? "#" : ".")).join("")).join("\n");

describe("capacity tables (level M)", () => {
  it("byte capacities of versions 1-10 match the standard", () => {
    expect(Array.from({ length: 10 }, (_, i) => byteCapacity(i + 1))).toEqual([14, 26, 42, 62, 84, 106, 122, 152, 180, 213]);
  });
  it("raw data modules match the standard (codewords x 8 + remainder bits)", () => {
    const totalCodewords = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
    const remainder = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0];
    totalCodewords.forEach((cw, i) => expect(rawDataModules(i + 1)).toBe(cw * 8 + remainder[i]));
  });
});

describe("reference matrices", () => {
  for (const r of refs) {
    it(`${r.note}, mask ${r.mask}`, () => {
      const mine = encodeQrWithMask(r.text, r.mask);
      expect(mine.version).toBe(r.version);
      expect(mine.size).toBe(r.size);
      expect(ascii(mine.modules)).toBe(ascii(fromHex(r.hex, r.size)));
    });
  }
  it("covers all eight masks and several versions (1, 3, 5, 6, 7, 10)", () => {
    expect(new Set(refs.map((r) => r.mask)).size).toBe(8);
    expect(new Set(refs.map((r) => r.version))).toEqual(new Set([1, 3, 5, 6, 7, 10]));
  });
});

describe("encodeQr", () => {
  it("picks the smallest version and the mask with the lowest penalty", () => {
    for (const text of ["Hello", "https://shifa.example/s/Qk3vXz9", "x".repeat(60), "y".repeat(122), "مرحبا"]) {
      const qr = encodeQr(text);
      const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((m) => penalty(encodeQrWithMask(text, m).modules));
      expect(scores[qr.mask]).toBe(Math.min(...scores));
      expect(qr.mask).toBe(scores.indexOf(Math.min(...scores)));
    }
  });
  it("fills exactly the capacity of each version (13/14/15 bytes switch version 1 -> 2)", () => {
    expect(encodeQr("a".repeat(14)).version).toBe(1);
    expect(encodeQr("a".repeat(15)).version).toBe(2);
    expect(encodeQr("a".repeat(213)).version).toBe(QR_MAX_VERSION);
    expect(() => encodeQr("a".repeat(214))).toThrow(/do not fit/);
  });
  it("is deterministic and keeps the finder patterns, the dark module and the timing pattern", () => {
    const a = encodeQr("https://shifa.example/s/abc"), b = encodeQr("https://shifa.example/s/abc");
    expect(ascii(a.modules)).toBe(ascii(b.modules));
    const m = a.modules, n = a.size;
    const finder = (x: number, y: number) => {
      for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
        const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        expect(m[y + dy][x + dx]).toBe(ring !== 2);
      }
    };
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
    expect(m[n - 8][8]).toBe(true);
    for (let i = 8; i < n - 8; i++) { expect(m[6][i]).toBe(i % 2 === 0); expect(m[i][6]).toBe(i % 2 === 0); }
  });
  it("different texts give different codes", () => {
    expect(ascii(encodeQr("one").modules)).not.toBe(ascii(encodeQr("two").modules));
  });
});

describe("qrSvg", () => {
  it("renders a black-on-white square with a four-module quiet zone", () => {
    const qr = encodeQr("https://shifa.example/s/abc");
    const svg = qrSvg("https://shifa.example/s/abc", { px: 200, label: "Share link" });
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 (\d+) \1"/);
    expect(svg).toContain(`viewBox="0 0 ${qr.size + 8} ${qr.size + 8}"`);
    expect(svg).toContain('fill="#fff"');
    expect(svg).toContain('aria-label="Share link"');
    const dark = qr.modules.flat().filter(Boolean).length;
    const area = Array.from(svg.matchAll(/h(\d+)v1h-\1z/g)).reduce((sum, mm) => sum + Number(mm[1]), 0);
    expect(area).toBe(dark);
  });
  it("cannot inject markup through the label", () => {
    expect(qrSvg("a", { label: '"><script>' })).not.toContain("<script>");
  });
});
