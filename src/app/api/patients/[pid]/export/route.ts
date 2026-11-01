import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET } from "@/lib/storage";
import { UUID_RE } from "@/lib/uuid";
import { buildFhirBundle, documentFileName, exportReadme, type ExportRecord } from "@/lib/fhir";
import { createZip, type ZipEntry } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The archive is built in memory: documents beyond this total are left out and listed as missing. */
const MAX_DOCUMENT_BYTES = 300 * 1024 * 1024;

const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v, null, 2));

/**
 * GET /api/patients/:pid/export — a ZIP with record.json (every record, active and entered-in-error, by table), fhir.json
 * (FHIR R4 Bundle), README.txt and the document files under documents/. Owner or guardian only: the record is read with
 * the caller's rights through public.patient_export_data (which refuses anyone else), and the export is written to the audit log.
 */
export async function GET(_request: NextRequest, { params }: { params: { pid: string } }) {
  if (!UUID_RE.test(params.pid)) return new NextResponse("Not found", { status: 404 });
  const user = await currentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const supabase = createClient();

  const { data, error } = await supabase.rpc("patient_export_data", { p_patient: params.pid });
  if (error) {
    const forbidden = error.code === "42501" || /forbidden/i.test(error.message);
    return new NextResponse(forbidden ? "Forbidden" : "Could not read the record", { status: forbidden ? 403 : 500 });
  }
  const record = data as ExportRecord;
  const patient = (record.patients as Record<string, unknown>[] | undefined)?.[0];
  if (!patient) return new NextResponse("Not found", { status: 404 });

  // the document files, read from the private bucket after the access check above
  const docs = (record.medical_documents ?? []) as { id: string; storage_path: string; original_filename: string; mime_type: string; size_bytes: number }[];
  const files: ZipEntry[] = [];
  const outcome: { id: string; file: string; included: boolean; reason?: string }[] = [];
  let total = 0;
  const admin = createAdminClient();
  for (const d of docs) {
    const file = documentFileName(d);
    if (total + Number(d.size_bytes) > MAX_DOCUMENT_BYTES) { outcome.push({ id: d.id, file, included: false, reason: "size limit of the archive" }); continue; }
    // the path must belong to this patient (the table guarantees it; checked again before reading the bucket)
    if (!d.storage_path.startsWith(`${params.pid}/`)) { outcome.push({ id: d.id, file, included: false, reason: "unexpected storage path" }); continue; }
    const { data: blob, error: dlError } = await admin.storage.from(BUCKET).download(d.storage_path);
    if (dlError || !blob) { outcome.push({ id: d.id, file, included: false, reason: "not found in storage" }); continue; }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    total += bytes.length;
    files.push({ name: `documents/${file}`, data: bytes });
    outcome.push({ id: d.id, file, included: true });
  }

  const now = new Date();
  const counts: Record<string, number> = {};
  for (const [table, rows] of Object.entries(record)) if (Array.isArray(rows)) counts[table] = rows.length;
  const included = outcome.filter((o) => o.included).length;
  const mrn = String(patient.mrn ?? "file");

  const entries: ZipEntry[] = [
    { name: "README.txt", data: new TextEncoder().encode(exportReadme({ mrn, exportedAt: now.toISOString(), documents: included, skippedDocuments: outcome.length - included, counts })) },
    { name: "record.json", data: json({ export: { format: "shifa-record/1", exported_at: now.toISOString(), exported_by: user.id, document_files: outcome }, ...record }) },
    { name: "fhir.json", data: json(buildFhirBundle(record, now)) },
    ...files,
  ];
  let archive: Uint8Array;
  try { archive = createZip(entries, now); } catch (e) {
    console.error("[export-error]", String((e as Error)?.message ?? e).slice(0, 200));
    return new NextResponse("Could not create the archive", { status: 500 });
  }

  // no data leaves without a trace
  const { error: logError } = await supabase.rpc("patient_export_log", { p_patient: params.pid, p_documents: included });
  if (logError) return new NextResponse("Could not record the export", { status: 500 });

  const name = `shifa-${mrn}-${now.toISOString().slice(0, 10)}.zip`.replace(/[^A-Za-z0-9._-]/g, "_");
  return new NextResponse(Buffer.from(archive), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(archive.length),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
