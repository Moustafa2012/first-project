/**
 * A QR Code encoder (ISO/IEC 18004), no dependency: byte mode, error correction level M, versions 1-10 (up to 213 bytes),
 * all eight masks tried with the standard penalty scoring, rendered to SVG. Used for share links now and for the emergency card later.
 */
export interface QrCode { version: number; size: number; mask: number; modules: boolean[][] }

// ---------------------------------------------------------------- tables for level M, versions 1..10
const EC_PER_BLOCK_M = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS_M = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
export const QR_MAX_VERSION = 10;

const sizeOf = (version: number) => version * 4 + 17;
/** Modules that carry codewords (everything but finder, timing, alignment, format and version patterns). */
export function rawDataModules(version: number): number {
  let r = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const n = Math.floor(version / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (version >= 7) r -= 36;
  }
  return r;
}
const dataCodewords = (version: number) => Math.floor(rawDataModules(version) / 8) - EC_PER_BLOCK_M[version] * BLOCKS_M[version];
/** How many bytes fit at level M in the given version. */
export function byteCapacity(version: number): number {
  const countBits = version < 10 ? 8 : 16;
  return Math.floor((dataCodewords(version) * 8 - 4 - countBits) / 8);
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const n = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = sizeOf(version) - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

// ---------------------------------------------------------------- Reed-Solomon over GF(256), polynomial 0x11D
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}
function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

// ---------------------------------------------------------------- codewords
export function utf8(text: string): number[] { return Array.from(new TextEncoder().encode(text)); }

function dataBits(bytes: number[], version: number): number[] {
  const bits: number[] = [];
  const put = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);                                  // byte mode
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capBits = dataCodewords(version) * 8;
  put(0, Math.min(4, capBits - bits.length));      // terminator
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) put(pad, 8);
  return bits;
}

function pack(bits: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return out;
}

function interleave(data: number[], version: number): number[] {
  const nBlocks = BLOCKS_M[version], ecLen = EC_PER_BLOCK_M[version];
  const raw = Math.floor(rawDataModules(version) / 8);
  const nShort = nBlocks - (raw % nBlocks), shortLen = Math.floor(raw / nBlocks);
  const div = rsDivisor(ecLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - ecLen + (i < nShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < nShort) dat.push(0);                   // placeholder so every block has the same length; skipped when interleaving
    blocks.push(dat.concat(ecc));
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => { if (i !== shortLen - ecLen || j >= nShort) out.push(block[i]); });
  }
  return out;
}

// ---------------------------------------------------------------- the matrix
const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

class Builder {
  readonly size: number;
  modules: boolean[][];
  isFn: boolean[][];
  constructor(readonly version: number) {
    this.size = sizeOf(version);
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFn = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.drawFunctionPatterns();
  }
  setFn(x: number, y: number, dark: boolean) { this.modules[y][x] = dark; this.isFn[y][x] = true; }

  private drawFunctionPatterns() {
    const { size, version } = this;
    for (let i = 0; i < size; i++) { this.setFn(6, i, i % 2 === 0); this.setFn(i, 6, i % 2 === 0); }
    this.finder(3, 3); this.finder(size - 4, 3); this.finder(3, size - 4);
    const al = alignmentPositions(version), n = al.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;   // overlaps a finder
      this.alignment(al[i], al[j]);
    }
    this.formatBits(0);                            // reserves the format areas; redrawn once the mask is chosen
    this.versionBits();
  }
  private finder(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.setFn(xx, yy, dist !== 2 && dist !== 4);
    }
  }
  private alignment(x: number, y: number) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.setFn(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  /** Format information: error-correction level M (bits 00) and the mask, BCH(15,5), XOR 0x5412. */
  formatBits(mask: number) {
    const data = (0b00 << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const { size } = this;
    for (let i = 0; i <= 5; i++) this.setFn(8, i, bit(bits, i));
    this.setFn(8, 7, bit(bits, 6)); this.setFn(8, 8, bit(bits, 7)); this.setFn(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFn(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.setFn(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.setFn(8, size - 15 + i, bit(bits, i));
    this.setFn(8, size - 8, true);                 // the always-dark module
  }
  /** Version information (versions 7 and up): BCH(18,6). */
  private versionBits() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = this.size - 11 + (i % 3), b = Math.floor(i / 3);
      this.setFn(a, b, bit(bits, i)); this.setFn(b, a, bit(bits, i));
    }
  }
  /** Zigzag placement of the codeword bits in the free modules. */
  place(codewords: number[]) {
    const { size } = this;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
        if (!this.isFn[y][x] && i < codewords.length * 8) { this.modules[y][x] = bit(codewords[i >>> 3], 7 - (i & 7)); i++; }
      }
    }
    return i;
  }
  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
      let invert: boolean;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      }
      if (!this.isFn[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
    }
  }
}

