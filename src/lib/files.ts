export const MAX_DOC_BYTES = 20 * 1024 * 1024;

export type DocMime = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
export const EXT: Record<DocMime, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** Identifies the file by its content (magic number), never by its name or the browser-declared type. */
export function sniffMime(b: Uint8Array): DocMime | null {
  if (b.length < 12) return null;
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";                       // %PDF-
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp"; // RIFF....WEBP
  return null;
}

/**
 * Cheap guard for active content inside a PDF (JavaScript, auto-launch actions, embedded files).
 * This is a heuristic, not a malware scanner: the file is additionally served sandboxed with a
 * restrictive Content-Security-Policy and nosniff.
 */
export function pdfHasActiveContent(b: Uint8Array): boolean {
  const text = new TextDecoder("latin1").decode(b);
  return /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)\b/.test(text);
}

export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "file";
}
