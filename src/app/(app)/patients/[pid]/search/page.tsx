import Link from "next/link";
import { Search } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getPatient } from "@/lib/data";
import { getTz } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { Card, Chip, Empty, PageHead } from "@/components/ui";

export const metadata = { title: "بحث داخل الملف" };

interface Hit { table_name: string; record_id: string; title: string | null; snippet: string | null; happened_at: string | null; link_kind: string }

/** Where each kind of result lives, and what it is called. */
const KINDS: Record<string, [string, string, string]> = {
  conditions: ["الأمراض", "Condition", "conditions"], medications: ["الأدوية", "Medication", "medications"], allergies: ["الحساسية", "Allergy", "allergies"],
  visits: ["الزيارات", "Visit", "visits"], procedures: ["الإجراءات", "Procedure", "procedures"], notes: ["الملاحظات", "Note", "notes"],
  documents: ["المستندات", "Document", "documents"], vitals: ["القياسات", "Measurement", "vitals"], labs: ["التحاليل", "Lab result", "labs"],
  imaging: ["الأشعة", "Imaging", "imaging"], symptoms: ["الأعراض", "Symptom", "symptoms"],
};

/** The matched text in <mark>, found case-insensitively in the original (a match found only through letter-form folding stays unmarked). */
function marked(text: string, q: string) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

export default async function SearchPage({ params, searchParams }: { params: { pid: string }; searchParams: { q?: string } }) {
  const { lang, t } = i18n();
  const tz = getTz();
  const p = await getPatient(params.pid);
  const q = (searchParams.q ?? "").trim().slice(0, 100);
  const base = `/patients/${p.id}`;
  const tooShort = q.length > 0 && q.length < 2;
  let hits: Hit[] = [];
  let failed = false;
  if (q.length >= 2) {
    const { data, error } = await createClient().rpc("patient_search", { p_patient: p.id, p_q: q });
    if (error) failed = true; else hits = (data ?? []) as Hit[];
  }
  const href = (h: Hit) => (h.link_kind === "visits" ? `${base}/visits/${h.record_id}` : `${base}/${KINDS[h.link_kind]?.[2] ?? h.link_kind}`);

  return (
    <>
      <PageHead title={t("بحث داخل الملف", "Search this file")}
        sub={t("يبحث في الأمراض والأدوية والحساسية والزيارات والإجراءات والملاحظات والمستندات والتحاليل والأشعة والأعراض.", "Searches conditions, medications, allergies, visits, procedures, notes, documents, results, imaging and symptoms.")} />
      <form method="get" role="search" className="row search-form" style={{ marginBlockEnd: "1rem" }}>
        <input type="search" name="q" defaultValue={q} minLength={2} maxLength={100} autoComplete="off" aria-label={t("كلمة البحث", "Search words")}
          placeholder={t("اكتب كلمتين على الأقل… مثل: أموكسيسيلين، ضغط، صداع", "At least two characters… e.g. amoxicillin, pressure, headache")} style={{ flex: 1, minWidth: 220 }} />
        <button className="btn primary"><Search size={16} aria-hidden="true" />{t("بحث", "Search")}</button>
      </form>
      {tooShort && <p className="muted">{t("اكتب حرفين على الأقل.", "Type at least two characters.")}</p>}
      {failed && <p className="form-msg err" role="alert">{t("تعذّر البحث.", "The search could not run.")}</p>}
      {q.length >= 2 && !failed && (
        <Card title={t(`النتائج (${hits.length})`, `Results (${hits.length})`)}>
          {hits.length === 0 ? <Empty>{t("لا نتائج لهذه الكلمة في الملف.", "Nothing in this file matches.")}</Empty> : (
            <ol className="search-hits">
              {hits.map((h) => {
                const k = KINDS[h.link_kind];
                return (
                  <li key={`${h.table_name}-${h.record_id}`} className="rec">
                    <div className="row between">
                      <div className="row" style={{ gap: ".4rem" }}>
                        <Link href={href(h)} className="rec-title">{marked(h.title || "—", q)}</Link>
                        <Chip tone="muted">{k ? t(k[0], k[1]) : h.link_kind}</Chip>
                      </div>
                      {h.happened_at && <span className="muted small nowrap">{fmtDate(h.happened_at, lang, tz)}</span>}
                    </div>
                    {h.snippet && <p className="rec-body small">{marked(h.snippet, q)}</p>}
                  </li>
                );
              })}
            </ol>
          )}
          <p className="small muted" style={{ marginBlockStart: ".6rem" }}>{t("تظهر السجلات النشطة فقط (من الأحدث)، وبحد أقصى 15 نتيجة لكل نوع.", "Only active records are searched, newest first, up to 15 results per kind.")}</p>
        </Card>
      )}
    </>
  );
}
