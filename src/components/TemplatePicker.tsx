"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import type { Lang } from "@/lib/i18n";

/** Fills a note's text from a template (asks before replacing what was already typed). */
export function TemplatePicker({ target, templates, lang, manageHref }: {
  target: string; templates: { id: string; title: string; body: string; mine?: boolean }[]; lang: Lang; manageHref?: string;
}) {
  const t = (a: string, e: string) => (lang === "ar" ? a : e);
  const [value, setValue] = useState("");
  if (!templates.length) return null;
  const apply = (id: string) => {
    setValue(id);
    const tpl = templates.find((x) => x.id === id);
    const el = document.getElementById(target) as HTMLTextAreaElement | null;
    if (!tpl || !el) return;
    if (el.value.trim() && !window.confirm(t("استبدال النص الحالي بالقالب؟", "Replace the current text with the template?"))) { setValue(""); return; }
    el.value = tpl.body;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
  };
  const mine = templates.filter((x) => x.mine), shared = templates.filter((x) => !x.mine);
  return (
    <div className="field wide template-pick">
      <label htmlFor={`${target}-tpl`}><FileText size={14} aria-hidden="true" /> {t("استخدام قالب", "Use a template")}</label>
      <div className="row" style={{ gap: ".5rem" }}>
        <select id={`${target}-tpl`} value={value} onChange={(e) => apply(e.target.value)} style={{ flex: 1, minWidth: 200 }}>
          <option value="">{t("— بلا قالب —", "— no template —")}</option>
          {mine.length > 0 && <optgroup label={t("قوالبي", "My templates")}>{mine.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</optgroup>}
          {shared.length > 0 && <optgroup label={t("قوالب جاهزة", "Ready-made")}>{shared.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</optgroup>}
        </select>
        {manageHref && <a className="small" href={manageHref}>{t("إدارة قوالبي", "Manage my templates")}</a>}
      </div>
    </div>
  );
}
