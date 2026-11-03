import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const BUCKET = "medical-documents";

/**
 * Streams a stored file through the server with hardened headers. The storage path and any
 * storage URL never reach the browser; access has been authorised by the caller beforehand.
 */
export async function serveStoredFile(path: string, mime: string, filename: string, download: boolean): Promise<NextResponse> {
  const { data, error } = await createAdminClient().storage.from(BUCKET).download(path);
  if (error || !data) return new NextResponse("Not found", { status: 404 });
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  const isPdf = mime === "application/pdf";
  return new NextResponse(data.stream(), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": String(data.size),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
      // Chrome's built-in PDF viewer does not run under "sandbox"; images get the full sandbox.
      "Content-Security-Policy": isPdf ? "default-src 'none'; object-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'" : "default-src 'none'; img-src 'self'; sandbox; frame-ancestors 'none'",
    },
  });
}
