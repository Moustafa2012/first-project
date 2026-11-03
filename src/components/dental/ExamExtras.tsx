import type { Lang } from "@/lib/i18n";
import { PULP_RESULTS, PULP_TESTS, pulpAbnormal, pulpLabel, summarizeSections, type PulpTest, type Sections } from "@/lib/dental-exam";

/** The parts of an exam beyond the teeth, as short lines: sections (what was not normal stands out) and pulp tests. */
export function ExamExtras({ sections, pulp, lang }: { sections?: Sections | null; pulp?: PulpTest[] | null; lang: Lang }) {
  const lines = summarizeSections(sections, lang);
  const tests = pulp ?? [];
  if (!lines.length && !tests.length) return null;
  const ar = lang === "ar";
  return (
    <dl className="exam-extras">
      {lines.map((l) => (
        <div key={l.key} className={l.flag ? "flag" : undefined}><dt>{l.title}</dt><dd>{l.text}</dd></div>
      ))}
      {tests.length > 0 && (
        <div><dt>{ar ? "حيوية العصب" : "Pulp tests"}</dt>
          <dd>{tests.map((x, i) => (
            <span key={i} className={pulpAbnormal(x.result) ? "pulp-abn" : undefined}>
              {i > 0 ? " · " : ""}<span className="ltr">{x.tooth}</span> {pulpLabel(PULP_TESTS, x.test, lang)}: {pulpLabel(PULP_RESULTS, x.result, lang)}{x.value ? ` (${x.value})` : ""}
            </span>
          ))}</dd></div>
      )}
    </dl>
  );
}
