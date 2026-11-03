import Link from "next/link";
import { Printer } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { fmtPartialDate } from "@/lib/format";
import { IMAGING_MODALITY, RECALL_KIND, lbl } from "@/lib/labels";
import { PULP_RESULTS, PULP_TESTS, pulpLabel } from "@/lib/dental-exam";
import { summarizeBoneLevels } from "@/lib/dental-imaging";
import { worstBoneText, type DentalSummary as Summary, type SummaryItem } from "@/lib/dental-summary";
import { dxLine } from "@/lib/perio-staging";
import { ITEM_STATUS } from "@/lib/treatment";
import { Card, Chip } from "@/components/ui";

/** Where each part of the summary can be read in full (a link is left out when the place does not exist on the page). */
export interface SummaryLinks {
  exam?: (id: string) => string; chart?: string; perio?: string; imaging?: string; treatment?: string; recalls?: string;
  /** the "Dental summary" PDF */
  pdf?: string;
}

const Teeth = ({ list }: { list: number[] }) => <span className="ltr">{list.join(", ")}</span>;

/**
 * The dental summary card: the whole condition of the mouth at a glance, for the patient's page and the doctor's link
 * (same facts, from buildDentalSummary). Every figure has a link to the place it comes from.
 */
export function DentalSummary({ s, lang, tz, links = {}, id = "dental-summary", idPrefix = "" }: { s: Summary; lang: Lang; tz?: string; links?: SummaryLinks; id?: string; idPrefix?: string }) {
  const ar = lang === "ar";
  const t = (a: string, e: string) => (ar ? a : e);
  const day = (v: string | null | undefined, prec?: string | null) => fmtPartialDate(v ?? "", prec ?? "day", lang, tz);
  const link = (href: string | undefined, text: string) => (href ? <Link href={href} className="dsum-more">{text}</Link> : null);
  const itemLine = (i: SummaryItem) => (
    <li key={i.id}>{i.teeth.length > 0 && <><Teeth list={i.teeth} />{" — "}</>}{i.name}
      {i.status !== "accepted" && i.status !== "proposed" && i.status !== "completed" ? <span className="muted small"> · {lbl(ITEM_STATUS, i.status, lang)}{i.scheduled_for ? ` ${day(i.scheduled_for)}` : ""}</span> : null}
      {i.completed_on ? <span className="muted small"> · {day(i.completed_on)}</span> : null}</li>
  );
  const itemList = (items: SummaryItem[], max = 6) => (
    <ul className="dsum-list">{items.slice(0, max).map(itemLine)}{items.length > max && <li className="muted small">{t(`و${items.length - max} أخرى`, `and ${items.length - max} more`)}</li>}</ul>
  );
  const tile = (key: string, title: string, children: React.ReactNode, more?: React.ReactNode) => (
    <div className={`dsum-tile${key === "soft-tissue" && s.softTissue ? " alert" : ""}`} data-sum={key} id={idPrefix ? `${idPrefix}-${key}` : undefined}>
      <h3>{title}</h3>
      {children}
      {more}
    </div>
  );
  const none = (text: string) => <p className="muted small">{text}</p>;

  const c = s.chart;
  const p = s.perio;
  const im = s.image;
  const tr = s.treatment;

  return (
    <Card id={id} title={t("ملخص الأسنان", "Dental summary")}
      description={t("الصورة الكاملة لحالة الفم والأسنان في مكان واحد، من سجلات هذا الملف.", "The whole condition of the mouth and teeth in one place, from the records of this file.")}
      actions={links.pdf ? <a className="btn sm" href={links.pdf} target="_blank" rel="noreferrer"><Printer size={14} aria-hidden="true" />{t("ملخص الأسنان (PDF)", "Dental summary (PDF)")}</a> : undefined}>
      {s.empty && <p className="muted small" data-sum="empty">{t("لا يوجد في الملف السني ما يُلخَّص بعد.", "The dental file has nothing to summarise yet.")}</p>}
      <div className="dsum-grid">
        {tile("chart", t("حالة المخطط الحالية", "Current chart"), c.examined === 0 && c.openFindings === 0 ? none(t("لا فحص مسجل بعد.", "No exam recorded yet.")) : (
          <dl className="dsum-kv">
            <dt>{t("مفقودة", "Missing")}</dt><dd><strong data-sum-n="missing">{c.missing.length}</strong>{c.missing.length > 0 && <> <Teeth list={c.missing} /></>}</dd>
            <dt>{t("مرمَّمة", "Restored")}</dt><dd><strong data-sum-n="restored">{c.restored.length}</strong>{c.restored.length > 0 && <> <Teeth list={c.restored} /></>}</dd>
            <dt>{t("زرعات", "Implants")}</dt><dd><strong data-sum-n="implants">{c.implants.length}</strong>{c.implants.length > 0 && <> <Teeth list={c.implants} /></>}</dd>
            <dt>{t("موجودات مفتوحة", "Open findings")}</dt><dd><strong data-sum-n="open">{c.open.length}</strong>{c.open.length > 0 && <> <Teeth list={c.open} /></>}</dd>
          </dl>
        ), link(links.chart, t("المخطط", "Chart")))}

        {tile("baseline", t("الفحص الأساسي", "Baseline exam"), s.baseline
          ? <p>{day(s.baseline.exam_date)}{s.baseline.examiner_name ? ` — ${s.baseline.examiner_name}` : ""}</p>
          : none(t("لا فحص أساسي شامل بعد.", "No comprehensive baseline exam yet.")),
          s.baseline && links.exam ? link(links.exam(s.baseline.id), t("عرض الفحص", "See the exam")) : null)}

        {tile("soft-tissue", t("الأنسجة الرخوة (فحص السرطان)", "Soft tissue (cancer screening)"), s.softTissue ? (<>
          <p><Chip tone="bad">{t("آفة مشتبهة ما زالت مفتوحة", "Suspicious lesion still open")}</Chip></p>
          <p className="small">
            {t(`سُجّلت في فحص ${day(s.softTissue.exam_date)}`, `Recorded at the exam of ${day(s.softTissue.exam_date)}`)}{s.softTissue.examiner_name ? ` (${s.softTissue.examiner_name})` : ""}
            {s.softTissue.note ? ` — ${s.softTissue.note}` : ""}. {t("تحتاج متابعة أو تحويلاً لأخصائي.", "It needs follow-up or a specialist.")}
          </p>
        </>) : none(t("لا آفة مشتبهة مفتوحة مسجلة.", "No open suspicious lesion recorded.")),
          s.softTissue && links.exam ? link(links.exam(s.softTissue.id), t("عرض الفحص", "See the exam")) : null)}

        {tile("perio", t("اللثة (آخر مخطط معتمد)", "Gums (latest final chart)"), !p ? none(t("لا مخطط لثة معتمد.", "No final periodontal chart.")) : (<>
          <p><strong>{day(p.exam_date)}</strong>{p.examiner_name ? ` — ${p.examiner_name}` : ""}</p>
          {dxLine({ dx_kind: p.dx_kind, dx_stage: p.dx_stage, dx_grade: p.dx_grade, dx_extent: p.dx_extent }, lang)
            ? <p data-sum="perio-dx"><strong>{dxLine({ dx_kind: p.dx_kind, dx_stage: p.dx_stage, dx_grade: p.dx_grade, dx_extent: p.dx_extent }, lang)}</strong></p>
            : none(t("لم يُسجَّل تشخيص لثوي.", "No periodontal diagnosis recorded."))}
          <p className="small muted">
            {p.stats.bopPct !== null && <>{t("نزف عند السبر", "Bleeding")} <span className="ltr">{p.stats.bopPct}%</span> · </>}
            {p.stats.meanPd !== null && <>{t("متوسط العمق", "Mean depth")} <span className="ltr">{p.stats.meanPd} {t("مم", "mm")}</span> · </>}
            {t("جيوب 6 مم فأكثر", "Pockets 6 mm or more")} <span className="ltr">{p.stats.pd6}</span>
          </p>
          {p.change ? (
            <p className="small" data-sum="perio-change">
              <Chip tone={p.change.direction === "worse" ? "bad" : p.change.direction === "better" ? "ok" : "muted"}>
                {p.change.direction === "worse" ? t("أسوأ", "Worse") : p.change.direction === "better" ? t("أفضل", "Better") : t("مستقر", "Stable")}
              </Chip>{" "}
              {t(`مقارنة بمخطط ${day(p.change.previous_date)}: ازداد فقد الارتباط في ${p.change.worse} من المواقع وتحسّن في ${p.change.better}`,
                `Against the chart of ${day(p.change.previous_date)}: attachment worsened at ${p.change.worse} ${p.change.worse === 1 ? "site" : "sites"}, improved at ${p.change.better}`)}
              {p.change.lost.length > 0 && <>{t("، وأسنان فُقدت: ", "; teeth lost: ")}<Teeth list={p.change.lost} /></>}
              {p.change.bop[0] !== null && p.change.bop[1] !== null && <>{t("، النزف ", "; bleeding ")}<span className="ltr">{p.change.bop[0]}% / {p.change.bop[1]}%</span></>}
            </p>
          ) : <p className="small muted">{t("لا مخطط سابق للمقارنة.", "No earlier chart to compare with.")}</p>}
        </>), link(links.perio, t("مخطط اللثة", "Periodontal chart")))}

        {tile("pulp", t("اختبارات حيوية العصب غير الطبيعية", "Abnormal pulp tests"), s.pulp.length === 0 ? none(t("لا نتائج غير طبيعية.", "No abnormal results.")) : (
          <ul className="dsum-list">{s.pulp.map((x) => (
            <li key={`${x.tooth}-${x.test}`}><span className="ltr">{x.tooth}</span> {pulpLabel(PULP_TESTS, x.test, lang)}: {pulpLabel(PULP_RESULTS, x.result, lang)}
              <span className="muted small"> · {day(x.exam_date)}</span></li>
          ))}</ul>
        ))}

        {tile("image", t("آخر صورة للفم كاملاً", "Latest whole-mouth image"), !im ? none(t("لا صورة بانوراما أو CBCT أو سيفالومترية.", "No panoramic, CBCT or cephalometric image.")) : (<>
          <p><strong>{lbl(IMAGING_MODALITY, im.modality, lang)}</strong>{im.performed_on ? ` — ${day(im.performed_on, im.date_precision)}` : ""}</p>
          {im.bone && Object.keys(im.bone).length > 0 ? (
            <p className="small" data-sum="bone"><strong>{t("قراءة العظم", "Bone reading")}:</strong> {summarizeBoneLevels(im.bone, lang)}
              {im.worst ? <span className="muted"> · {t("الأشد", "Worst")}: {worstBoneText(im.worst, lang)}</span> : null}</p>
          ) : none(t("لا قراءة منظَّمة للعظم.", "No structured bone reading."))}
          {im.impression && <p className="small">{im.impression}</p>}
        </>), link(links.imaging, t("الصور", "Images")))}

        {tile("treatment", t("العلاج", "Treatment"), (
          tr.proposed.length + tr.accepted.length + tr.completed.length === 0 ? none(t("لا علاج مقترح أو منجز.", "No treatment proposed or done.")) : (<>
            <p className="small"><strong>{t("مقترح", "Proposed")} (<span data-sum-n="proposed">{tr.proposed.length}</span>)</strong></p>
            {tr.proposed.length ? itemList(tr.proposed) : none("—")}
            <p className="small"><strong>{t("موافَق عليه / مجدول / قيد التنفيذ", "Accepted / scheduled / in progress")} (<span data-sum-n="accepted">{tr.accepted.length}</span>)</strong></p>
            {tr.accepted.length ? itemList(tr.accepted) : none("—")}
            <p className="small"><strong>{t("منجز خلال 12 شهراً", "Completed in the last 12 months")} (<span data-sum-n="completed">{tr.completed.length}</span>)</strong></p>
            {tr.completed.length ? itemList(tr.completed) : none("—")}
          </>)
        ), link(links.treatment, t("خطط العلاج", "Treatment plans")))}

        {tile("safety", t("تنبيهات السلامة", "Safety alerts"), s.safety.length === 0 ? none(t("لا تنبيهات فعّالة.", "No active alerts.")) : (
          <ul className="dsum-list">{s.safety.map((a) => (
            <li key={a.code}><Chip tone={a.severity === "danger" ? "bad" : a.severity === "warn" ? "warn" : "info"}>{ar ? a.title_ar : a.title_en}</Chip></li>
          ))}</ul>
        ))}

        {tile("recall", t("الفحص الدوري القادم", "Next recall"), !s.recall ? none(t("لا فحص دوري فعّال.", "No active recall.")) : (
          <p><strong>{s.recall.kind === "other" ? s.recall.label : lbl(RECALL_KIND, s.recall.kind, lang)}</strong> — {day(s.recall.due_on)}{" "}
            {s.recall.state === "overdue" ? <Chip tone="bad">{t("متأخر", "Overdue")}</Chip> : s.recall.state === "due_soon" ? <Chip tone="warn">{t("خلال 30 يوماً", "Within 30 days")}</Chip> : null}
            <span className="muted small"> · {t(`كل ${s.recall.interval_months} أشهر`, `every ${s.recall.interval_months} months`)}</span></p>
        ), link(links.recalls, t("الفحص الدوري", "Recalls")))}
      </div>
    </Card>
  );
}
