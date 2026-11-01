/**
 * A small ZIP writer: store only (no compression), CRC-32, UTF-8 file names. No dependency.
 * Enough for the patient's export (JSON + the document files, which are PDFs and images that do not compress further).
 * Limits of the classic format (no ZIP64): fewer than 65 535 entries and under 4 GiB in total; larger input is refused.
 */
export interface ZipEntry { name: string; data: Uint8Array; date?: Date }

let TABLE: Uint32Array | null = null;
function table(): Uint32Array {
  if (TABLE) return TABLE;
  TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    TABLE[n] = c >>> 0;
  }
  return TABLE;
}

/** CRC-32 (IEEE 802.3), as used by ZIP, PNG and gzip. */
export function crc32(data: Uint8Array, seed = 0): number {
  const t = table();
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time (2-second resolution, years 1980-2107), in UTC so the archive does not depend on the server's zone. */
function dosDateTime(d: Date): { time: number; date: number } {
  const y = Math.min(2107, Math.max(1980, d.getUTCFullYear()));
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

const enc = new TextEncoder();

/** Names are stored with "/" separators, never absolute and never leaving the archive root. */
export function safeZipName(name: string): string {
  const parts = name.replace(/\\/g, "/").split("/").filter((p) => p && p !== "." && p !== "..");
  const out = parts.join("/").replace(/[\u0000-\u001f]/g, "_");
  if (!out) throw new Error("zip: empty file name");
  return out;
}

export function createZip(entries: ZipEntry[], now = new Date()): Uint8Array {
  if (entries.length >= 0xffff) throw new Error("zip: too many files");
  const seen = new Set<string>();
  const prepared = entries.map((e) => {
    const name = safeZipName(e.name);
    if (seen.has(name)) throw new Error(`zip: duplicate file name ${name}`);
    seen.add(name);
    const nameBytes = enc.encode(name);
    if (nameBytes.length > 0xffff) throw new Error("zip: file name too long");
    const dt = dosDateTime(e.date ?? now);
    return { nameBytes, data: e.data, crc: crc32(e.data), ...dt };
  });

  let size = 22;
  for (const e of prepared) size += 30 + e.nameBytes.length + e.data.length + 46 + e.nameBytes.length;
  if (size >= 0xffffffff) throw new Error("zip: archive too large");

  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  let pos = 0;
  const offsets: number[] = [];
  for (const e of prepared) {
    offsets.push(pos);
    v.setUint32(pos, 0x04034b50, true);       // local file header
    v.setUint16(pos + 4, 20, true);            // version needed
    v.setUint16(pos + 6, 0x0800, true);        // general purpose: bit 11 = UTF-8 names
    v.setUint16(pos + 8, 0, true);             // method 0 = stored
    v.setUint16(pos + 10, e.time, true);
    v.setUint16(pos + 12, e.date, true);
    v.setUint32(pos + 14, e.crc, true);
    v.setUint32(pos + 18, e.data.length, true);
    v.setUint32(pos + 22, e.data.length, true);
    v.setUint16(pos + 26, e.nameBytes.length, true);
    v.setUint16(pos + 28, 0, true);            // extra length
    out.set(e.nameBytes, pos + 30);
    out.set(e.data, pos + 30 + e.nameBytes.length);
    pos += 30 + e.nameBytes.length + e.data.length;
  }
  const cdStart = pos;
  prepared.forEach((e, i) => {
    v.setUint32(pos, 0x02014b50, true);        // central directory header
    v.setUint16(pos + 4, 20, true);            // version made by
    v.setUint16(pos + 6, 20, true);            // version needed
    v.setUint16(pos + 8, 0x0800, true);
    v.setUint16(pos + 10, 0, true);
    v.setUint16(pos + 12, e.time, true);
    v.setUint16(pos + 14, e.date, true);
    v.setUint32(pos + 16, e.crc, true);
    v.setUint32(pos + 20, e.data.length, true);
    v.setUint32(pos + 24, e.data.length, true);
    v.setUint16(pos + 28, e.nameBytes.length, true);
    v.setUint16(pos + 30, 0, true);            // extra length
    v.setUint16(pos + 32, 0, true);            // comment length
    v.setUint16(pos + 34, 0, true);            // disk number
    v.setUint16(pos + 36, 0, true);            // internal attributes
    v.setUint32(pos + 38, 0, true);            // external attributes
    v.setUint32(pos + 42, offsets[i], true);
    out.set(e.nameBytes, pos + 46);
    pos += 46 + e.nameBytes.length;
  });
  v.setUint32(pos, 0x06054b50, true);          // end of central directory
  v.setUint16(pos + 4, 0, true);
  v.setUint16(pos + 6, 0, true);
  v.setUint16(pos + 8, prepared.length, true);
  v.setUint16(pos + 10, prepared.length, true);
  v.setUint32(pos + 12, pos - cdStart, true);
  v.setUint32(pos + 16, cdStart, true);
  v.setUint16(pos + 20, 0, true);
  return out;
}
