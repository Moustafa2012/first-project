import Link from "next/link";
import { CircleCheck, Trash2 } from "lucide-react";
import { i18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getPatient } from "@/lib/data";
import { ALLERGY_ASSERTION, ABO, ACTIVITY_LEVEL, ALCOHOL_STATUS, DIET_PATTERN, LIVING_SITUATION, PREGNANCY_STATUS, RH, SEX, SLEEP_QUALITY, SUBSTANCE_STATUS, SUBSTANCE_TYPE, TOBACCO_STATUS, TOBACCO_TYPE, type Opt } from "@/lib/labels";
import { ENTITIES } from "@/lib/entities";
import { getTz } from "@/lib/auth";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { getClinicalContext } from "@/lib/clinical-context-server";
import { bodyMetrics, coreGaps } from "@/lib/clinical-context";
import { EntitySection } from "@/components/EntitySection";
import { saveBody, saveHealthProfile, setAllergyAssertion, setNoneAssertion } from "@/app/actions/core";
import { Card, Chip, Empty, PageHead } from "@/components/ui";
import { PhotoForm } from "@/components/PhotoForm";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { deleteSimple, saveSimple, updatePatient } from "@/app/actions/patients";

const ID_TYPES: [string, string, string][] = [["national_id", "هوية وطنية", "National ID"], ["residency", "إقامة", "Residency"], ["passport", "جواز سفر", "Passport"], ["other", "أخرى", "Other"]];

