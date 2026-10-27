import "server-only";
import { NextResponse } from "next/server";
import { renderPdf, type Block, type ReportMeta } from "@/lib/pdf/engine";

/** Renders and returns the PDF inline (the browser's PDF viewer offers print + save). Never cached, never indexed. */
export async function pdfResponse(meta: ReportMeta, blocks: Block[], filename: string, extra: Record<string, string> = {}, download = false) {
  const bytes = await renderPdf(meta, blocks);
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf", "Content-Length": String(bytes.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safe}"`,
      "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, noarchive",
      "Referrer-Policy": "no-referrer", ...extra,
    },
  });
}
