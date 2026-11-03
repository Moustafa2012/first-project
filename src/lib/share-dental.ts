import type { PulpTest, Sections } from "@/lib/dental-exam";
import type { AnnotationRow, BoneLevels } from "@/lib/dental-imaging";
import type { ShareDental } from "@/lib/share-types";

/** What public.share_dental_exam_extras returns: the sections, baseline flag and pulp tests of each exam in scope. */
export type ShareExamExtras = { status: string; exams?: Record<string, { sections: Sections | null; is_baseline: boolean; pulp_tests: PulpTest[] }> } | null;
/** What public.share_dental_imaging_extras returns: the reading, the files the link can open, the annotations, the image each finding was read on. */
export type ShareImagingExtras = {
  status: string; images?: Record<string, { findings: string | null; bone_levels: BoneLevels | null; documents: { id: string; title: string; mime_type: string }[] }>;
  annotations?: AnnotationRow[]; finding_images?: Record<string, string>;
} | null;

/** Adds the extras to the dental chart of a share (in place), as the doctor's view shows them; the PDF reads the same result. */
export function mergeShareDental(dent: ShareDental | null, xx: ShareExamExtras, ix: ShareImagingExtras): void {
  if (dent?.status !== "ok") return;
  if (xx?.status === "ok" && xx.exams) {
    const exams = xx.exams;
    dent.exams = dent.exams.map((e) => ({ ...e, sections: exams[e.id]?.sections ?? null, is_baseline: exams[e.id]?.is_baseline ?? false }));
    dent.pulp = Object.fromEntries(Object.entries(exams).map(([k, v]) => [k, v.pulp_tests ?? []]));
  }
  if (ix?.status === "ok") {
    dent.imaging = (dent.imaging ?? []).map((i) => ({ ...i, findings: ix.images?.[i.id]?.findings ?? null, bone_levels: ix.images?.[i.id]?.bone_levels ?? null, documents: ix.images?.[i.id]?.documents ?? [] }));
    dent.findings = dent.findings.map((f) => ({ ...f, imaging_id: ix.finding_images?.[f.id] ?? null }));
    dent.annotations = ix.annotations ?? [];
  }
}
