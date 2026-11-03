import { SURFACES, parseTeeth } from "@/lib/dental";
import { UUID_RE } from "@/lib/uuid";

type T = (ar: string, en: string) => string;
const CODE_RE = /^[a-z][a-z0-9_]{1,40}$/;
const str = (fd: FormData, k: string, max = 2000) => String(fd.get(k) ?? "").trim().slice(0, max);

/** One treatment from a form: a catalogue procedure (or a name), the teeth, the surfaces, the problem it treats, the phase. */
export function parseTreatmentItem(fd: FormData, t: T): { item: Record<string, unknown> } | { error: string } {
  const code = str(fd, "catalog_code", 60), name = str(fd, "name", 200);
  if (code && !CODE_RE.test(code)) return { error: t("إجراء غير صالح.", "Invalid procedure.") };
  if (!code && name.length < 2) return { error: t("اختر الإجراء من القائمة أو اكتب اسمه.", "Choose the procedure from the list or type its name.") };
  const teeth = parseTeeth(str(fd, "teeth", 200));
  if (teeth === null) return { error: t("أرقام الأسنان غير صحيحة (FDI، مثل 16 أو 36).", "Invalid tooth numbers (FDI, e.g. 16 or 36).") };
  const surfaces = fd.getAll("surfaces").map(String).filter((s) => (SURFACES as string[]).includes(s));
  if (surfaces.length && teeth.length !== 1) return { error: t("الأسطح تُحدد لسن واحد.", "Surfaces are given for a single tooth.") };
  const cond = str(fd, "condition_id", 40);
  if (cond && !UUID_RE.test(cond)) return { error: t("طلب غير صالح.", "Invalid request.") };
  const phase = Number(str(fd, "phase", 3) || "1");
  if (!Number.isInteger(phase) || phase < 1 || phase > 20) return { error: t("المرحلة بين 1 و20.", "The phase is between 1 and 20.") };
  return { item: { catalog_code: code || null, name: name || null, teeth, surfaces, condition_id: cond || null, phase, notes: str(fd, "notes", 2000) || null } };
}

