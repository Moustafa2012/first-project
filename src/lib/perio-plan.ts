import { calOf, type PerioTooth } from "@/lib/perio";
import { dxLine, type DxLike } from "@/lib/perio-staging";

/**
 * The periodontal treatment plan in phases, laid out from a final chart:
 *  1  initial therapy — oral hygiene instruction, then scaling and root planing, one item per quadrant that needs it
 *  2  re-evaluation
 *  3  surgical therapy — optional, proposed (the teeth that still have deep pockets after initial therapy)
 *  4  periodontal maintenance
 * Catalogue codes: hygiene_instruction, root_planing, scaling, perio_reevaluation, perio_flap_surgery, perio_maintenance.
 */
export interface PlanItem { catalog_code: string; phase: number; name: string; teeth?: number[]; notes?: string }
export interface PerioPlanInput { examDate: string; teeth: PerioTooth[]; dx?: DxLike | null; lang: "ar" | "en" }
export interface PerioPlan { title: string; notes: string; items: PlanItem[] }

const QUADRANTS: { q: number; ar: string; en: string }[] = [
  { q: 1, ar: "الربع العلوي الأيمن", en: "upper right quadrant" },
  { q: 2, ar: "الربع العلوي الأيسر", en: "upper left quadrant" },
  { q: 3, ar: "الربع السفلي الأيسر", en: "lower left quadrant" },
  { q: 4, ar: "الربع السفلي الأيمن", en: "lower right quadrant" },
];

/** a tooth needs root planing when a site is probed at 4 mm or more, or has lost 3 mm of attachment or more */
export function needsRootPlaning(t: PerioTooth): boolean {
  if (t.missing || t.implant) return false;
  const cal = calOf(t);
  return Boolean(t.pd?.some((v, i) => v !== null && v !== undefined && (v >= 4 || (cal?.[i] ?? 0) >= 3)));
}

export function buildPerioPlan(i: PerioPlanInput): PerioPlan {
  const ar = i.lang === "ar";
  const t = (a: string, e: string) => (ar ? a : e);
  const items: PlanItem[] = [{ catalog_code: "hygiene_instruction", phase: 1, name: t("تعليمات العناية بالفم وتنظيف الأسنان بالخيط والفرشاة", "Oral hygiene instruction"), notes: t("المرحلة الأولى: العلاج الأولي", "Phase 1: initial therapy") }];
  let any = false;
  for (const q of QUADRANTS) {
    const teeth = i.teeth.filter((x) => Math.floor(x.tooth / 10) === q.q && needsRootPlaning(x)).map((x) => x.tooth).sort((a, b) => a - b);
    if (!teeth.length) continue;
    any = true;
    items.push({ catalog_code: "root_planing", phase: 1, name: `${t("تنظيف عميق وتسوية الجذور", "Scaling & root planing")} — ${ar ? q.ar : q.en}`, teeth });
  }
  if (!any) items.push({ catalog_code: "scaling", phase: 1, name: t("تنظيف الجير وتلميع", "Scaling & polishing") });
  items.push({ catalog_code: "perio_reevaluation", phase: 2, name: t("إعادة تقييم اللثة", "Periodontal re-evaluation"), notes: t("بعد 4–6 أسابيع من العلاج الأولي: قياسات جديدة للجيوب", "4–6 weeks after initial therapy: new pocket measurements") });
  const deep = i.teeth.filter((x) => !x.missing && !x.implant && x.pd?.some((v) => (v ?? 0) >= 5)).map((x) => x.tooth).sort((a, b) => a - b);
  items.push({
    catalog_code: "perio_flap_surgery", phase: 3, name: t("جراحة لثوية (اختيارية)", "Periodontal surgery (optional)"), ...(deep.length ? { teeth: deep } : {}),
    notes: t("اختيارية: تُقرَّر بعد إعادة التقييم للجيوب التي بقيت بعمق 5 مم أو أكثر", "Optional: decided at re-evaluation for pockets that remain 5 mm or deeper"),
  });
  items.push({ catalog_code: "perio_maintenance", phase: 4, name: t("صيانة اللثة الدورية", "Periodontal maintenance"), notes: t("كل 3 أشهر تقريباً", "About every 3 months") });
  const dx = i.dx ? dxLine(i.dx, i.lang) : "";
  return {
    title: t(`خطة علاج اللثة — ${i.examDate}`, `Periodontal treatment plan — ${i.examDate}`),
    notes: t(`مبنية على مخطط اللثة بتاريخ ${i.examDate}`, `Based on the periodontal chart of ${i.examDate}`) + (dx ? ` — ${dx}` : ""),
    items,
  };
}