export default async function ProfilePage({ params, searchParams }: { params: { pid: string }; searchParams: { photo?: string; error?: string; new?: string } }) {
  const { lang, t } = i18n();
  const p = await getPatient(params.pid);
  const [access, ctx] = await Promise.all([getAccess(p.id), getClinicalContext(params.pid)]);
  const tz = getTz();
  const supabase = createClient();
  const [{ data: contacts }, { data: insurance }, { data: ids }] = await Promise.all([
    supabase.from("emergency_contacts").select("*").eq("patient_id", p.id).order("created_at"),
    supabase.from("patient_insurance").select("*").eq("patient_id", p.id).order("created_at"),
    access.canManage ? supabase.from("patient_identifiers").select("id, id_type, id_value").eq("patient_id", p.id) : Promise.resolve({ data: [] as { id: string; id_type: string; id_value: string }[] }),
  ]);
  const ro = !access.canWrite;
  const base = `/patients/${p.id}/profile`;
  const gaps = coreGaps(ctx);
  const life = ctx.lifestyle;
  const { cm, kg } = bodyMetrics(ctx.body);
  const male = p.sex === "male";
  const sel = (name: string, label: string, opts: Opt[], value: string | null | undefined, blank = false) => (
    <div className="field"><label htmlFor={`hp_${name}`}>{label}</label>
      <select id={`hp_${name}`} name={name} defaultValue={value ?? ""}>{blank && <option value="">—</option>}{opts.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
  );
  const noneForm = (field: string, label: string, on: boolean | undefined) => ro ? <p className="muted small">{on ? label : t("غير مسجل بعد (لا يعني عدم الوجود).", "Not recorded yet (not the same as none).")}</p> : (
    <ActionForm action={setNoneAssertion} className="row none-form" resetOnSuccess={false}>
      <input type="hidden" name="_pid" value={p.id} /><input type="hidden" name="_field" value={field} />
      <label className="check"><input type="checkbox" name="value" defaultChecked={Boolean(on)} />{label}</label>
      <SubmitButton className="btn sm">{t("حفظ", "Save")}</SubmitButton>
      {!on && <span className="small muted">{t("القائمة الفارغة لا تعني «لا شيء» حتى تؤكد ذلك.", "An empty list does not mean “none” until you confirm it.")}</span>}
    </ActionForm>
  );
  const mask = (v: string) => (v.length <= 4 ? "••••" : "•".repeat(v.length - 4) + v.slice(-4));
  return (
    <>
      <PageHead title={t("الملف الأساسي", "Core file")} sub={t("ما يحتاجه كل قسم عن المريض، يُدخل مرة واحدة هنا ويظهر تلقائياً في الأقسام وعند الطبيب وفي التقارير. الهوية الوطنية ورقم الجواز لا تُشارك أبداً.",
        "What every section needs to know about the patient: entered once here, it appears automatically in every section, for the doctor and in reports. National ID and passport numbers are never shared.")} />
      <section className="card core-status" id="completeness" aria-label={t("اكتمال الملف الأساسي", "Core file completeness")}>
        {searchParams.new === "1" && <p className="banner info" role="note">{t("أُنشئ الملف. أكمل الملف الأساسي الآن: يكفي ما تعرفه، ويمكن الإكمال لاحقاً.", "The file was created. Complete the core file now: what you know is enough, the rest can come later.")}</p>}
        {gaps.length === 0
          ? <p className="row"><CircleCheck size={18} aria-hidden="true" className="ok-text" /> <strong>{t("الملف الأساسي مكتمل.", "The core file is complete.")}</strong></p>
          : <p>{t(`ينقص ${gaps.length} من بنود الملف الأساسي:`, `${gaps.length} core items are missing:`)}{" "}
              {gaps.map((g, i) => <span key={g.key}>{i > 0 && "، "}<a href={`#${g.anchor}`}>{t(g.ar, g.en)}</a></span>)}</p>}
        <nav className="core-toc" aria-label={t("أقسام الملف الأساسي", "Core file sections")}>
          {[["identity", "الهوية والدم", "Identity & blood"], ["body", "الطول والوزن", "Height & weight"], ["allergies", "الحساسية", "Allergies"], ["conditions", "الأمراض المزمنة", "Chronic conditions"],
            ["medications", "الأدوية الدائمة", "Long-term medications"], ["devices", "الأجهزة والزرعات", "Devices & implants"], ["lifestyle", male ? "نمط الحياة" : "نمط الحياة والحمل", male ? "Lifestyle" : "Lifestyle & pregnancy"],
            ["contacts", "جهات الطوارئ", "Emergency contacts"]].map(([a, ar, en]) => <a key={a} href={`#${a}`} className="chip muted">{t(ar, en)}</a>)}
        </nav>
      </section>
      <Card title={t("صورة الملف", "File picture")}>
        <PhotoForm target="patient" pid={p.id} name={p.full_name} src={p.photo_path ? `/api/avatar?p=${p.id}&v=${encodeURIComponent(p.updated_at)}` : null} returnTo={`/patients/${p.id}/profile`} status={searchParams} canEdit={!ro} />
      </Card>
      <Card id="identity" title={t("الهوية وفصيلة الدم والتواصل", "Identity, blood group & contact")}>
        <ActionForm action={updatePatient} className="stack" resetOnSuccess={false}>
          <input type="hidden" name="_pid" value={p.id} />
          <fieldset disabled={ro} style={{ border: 0, padding: 0 }}>
            <div className="form-grid">
              <div className="field"><label htmlFor="full_name">{t("الاسم الكامل", "Full name")}</label><input id="full_name" name="full_name" defaultValue={p.full_name} required maxLength={200} /></div>
              <div className="field"><label htmlFor="full_name_en">{t("الاسم بالإنجليزية", "Name in English")}</label><input id="full_name_en" name="full_name_en" dir="ltr" defaultValue={p.full_name_en ?? ""} maxLength={200} /></div>
              <div className="field"><label htmlFor="date_of_birth">{t("تاريخ الميلاد", "Date of birth")}</label><input id="date_of_birth" name="date_of_birth" type="date" defaultValue={p.date_of_birth} required /></div>
              <div className="field"><label htmlFor="sex">{t("الجنس", "Sex")}</label><select id="sex" name="sex" defaultValue={p.sex}>{SEX.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
              <div className="field"><label htmlFor="nationality">{t("الجنسية", "Nationality")}</label><input id="nationality" name="nationality" defaultValue={p.nationality ?? ""} maxLength={80} /></div>
              <div className="field"><label htmlFor="blood_abo">{t("فصيلة الدم", "Blood group")}</label><select id="blood_abo" name="blood_abo" defaultValue={p.blood_abo ?? ""}><option value="">—</option>{ABO.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
              <div className="field"><label htmlFor="blood_rh">{t("عامل Rh", "Rh factor")}</label><select id="blood_rh" name="blood_rh" defaultValue={p.blood_rh ?? ""}><option value="">—</option>{RH.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select></div>
              <div className="field"><label className="check" style={{ marginBlockStart: "1.7rem" }}><input type="checkbox" name="blood_group_verified" defaultChecked={p.blood_group_verified} />{t("فصيلة الدم موثقة بتحليل", "Blood group confirmed by a lab test")}</label></div>
              <div className="field"><label htmlFor="phone">{t("الهاتف", "Phone")}</label><input id="phone" name="phone" type="tel" dir="ltr" defaultValue={p.phone ?? ""} maxLength={40} /></div>
              <div className="field"><label htmlFor="email">{t("البريد", "Email")}</label><input id="email" name="email" type="email" dir="ltr" defaultValue={p.email ?? ""} maxLength={200} /></div>
              <div className="field wide"><label htmlFor="address_line">{t("العنوان", "Address")}</label><input id="address_line" name="address_line" defaultValue={p.address_line ?? ""} maxLength={300} /></div>
              <div className="field"><label htmlFor="city">{t("المدينة", "City")}</label><input id="city" name="city" defaultValue={p.city ?? ""} maxLength={100} /></div>
              <div className="field"><label htmlFor="country">{t("الدولة", "Country")}</label><input id="country" name="country" defaultValue={p.country ?? ""} maxLength={100} /></div>
            </div>
          </fieldset>
          {!ro && <div><SubmitButton>{t("حفظ", "Save")}</SubmitButton></div>}
        </ActionForm>
      </Card>

      <Card id="body" title={t("الطول والوزن", "Height & weight")}>
        <p>{cm ? <>{t("الطول", "Height")}: <strong className="ltr">{fmtNum(cm, 0)} cm</strong> <span className="small muted">({fmtDateTime(ctx.body?.height?.at, lang, tz)})</span></> : <span className="warn-text">{t("الطول غير مسجل.", "Height not recorded.")}</span>}
          {" · "}{kg ? <>{t("الوزن", "Weight")}: <strong className="ltr">{fmtNum(kg, 1)} kg</strong> <span className="small muted">({fmtDateTime(ctx.body?.weight?.at, lang, tz)})</span></> : <span className="warn-text">{t("الوزن غير مسجل.", "Weight not recorded.")}</span>}</p>
        {!ro && (
          <ActionForm action={saveBody} className="stack">
            <input type="hidden" name="_pid" value={p.id} />
            <div className="form-grid">
              <div className="field"><label htmlFor="height_cm">{t("الطول (سم)", "Height (cm)")}</label><input id="height_cm" name="height_cm" inputMode="decimal" dir="ltr" placeholder="170" /></div>
              <div className="field"><label htmlFor="weight_kg">{t("الوزن (كغ)", "Weight (kg)")}</label><input id="weight_kg" name="weight_kg" inputMode="decimal" dir="ltr" placeholder="70" /></div>
            </div>
            <p className="hint">{t("يُحفظ كقراءة جديدة في «القياسات» بتاريخ اليوم، فيبقى تاريخ الوزن كاملاً ويُحسب BMI تلقائياً.", "Saved as a new reading under “Vitals” dated today, so the weight history stays complete and BMI is calculated automatically.")}</p>
            <div className="row"><SubmitButton>{t("حفظ", "Save")}</SubmitButton><Link className="small" href={`/patients/${p.id}/vitals`}>{t("كل القراءات", "All readings")}</Link></div>
          </ActionForm>
        )}
      </Card>

      <section className="card" id="allergies" aria-label={t("حالة الحساسية", "Allergy status")}>
        <div className="card-head"><h2>{t("الحساسية", "Allergies")}</h2></div>
        <ActionForm action={setAllergyAssertion} className="row" resetOnSuccess={false}>
          <input type="hidden" name="_pid" value={p.id} />
          <label htmlFor="allergy_assertion" className="label-like">{t("هل لدى المريض حساسية؟", "Does the patient have allergies?")}</label>
          <select id="allergy_assertion" name="allergy_assertion" defaultValue={p.allergy_assertion} disabled={ro}>{ALLERGY_ASSERTION.map((o) => <option key={o.value} value={o.value}>{o[lang]}</option>)}</select>
          {!ro && <SubmitButton className="btn sm">{t("حفظ", "Save")}</SubmitButton>}
        </ActionForm>
        <p className="hint">{t("غياب سجلات الحساسية لا يعني عدم وجودها؛ اختر «لا توجد حساسية معروفة» فقط بعد التأكد.", "No allergy entries is not the same as no allergies; choose “No known allergies” only once you are sure.")}</p>
      </section>
      <EntitySection entity={ENTITIES.allergies} pid={p.id} returnPath={base} title={t("قائمة الحساسية", "Allergy list")} compact addLabel={t("إضافة حساسية", "Add an allergy")} />
      <EntitySection entity={ENTITIES.conditions} pid={p.id} returnPath={base} id="conditions" compact
        title={t("الأمراض المزمنة والخلقية والإعاقات", "Chronic & congenital conditions, disabilities")} addLabel={t("إضافة مرض مزمن", "Add a chronic condition")}
        filter={{ category: ["chronic", "congenital", "genetic", "disability"] }} defaults={{ category: "chronic" }}
        context={{ options: { category: ["chronic", "congenital", "genetic", "disability"] } }}
        empty={noneForm("none_chronic_conditions", t("لا توجد أمراض مزمنة معروفة", "No known chronic conditions"), life?.none_chronic_conditions)} />
      <EntitySection entity={ENTITIES.medications} pid={p.id} returnPath={base} id="medications" compact
        title={t("الأدوية الدائمة", "Long-term medications")} addLabel={t("إضافة دواء دائم", "Add a long-term medication")}
        filter={{ long_term: true }} defaults={{ status: "active" }} context={{ fixed: { long_term: "on" } }}
        empty={noneForm("none_long_term_medications", t("لا يتناول أدوية دائمة", "Takes no long-term medications"), life?.none_long_term_medications)} />
      <EntitySection entity={ENTITIES.devices} pid={p.id} returnPath={base} id="devices" compact
        title={t("الأجهزة والزرعات", "Devices & implants")} addLabel={t("إضافة جهاز أو زرعة", "Add a device or implant")}
        empty={noneForm("none_devices", t("لا أجهزة ولا زرعات", "No devices or implants"), life?.none_devices)} />

      <Card id="lifestyle" title={male ? t("نمط الحياة", "Lifestyle") : t("نمط الحياة والحمل", "Lifestyle & pregnancy")}>
        <ActionForm action={saveHealthProfile} className="stack" resetOnSuccess={false}>
          <input type="hidden" name="_pid" value={p.id} />
          <fieldset disabled={ro} style={{ border: 0, padding: 0 }}>
            <h3>{t("التدخين", "Tobacco")}</h3>
            <div className="form-grid">
              {sel("tobacco_status", t("الحالة", "Status"), TOBACCO_STATUS, life?.tobacco_status ?? "unknown")}
              <div className="field"><label htmlFor="hp_cpd">{t("سجائر في اليوم", "Cigarettes per day")}</label><input id="hp_cpd" name="cigarettes_per_day" inputMode="decimal" dir="ltr" defaultValue={life?.cigarettes_per_day ?? ""} /></div>
              <div className="field"><label htmlFor="hp_wpw">{t("أرجيلة في الأسبوع", "Waterpipes per week")}</label><input id="hp_wpw" name="waterpipe_per_week" inputMode="decimal" dir="ltr" defaultValue={life?.waterpipe_per_week ?? ""} /></div>
              <div className="field"><label htmlFor="hp_start">{t("سنة البدء", "Start year")}</label><input id="hp_start" name="tobacco_start_year" inputMode="numeric" dir="ltr" defaultValue={life?.tobacco_start_year ?? ""} /></div>
              <div className="field"><label htmlFor="hp_quit">{t("سنة الإقلاع (للمدخن السابق)", "Quit year (former smokers)")}</label><input id="hp_quit" name="tobacco_quit_year" inputMode="numeric" dir="ltr" defaultValue={life?.tobacco_quit_year ?? ""} /></div>
              <fieldset className="field wide surf-pick"><legend>{t("النوع", "Kind")}</legend>
                {TOBACCO_TYPE.map((o) => <label key={o.value} className="pill"><input type="checkbox" name="tobacco_types" value={o.value} defaultChecked={life?.tobacco_types?.includes(o.value)} />{o[lang]}</label>)}
              </fieldset>
            </div>
            <p className="hint">{t("تُحسب «علبة-سنة» تلقائياً من عدد السجائر وسنوات التدخين. الكميات تُحفظ للمدخن الحالي أو السابق فقط.", "Pack-years are calculated automatically from cigarettes and years smoked. Amounts are kept only for current or former smokers.")}</p>
            <h3>{t("الكحول والنشاط والعمل", "Alcohol, activity & work")}</h3>
            <div className="form-grid">
              {sel("alcohol_status", t("الكحول", "Alcohol"), ALCOHOL_STATUS, life?.alcohol_status ?? "unknown")}
              <div className="field"><label htmlFor="hp_units">{t("وحدات في الأسبوع", "Units per week")}</label><input id="hp_units" name="alcohol_units_per_week" inputMode="decimal" dir="ltr" defaultValue={(life as { alcohol_units_per_week?: number } | null)?.alcohol_units_per_week ?? ""} /></div>
              {sel("activity_level", t("النشاط البدني", "Physical activity"), ACTIVITY_LEVEL, life?.activity_level, true)}
              <div className="field"><label htmlFor="hp_occ">{t("المهنة", "Occupation")}</label><input id="hp_occ" name="occupation" maxLength={200} defaultValue={(life as { occupation?: string } | null)?.occupation ?? ""} /></div>
              {(life as { exposures?: string } | null)?.exposures ? (
                <div className="field wide"><label htmlFor="hp_exp">{t("تعرضات (ملاحظة قديمة — استخدم قائمة التعرضات أدناه)", "Exposures (old note — use the exposure list below)")}</label><input id="hp_exp" name="exposures" maxLength={1000} defaultValue={(life as { exposures?: string }).exposures ?? ""} /></div>
              ) : null}
              <div className="field wide"><label htmlFor="hp_diet">{t("النظام الغذائي (تفاصيل)", "Diet (details)")}</label><input id="hp_diet" name="diet" maxLength={500} defaultValue={(life as { diet?: string } | null)?.diet ?? ""} /></div>
            </div>
            <h3>{t("النشاط البدني الأسبوعي", "Weekly physical activity")}</h3>
            <div className="form-grid">
              <div className="field"><label htmlFor="hp_actmin">{t("دقائق النشاط في الأسبوع", "Minutes of activity per week")}</label><input id="hp_actmin" name="activity_minutes_per_week" inputMode="numeric" dir="ltr" defaultValue={life?.activity_minutes_per_week ?? ""} /></div>
              <div className="field"><label htmlFor="hp_actdays">{t("أيام النشاط في الأسبوع", "Active days per week")}</label><input id="hp_actdays" name="activity_days_per_week" inputMode="numeric" dir="ltr" defaultValue={life?.activity_days_per_week ?? ""} /></div>
            </div>
            <p className="hint">{t("المعتاد للبالغين نحو 150 دقيقة أسبوعياً من نشاط متوسط. للعلم فقط وليس حكماً على الحالة.", "A common adult guide is about 150 minutes a week of moderate activity. For information only, not a judgement.")}</p>
            <h3>{t("الغذاء والنوم والسكن", "Diet, sleep & living situation")}</h3>
            <div className="form-grid">
              {sel("diet_pattern", t("النمط الغذائي", "Diet pattern"), DIET_PATTERN, life?.diet_pattern ?? undefined, true)}
              <div className="field"><label htmlFor="hp_sleep">{t("ساعات النوم في الليلة", "Hours of sleep per night")}</label><input id="hp_sleep" name="sleep_hours" inputMode="decimal" dir="ltr" defaultValue={life?.sleep_hours ?? ""} /></div>
              {sel("sleep_quality", t("جودة النوم", "Sleep quality"), SLEEP_QUALITY, life?.sleep_quality ?? undefined, true)}
              {sel("living_situation", t("السكن", "Living situation"), LIVING_SITUATION, life?.living_situation ?? undefined, true)}
            </div>
            <h3>{t("مواد أخرى (حساسة — لا تُشارك ولا تُطبع)", "Other substances (sensitive — never shared or printed)")}</h3>
            <div className="form-grid">
              {sel("substance_use_status", t("التعاطي", "Use"), SUBSTANCE_STATUS, life?.substance_use_status ?? "unknown")}
              <fieldset className="field wide surf-pick"><legend>{t("النوع", "Kind")}</legend>
                {SUBSTANCE_TYPE.map((o) => <label key={o.value} className="pill"><input type="checkbox" name="substance_types" value={o.value} defaultChecked={life?.substance_types?.includes(o.value)} />{o[lang]}</label>)}
              </fieldset>
              <div className="field wide"><label htmlFor="hp_subnotes">{t("ملاحظات", "Notes")}</label><input id="hp_subnotes" name="substance_notes" maxLength={500} defaultValue={(life as { substance_notes?: string } | null)?.substance_notes ?? ""} /></div>
            </div>
            <p className="hint">{t("يُحفظ النوع والملاحظات للمتعاطي الحالي أو السابق فقط. لا يدخل في المشاركة مع الأطباء ولا في تقرير PDF.", "Kind and notes are kept for current or former use only. They are not part of shares with doctors or of the PDF report.")}</p>
            {!male && (<>
              <h3>{t("الحمل والإرضاع", "Pregnancy & breastfeeding")}</h3>
              <div className="form-grid">
                {sel("pregnancy_status", t("الحمل", "Pregnancy"), PREGNANCY_STATUS, life?.pregnancy_status ?? "unknown")}
                <div className="field"><label htmlFor="hp_edd">{t("موعد الولادة المتوقع", "Expected due date")}</label><input id="hp_edd" name="pregnancy_edd" type="date" defaultValue={life?.pregnancy_edd ?? ""} /></div>
                <div className="field"><label htmlFor="hp_bf">{t("الإرضاع", "Breastfeeding")}</label>
                  <select id="hp_bf" name="breastfeeding" defaultValue={life?.breastfeeding === true ? "yes" : life?.breastfeeding === false ? "no" : ""}>
                    <option value="">{t("غير محدد", "Not stated")}</option><option value="yes">{t("ترضع حالياً", "Currently breastfeeding")}</option><option value="no">{t("لا", "No")}</option></select></div>
              </div>
            </>)}
          </fieldset>
          {!ro && <div><SubmitButton>{t("حفظ", "Save")}</SubmitButton></div>}
        </ActionForm>
      </Card>

      <EntitySection entity={ENTITIES.exposures} pid={p.id} returnPath={base} id="exposures" compact
        title={t("التعرضات المهنية والبيئية", "Occupational & environmental exposures")} addLabel={t("إضافة تعرّض", "Add an exposure")}
        empty={<Empty>{t("لا تعرضات مسجلة (غير مسجل ≠ لا يوجد).", "No exposures recorded (not recorded is not the same as none).")}</Empty>} />

      <Card id="contacts" title={t("جهات الطوارئ والممثل القانوني", "Emergency contacts & legal representative")}>
        {(contacts ?? []).length === 0 ? <Empty>{t("لا توجد جهات اتصال.", "No contacts.")}</Empty> : (contacts ?? []).map((c) => (
          <div key={c.id} className="rec row between">
            <div><strong>{c.full_name}</strong> {c.relation && <span className="muted">({c.relation})</span>} <span className="ltr">{c.phone}</span> {c.is_legal_representative && <Chip tone="info">{t("ممثل قانوني", "Legal representative")}</Chip>}</div>
            {!ro && <form action={deleteSimple}><input type="hidden" name="_table" value="emergency_contacts" /><input type="hidden" name="_pid" value={p.id} /><input type="hidden" name="_id" value={c.id} /><button className="btn danger sm" aria-label={t("حذف", "Delete")}><Trash2 size={14} aria-hidden="true" /></button></form>}
          </div>))}
        {!ro && (
          <details className="fold" style={{ marginBlockStart: ".8rem" }}><summary>{t("+ إضافة جهة اتصال", "+ Add a contact")}</summary><div className="fold-body">
            <ActionForm action={saveSimple} className="stack"><input type="hidden" name="_table" value="emergency_contacts" /><input type="hidden" name="_pid" value={p.id} />
              <div className="form-grid">
                <div className="field"><label>{t("الاسم", "Name")}</label><input name="full_name" required /></div>
                <div className="field"><label>{t("صلة القرابة", "Relation")}</label><input name="relation" /></div>
                <div className="field"><label>{t("الهاتف", "Phone")}</label><input name="phone" type="tel" dir="ltr" required /></div>
                <div className="field"><label className="check" style={{ marginBlockStart: "1.7rem" }}><input type="checkbox" name="is_legal_representative" />{t("ممثل قانوني / ولي أمر", "Legal representative / guardian")}</label></div>
              </div><div><SubmitButton>{t("إضافة", "Add")}</SubmitButton></div></ActionForm></div></details>)}
      </Card>

      <Card title={t("التأمين الصحي", "Health insurance")}>
        {(insurance ?? []).length === 0 ? <Empty>{t("لا توجد بيانات تأمين.", "No insurance on file.")}</Empty> : (insurance ?? []).map((i) => (
          <div key={i.id} className="rec row between"><div><strong>{i.provider}</strong> <span className="muted small">{[i.policy_number, i.class_name, i.valid_to && `${t("حتى", "until")} ${i.valid_to}`].filter(Boolean).join(" · ")}</span></div>
            {!ro && <form action={deleteSimple}><input type="hidden" name="_table" value="patient_insurance" /><input type="hidden" name="_pid" value={p.id} /><input type="hidden" name="_id" value={i.id} /><button className="btn danger sm" aria-label={t("حذف", "Delete")}><Trash2 size={14} aria-hidden="true" /></button></form>}</div>))}
        {!ro && (
          <details className="fold" style={{ marginBlockStart: ".8rem" }}><summary>{t("+ إضافة تأمين", "+ Add insurance")}</summary><div className="fold-body">
            <ActionForm action={saveSimple} className="stack"><input type="hidden" name="_table" value="patient_insurance" /><input type="hidden" name="_pid" value={p.id} />
              <div className="form-grid">
                <div className="field"><label>{t("الشركة", "Provider")}</label><input name="provider" required /></div>
                <div className="field"><label>{t("رقم الوثيقة", "Policy number")}</label><input name="policy_number" dir="ltr" /></div>
                <div className="field"><label>{t("الفئة", "Class")}</label><input name="class_name" /></div>
                <div className="field"><label>{t("من", "From")}</label><input name="valid_from" type="date" /></div>
                <div className="field"><label>{t("إلى", "To")}</label><input name="valid_to" type="date" /></div>
              </div><div><SubmitButton>{t("إضافة", "Add")}</SubmitButton></div></ActionForm></div></details>)}
      </Card>

      {access.canManage && (
        <Card title={t("أرقام الهوية (خاصة، لا تُشارك)", "Identity numbers (private, never shared)")}>
          {(ids ?? []).map((i) => <div key={i.id} className="rec"><strong>{ID_TYPES.find((x) => x[0] === i.id_type)?.[lang === "ar" ? 1 : 2]}</strong> <span className="ltr">{mask(i.id_value)}</span></div>)}
          <ActionForm action={saveSimple} className="stack" >
            <input type="hidden" name="_table" value="patient_identifiers" /><input type="hidden" name="_pid" value={p.id} />
            <div className="form-grid">
              <div className="field"><label>{t("النوع", "Type")}</label><select name="id_type" defaultValue="national_id">{ID_TYPES.map((x) => <option key={x[0]} value={x[0]}>{lang === "ar" ? x[1] : x[2]}</option>)}</select></div>
              <div className="field"><label>{t("الرقم (يستبدل الرقم الحالي من النوع نفسه)", "Number (replaces the existing one of the same type)")}</label><input name="id_value" dir="ltr" required autoComplete="off" /></div>
            </div><div><SubmitButton>{t("حفظ", "Save")}</SubmitButton></div>
          </ActionForm>
        </Card>
      )}
      {access.canManage && (
        <section className="card danger-zone">
          <div className="card-head"><h2>{t("منطقة الخطر", "Danger zone")}</h2></div>
          <div className="row between">
            <p className="muted" style={{ margin: 0, maxWidth: "60ch" }}>{t("حذف هذا الملف الطبي بالكامل. يُجدول الحذف 30 يوماً قبل أن يصبح نهائياً ويمكن التراجع خلالها.", "Delete this entire health file. Deletion is scheduled for 30 days before it becomes permanent, and can be undone until then.")}</p>
            <Link className="btn danger" href={`/patients/${p.id}/delete`}><Trash2 size={16} aria-hidden="true" />{t("حذف الملف…", "Delete file…")}</Link>
          </div>
        </section>
      )}
    </>
  );
}
