import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, createZip, safeZipName } from "@/lib/zip";

const enc = (s: string) => new TextEncoder().encode(s);
const hasUnzip = spawnSync("unzip", ["-v"]).status === 0;

/** Reads the archive back with an independent minimal parser (central directory), checking every CRC. */
function readBack(zip: Uint8Array): { name: string; data: Uint8Array }[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: { name: string; data: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const crc = v.getUint32(p + 16, true), size = v.getUint32(p + 24, true), nameLen = v.getUint16(p + 28, true), off = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    expect(v.getUint32(off, true)).toBe(0x04034b50);
    const lhName = v.getUint16(off + 26, true), lhExtra = v.getUint16(off + 28, true);
    const data = zip.subarray(off + 30 + lhName + lhExtra, off + 30 + lhName + lhExtra + size);
    expect(crc32(data)).toBe(crc);
    out.push({ name, data });
    p += 46 + nameLen;
  }
  return out;
}

describe("crc32", () => {
  it("matches the published check values", () => {
    expect(crc32(enc("123456789"))).toBe(0xcbf43926);
    expect(crc32(enc(""))).toBe(0);
    expect(crc32(enc("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });
  it("can be continued in chunks", () => {
    const whole = crc32(enc("hello world"));
    expect(crc32(enc(" world"), crc32(enc("hello")))).toBe(whole);
  });
});

describe("createZip", () => {
  const files = [
    { name: "record.json", data: enc(JSON.stringify({ a: 1, b: [1, 2, 3] })) },
    { name: "documents/ab12cd34-تقرير.pdf", data: new Uint8Array(Array.from({ length: 70_000 }, (_, i) => (i * 31) & 255)) },
    { name: "empty.txt", data: new Uint8Array(0) },
  ];

  it("round-trips names (UTF-8) and bytes", () => {
    const back = readBack(createZip(files, new Date("2026-11-01T10:20:30Z")));
    expect(back.map((f) => f.name)).toEqual(files.map((f) => f.name));
    back.forEach((f, i) => expect(Array.from(f.data)).toEqual(Array.from(files[i].data)));
  });

  it.runIf(hasUnzip)("opens with unzip -t", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zip-"));
    const file = path.join(dir, "t.zip");
    writeFileSync(file, createZip(files, new Date("2026-11-01T10:20:30Z")));
    const out = execFileSync("unzip", ["-t", file], { encoding: "utf8" });
    expect(out).toMatch(/No errors detected/);
    expect(readFileSync(file).length).toBeGreaterThan(70_000);
    const listing = execFileSync("unzip", ["-Z1", file], { encoding: "utf8" });
    expect(listing).toContain("record.json");
    expect(listing).toContain("empty.txt");
  });

  it("refuses duplicate names, and cleans names so nothing leaves the archive root", () => {
    expect(() => createZip([{ name: "a", data: enc("1") }, { name: "a", data: enc("2") }])).toThrow(/duplicate/);
    expect(safeZipName("../../etc/passwd")).toBe("etc/passwd");
    expect(safeZipName("/abs\\path/./file.txt")).toBe("abs/path/file.txt");
    expect(() => safeZipName("..")).toThrow();
    const back = readBack(createZip([{ name: "../x.txt", data: enc("x") }]));
    expect(back[0].name).toBe("x.txt");
  });

  it("an empty archive is valid", () => {
    expect(createZip([]).length).toBe(22);
  });
});