/** Penalty score of the standard (ISO 18004 section 7.8.3): runs, 2x2 blocks, finder-like patterns, dark/light balance. */
export function penalty(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  // rule 1: five or more equal modules in a row or column
  const runs = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < size; i++) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        if (get(i, j) === get(i, j - 1)) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  };
  runs((y, x) => m[y][x]); runs((x, y) => m[y][x]);
  // rule 2: 2x2 blocks of one colour
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
  }
  // rule 3: 1:1:3:1:1 finder-like pattern with four light modules on either side
  const A = [true, false, true, true, true, false, true, false, false, false, false];
  const B = [false, false, false, false, true, false, true, true, true, false, true];
  const pat = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < size; i++) for (let j = 0; j + 11 <= size; j++) {
      let a = true, b = true;
      for (let k = 0; k < 11 && (a || b); k++) { const v = get(i, j + k); if (v !== A[k]) a = false; if (v !== B[k]) b = false; }
      if (a) score += 40;
      if (b) score += 40;
    }
  };
  pat((y, x) => m[y][x]); pat((x, y) => m[y][x]);
  // rule 4: balance of dark modules
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/** Encodes UTF-8 text (byte mode, level M) in the smallest version that fits. Throws when it does not fit in version 10 (213 bytes). */
export function encodeQr(text: string): QrCode {
  const bytes = utf8(text);
  let version = 1;
  while (version <= QR_MAX_VERSION && bytes.length > byteCapacity(version)) version++;
  if (version > QR_MAX_VERSION) throw new Error(`qr: ${bytes.length} bytes do not fit (maximum ${byteCapacity(QR_MAX_VERSION)})`);

  const codewords = interleave(pack(dataBits(bytes, version)), version);
  const base = new Builder(version);
  const placed = base.place(codewords);
  if (placed !== codewords.length * 8) throw new Error("qr: internal error (module count)");

  let best: { mask: number; modules: boolean[][]; score: number } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    const b = new Builder(version);
    b.place(codewords);
    b.applyMask(mask);
    b.formatBits(mask);
    const score = penalty(b.modules);
    if (!best || score < best.score) best = { mask, modules: b.modules, score };
  }
  const chosen = best as { mask: number; modules: boolean[][]; score: number };
  return { version, size: sizeOf(version), mask: chosen.mask, modules: chosen.modules };
}

/** The same code with a fixed mask (used by the tests to compare each mask with a reference encoder). */
export function encodeQrWithMask(text: string, mask: number): QrCode {
  const bytes = utf8(text);
  let version = 1;
  while (version <= QR_MAX_VERSION && bytes.length > byteCapacity(version)) version++;
  if (version > QR_MAX_VERSION) throw new Error("qr: too long");
  const b = new Builder(version);
  b.place(interleave(pack(dataBits(bytes, version)), version));
  b.applyMask(mask);
  b.formatBits(mask);
  return { version, size: b.size, mask, modules: b.modules };
}

/** The dark modules as one SVG path (runs of horizontal modules), in a square of `size` units including the quiet zone. */
export function qrPath(text: string, quiet = 4): { size: number; d: string; modules: number } {
  const qr = encodeQr(text);
  let d = "";
  for (let y = 0; y < qr.size; y++) {
    let x = 0;
    while (x < qr.size) {
      if (!qr.modules[y][x]) { x++; continue; }
      let run = 1;
      while (x + run < qr.size && qr.modules[y][x + run]) run++;
      d += `M${x + quiet} ${y + quiet}h${run}v1h-${run}z`;
      x += run;
    }
  }
  return { size: qr.size + quiet * 2, d, modules: qr.size };
}

/**
 * The code as an SVG string: black modules on a white square with a four-module quiet zone (always black on white, also in
 * dark mode, so every scanner reads it). `px` is the rendered width in CSS pixels (the drawing scales).
 */
export function qrSvg(text: string, opts: { px?: number; quiet?: number; label?: string } = {}): string {
  const { size: n, d } = qrPath(text, opts.quiet ?? 4);
  const px = opts.px ?? 220;
  const label = (opts.label ?? "QR code").replace(/[<>&"]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" role="img" aria-label="${label}" shape-rendering="crispEdges">`
    + `<rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
