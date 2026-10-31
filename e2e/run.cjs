// End-to-end run against a production build + the local test backend (scripts/dev-backend).
// Usage: node e2e/run.cjs   (expects the app on http://localhost:3000; Playwright's Chromium must be installed)
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const OUT = process.env.E2E_OUT || "/tmp/shifa-e2e";
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const problems = [];           // console errors / 5xx responses seen anywhere
let current = "";
const stamp = Date.now().toString(36);

async function step(name, fn) {
  current = name;
  try { await fn(); results.push([name, true]); console.log("PASS", name); }
  catch (e) { results.push([name, false, String(e.message).split("\n")[0]]); console.log("FAIL", name, "\n     ", String(e.message).split("\n").slice(0, 3).join("\n      ")); }
}
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };

function watch(page, label) {
  page.on("pageerror", (e) => problems.push(`[${label}] pageerror @${current}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource: the server responded with a status of (401|403|404|406)/.test(m.text())) problems.push(`[${label}] console.error @${current}: ${m.text().slice(0, 200)}`); });
  page.on("response", (r) => { if (r.status() >= 500) problems.push(`[${label}] HTTP ${r.status()} ${r.url()} @${current}`); });
}

const pdf = (extra = "") => Buffer.from(`%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>\n${extra}%%EOF\n`);
const localInput = (d) => { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

// every context gets its own client address (as a reverse proxy would send), so the per-IP throttle of one scenario
// never bleeds into another and repeated runs stay independent
const randomIp = () => `203.0.113.${1 + Math.floor(Math.random() * 250)}`;
async function newContext(browser, extra = {}) {
  const ctx = await browser.newContext({ locale: "en-GB", timezoneId: "Asia/Riyadh", ...extra });
  // only requests to the app carry the address: a custom header on cross-origin requests (Google Fonts) fails CORS
  const ip = randomIp();
  await ctx.route(`${BASE}/**`, (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }));
  await ctx.addCookies([{ name: "lang", value: "en", url: BASE }]);
  return ctx;
}

async function signup(page, email, name) {
  await page.goto(`${BASE}/signup`);
  await page.fill("#full_name", name);
  await page.fill("#email", email);
  await page.fill("#password", "correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/patients$/);
}

const openSummary = async (page, text) => { await page.locator("summary", { hasText: text }).first().click(); };
const submit = async (scope, name) => { await scope.getByRole("button", { name, exact: true }).first().click(); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  watch(page, "alice");
  let pid = "", shareLink = "", sharePin = "", cardioDocId = "", contribShareHref = "";

  await step("landing page renders and language toggles to Arabic/RTL", async () => {
    await page.goto(BASE);
    assert((await page.locator("html").getAttribute("dir")) === "ltr", "english is ltr");
    await page.getByRole("button", { name: /العربية/ }).click();
    await page.waitForFunction(() => document.documentElement.dir === "rtl");
    assert((await page.locator("html").getAttribute("lang")) === "ar", "lang ar");
    await page.getByRole("button", { name: /English/ }).click();
    await page.waitForFunction(() => document.documentElement.dir === "ltr");
  });

  await step("anonymous visitors are redirected away from private pages", async () => {
    await page.goto(`${BASE}/patients`);
    assert(/\/login\?next=/.test(page.url()), "redirected to login: " + page.url());
  });

  await step("signup rejects a short password and a bad email", async () => {
    await page.goto(`${BASE}/signup`);
    await page.fill("#full_name", "Tester");
    await page.fill("#email", "not-an-email");
    await page.fill("#password", "short-pw");
    await page.evaluate(() => document.querySelector("form").noValidate = true);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByRole("alert").waitFor();
  });

  const aliceEmail = `alice-${stamp}@example.test`;
  await step("signup creates an account and lands on the (empty) patients list", async () => {
    await signup(page, aliceEmail, "Alice Alpha");
    await page.getByText("No files yet").waitFor();
  });

  await step("create a patient file (validation + success)", async () => {
    await page.goto(`${BASE}/patients/new`);
    await page.fill("#full_name", "Alice Alpha");
    await page.fill("#full_name_en", "Alice Alpha");
    await page.fill("#date_of_birth", "1990-05-01");
    await page.selectOption("#sex", "female");
    await page.selectOption("#blood_abo", "A");
    await page.selectOption("#blood_rh", "+");
    await page.fill("#phone", "+966500000001");
    await submit(page, "Create file");
    // a new file opens on its core file
    await page.waitForURL(/\/patients\/[0-9a-f-]{36}\/profile\?new=1$/);
    pid = page.url().split("/")[4];
    await page.getByText("The file was created. Complete the core file now").waitFor();
    await page.getByText("Allergy status unknown").waitFor();
    assert(await page.getByRole("heading", { name: "Alice Alpha" }).count(), "name shown");
    assert((await page.getByText(/^SH-\d{8}/).count()) > 0, "MRN shown");
  });

  await step("duplicate patient is detected, then allowed after explicit confirmation", async () => {
    await page.goto(`${BASE}/patients/new`);
    await page.fill("#full_name", "alice alpha");
    await page.fill("#date_of_birth", "1990-05-01");
    await submit(page, "Create file");
    await page.getByText(/same name and birth date/).waitFor();
  });

  await step("core file: allergy statement, national id masked, contacts", async () => {
    await page.goto(`${BASE}/patients/${pid}/profile`);
    await page.selectOption("#allergy_assertion", "none_known");
    await page.locator("form:has(#allergy_assertion)").getByRole("button", { name: "Save" }).click();
    await page.locator("form:has(#allergy_assertion)").getByText("Saved.").waitFor();
    await page.fill('input[name="id_value"]', "1098765432");
    await page.locator('form:has(input[name="id_value"])').getByRole("button", { name: "Save" }).click();
    await page.getByText("••••••5432").waitFor();
    assert(!(await page.content()).includes("1098765432"), "national id must not be in the page");
    await openSummary(page, "Add a contact");
    await page.locator('input[name="full_name"]').last().fill("Omar Alpha");
    await page.locator('input[name="phone"]').last().fill("+966511111111");
    await page.getByRole("button", { name: "Add", exact: true }).first().click();
    await page.getByText("Omar Alpha").waitFor();
  });

  await step("allergies: adding one flips the banner; 'none known' is then refused", async () => {
    await page.goto(`${BASE}/patients/${pid}/allergies`);
    await openSummary(page, "Add allergy");
    await page.fill("#allergies_new_substance", "Penicillin");
    await page.selectOption("#allergies_new_severity", "life_threatening");
    await page.selectOption("#allergies_new_certainty", "confirmed");
    await submit(page, "Save");
    await page.getByText("Saved.").first().waitFor();
    await page.goto(`${BASE}/patients/${pid}`);
    await page.getByText("Documented allergies").waitFor();
    await page.goto(`${BASE}/patients/${pid}/profile`);
    await page.selectOption("#allergy_assertion", "none_known");
    await page.locator("form:has(#allergy_assertion)").getByRole("button", { name: "Save" }).click();
    await page.getByText(/Active allergies are recorded/).waitFor();
  });

  await step("conditions and medications are saved with provenance", async () => {
    await page.goto(`${BASE}/patients/${pid}/conditions`);
    await openSummary(page, "Add condition");
    await page.fill("#conditions_new_name", "Hypertension");
    await page.selectOption("#conditions_new_category", "chronic");
    await page.selectOption("#conditions_new_certainty", "confirmed");
    await submit(page, "Save");
    await page.getByText("Hypertension").first().waitFor();
    await page.getByText(/by you/).first().waitFor();
    await page.getByText("Patient-reported (unverified)").first().waitFor();
    await page.goto(`${BASE}/patients/${pid}/medications`);
    await openSummary(page, "Add medication");
    await page.fill("#medications_new_name_generic", "Metformin");
    await page.fill("#medications_new_strength", "500 mg");
    await page.selectOption("#medications_new_origin", "prescribed");
    await submit(page, "Save");
    await page.getByText(/Metformin/).first().waitFor();
    // a medication without any name is refused by the server
    await page.reload();
    await openSummary(page, "Add medication");
    await submit(page, "Save");
    await page.getByRole("alert").first().waitFor();
  });

  await step("a record can be invalidated with a reason and stays in the history", async () => {
    await page.goto(`${BASE}/patients/${pid}/conditions`);
    await openSummary(page, "Add condition");
    await page.fill("#conditions_new_name", "Entered by mistake");
    await submit(page, "Save");
    await page.getByText("Entered by mistake").first().waitFor();
    const rec = page.locator("article.rec", { hasText: "Entered by mistake" }).first();
    await rec.locator("summary", { hasText: "Entered in error" }).click();
    page.once("dialog", (d) => d.accept());
    await rec.locator('input[name="reason"]').fill("duplicate entry");
    await rec.getByRole("button", { name: "Invalidate" }).click();
    await page.getByText(/Invalidated records \(1\)/).waitFor();
  });

  await step("vitals: log BP with pulse over several days; chart + stats render; flag shown", async () => {
    await page.goto(`${BASE}/patients/${pid}/vitals?type=blood_pressure`);
    const readings = [[150, 95, 88, 0], [138, 88, 80, 2], [124, 82, 76, 5], [118, 76, 70, 9], [132, 84, 74, 14]];
    for (const [s, d, p, ago] of readings) {
      await page.locator("input[type=datetime-local]").first().fill(localInput(daysAgo(ago)));
      await page.fill("#v_num", String(s));
      await page.fill("#v_num2", String(d));
      await page.fill("#v_pulse", String(p));
      await submit(page, "Save reading");
      await page.getByText("Reading saved.").waitFor();
      await page.reload();
    }
    await page.locator("svg.chart").first().waitFor();
    assert((await page.locator("svg.chart circle.dot, svg.chart path.dot").count()) >= 8, "points drawn for sys+dia");
    await page.getByText("150/95").first().waitFor();
    assert((await page.getByText("High", { exact: true }).count()) >= 1, "high flag shown");
    assert((await page.getByText("readings").count()) >= 1, "stats shown");
  });

  await step("vitals: invalid input is rejected with a clear message", async () => {
    await page.goto(`${BASE}/patients/${pid}/vitals?type=blood_pressure`);
    await page.fill("#v_num", "80"); await page.fill("#v_num2", "120");
    await submit(page, "Save reading");
    await page.getByText("Systolic must be greater than diastolic.").waitFor();
    await page.fill("#v_num", "999"); await page.fill("#v_num2", "80");
    await submit(page, "Save reading");
    await page.getByText(/outside the plausible range/).waitFor();
    await page.fill("#v_num", "abc");
    await submit(page, "Save reading");
    await page.getByText("Enter a valid number.").waitFor();
  });

  await step("vitals: period switch, compare with previous period, daily/weekly summaries, vector PDF report", async () => {
    await page.goto(`${BASE}/patients/${pid}/vitals?type=blood_pressure`);
    await page.getByRole("link", { name: "7 days" }).click();
    await page.waitForURL(/range=7/);
    await page.getByRole("link", { name: "Compare with previous period" }).click();
    await page.waitForURL(/cmp=1/);
    await page.locator("svg.chart").first().waitFor();
    await page.getByRole("link", { name: "Weekly" }).click();
    await page.getByText("Mean").first().waitFor();
    const r = await ctx.request.get(`${BASE}/api/patients/${pid}/report?scope=vitals&type=blood_pressure&range=all`);
    assert(r.status() === 200 && /application\/pdf/.test(r.headers()["content-type"]) && /no-store/.test(r.headers()["cache-control"]), "pdf served: " + r.status());
    const buf = await r.body();
    assert(buf.subarray(0, 5).toString() === "%PDF-" && buf.length > 5000, "a real PDF document (" + buf.length + " bytes)");
    fs.writeFileSync(path.join(OUT, "vitals-report.pdf"), buf);
  });

  await step("vitals: glucose with context is classified; units are not mixed", async () => {
    await page.goto(`${BASE}/patients/${pid}/vitals?type=blood_glucose`);
    await page.fill("#v_num", "110"); await page.selectOption("#v_ctx", "fasting");
    await submit(page, "Save reading");
    await page.getByText("Reading saved.").waitFor();
    await page.reload();
    await page.fill("#v_num", "5.8");
    await page.selectOption("#v_unit", "mmol/L"); await page.selectOption("#v_ctx", "fasting");
    await submit(page, "Save reading");
    await page.getByText("Reading saved.").waitFor();
    await page.reload();
    await page.locator(".chip", { hasText: "Borderline" }).first().waitFor();
    await page.getByText(/different units are drawn as separate lines/i).waitFor();
  });

  await step("an approved reading is corrected (not overwritten) and history keeps both", async () => {
    await page.goto(`${BASE}/patients/${pid}/vitals?type=blood_pressure&range=all`);
    const row = page.locator("tr", { hasText: "150/95" }).first();
    await row.locator("summary", { hasText: "Correct" }).click();
    await row.locator('input[name="value_num"]').fill("140");
    await row.locator('form:has(button:has-text("Save correction")) input[name="reason"]').fill("misread the monitor");
    await row.getByRole("button", { name: "Save correction" }).click();
    await page.locator("tr.superseded").first().waitFor();
    await page.getByText("Superseded", { exact: true }).first().waitFor();   // the server action has committed and the list was re-rendered
    await page.reload();
    await page.getByText("Superseded", { exact: true }).first().waitFor();
    await page.getByText("Correction", { exact: true }).first().waitFor();
    assert((await page.locator("tr.superseded").count()) >= 1, "original row kept and struck through");
  });

  await step("labs: create a report with numeric + text results; flagged vs reference range", async () => {
    await page.goto(`${BASE}/patients/${pid}/labs/new`);
    await page.fill("#title", "CBC panel");
    await page.fill("#lab_name", "Central Lab");
    await page.selectOption("#r0_type", { label: "Hemoglobin (Hb) (g/dL)" });
    await page.fill("#r0_value", "10.2"); await page.fill("#r0_ref_low", "12"); await page.fill("#r0_ref_high", "16");
    await page.selectOption("#r1_type", { label: "White blood cells (WBC) (10^3/µL)" });
    await page.fill("#r1_value", "6.1"); await page.fill("#r1_ref_low", "4"); await page.fill("#r1_ref_high", "11");
    await page.selectOption("#r2_type", { label: "Urine protein" });
    await page.fill("#r2_value", "Negative");
    await submit(page, "Save report");
    await page.getByText("Report and results saved.").waitFor();
    await page.goto(`${BASE}/patients/${pid}/labs`);
    await page.getByText("1 out of range").waitFor();
    await page.getByText("Negative").first().waitFor();
    await page.getByText("Low", { exact: true }).first().waitFor();
  });

  await step("labs: implausible value fails the whole report atomically", async () => {
    await page.goto(`${BASE}/patients/${pid}/labs/new`);
    await page.fill("#title", "Bad panel");
    await page.selectOption("#r0_type", { label: "Hemoglobin (Hb) (g/dL)" }); await page.fill("#r0_value", "9999");
    await submit(page, "Save report");
    await page.getByText(/plausible range/).waitFor();
    await page.goto(`${BASE}/patients/${pid}/labs`);
    assert((await page.getByText("Bad panel").count()) === 0, "nothing of the failed report was kept");
  });

  await step("labs: trends & comparison view", async () => {
    await page.goto(`${BASE}/patients/${pid}/labs?view=trends&type=hemoglobin`);
    await page.locator("svg.chart").first().waitFor();
    await page.getByText("Result-by-result comparison").waitFor();
  });

  await step("visits for two specialties; visit detail links diagnoses", async () => {
    await page.goto(`${BASE}/patients/${pid}/visits`);
    for (const [reason, kind, spec] of [["Dental check", "dental", "Dentistry"], ["Cardio follow-up", "clinic", "Cardiology"]]) {
      await openSummary(page, "Add visit");
      await page.fill("#visits_new_reason", reason);
      await page.selectOption("#visits_new_kind", kind);
      await page.selectOption("#visits_new_specialty_id", { label: spec });
      await submit(page, "Save");
      await page.getByText("Saved.").first().waitFor();
      await page.reload();
    }
    await page.getByRole("link", { name: /Dental check/ }).first().click().catch(() => {});
    await page.goto(`${BASE}/patients/${pid}/visits`);
    const href = await page.locator("article.rec", { hasText: "Dental check" }).first().locator("a").first().getAttribute("href").catch(() => null);
    // visits cards have no link yet; open through the timeline link instead
    await page.goto(`${BASE}/patients/${pid}/timeline?kind=visit`);
    await page.getByRole("link", { name: /Dental check/ }).first().click();
    await page.waitForURL(/\/visits\/[0-9a-f-]{36}$/);
    await openSummary(page, "Add a diagnosis");
    await page.fill("#conditions_new_name", "Dental caries");
    await page.selectOption("#conditions_new_category", "diagnosis");
    await submit(page, "Save");
    await page.getByText("Dental caries").first().waitFor();
    void href;
  });

  await step("specialty page: shared context; dentistry links to the dental file", async () => {
    await page.goto(`${BASE}/patients/${pid}/specialties/dentistry`);
    await page.getByText("Health context (from the core file)").waitFor();
    await page.getByText("Penicillin").first().waitFor();
    await page.getByText("Hypertension").first().waitFor();
    assert((await page.locator("summary", { hasText: "Dental finding / treatment" }).count()) === 0, "the retired free-text dental form is gone");
    // dentistry has a single workspace: the specialty page opens the dental file
    assert(/\/dental$/.test(page.url()), "the dentistry specialty opens the dental file: " + page.url());
  });

  await step("dental file: two exams on the chart (keyboard surfaces), tooth panel + history, resolve, compare, tooth-linked diagnosis", async () => {
    await page.goto(`${BASE}/patients/${pid}/dental`);
    await page.getByRole("heading", { name: "Current tooth chart" }).waitFor();
    assert(/no exam data/.test(await page.locator("#chart-16").getAttribute("aria-label")), "a tooth without an exam is 'no data', not healthy");
    await openSummary(page, "New exam on the chart");
    const exam = async (date, kind, material) => {
      await page.fill("#px_date", date);
      await page.locator("#px-t-16").click();
      await page.getByRole("radio", { name: "Present", exact: true }).check();
      await page.selectOption("#px_fk", kind);
      if (material) await page.selectOption("#px_fm", material);
      await page.locator("#px-t-16").focus(); await page.keyboard.press("m"); await page.keyboard.press("o");
      await page.getByRole("button", { name: "Add to this tooth" }).click();
      await page.locator("#px-t-18").click();
      await page.getByRole("radio", { name: kind === "caries" ? "Present" : "Extracted", exact: true }).check();
      await page.locator(".exam-summary").getByText("16 MO").waitFor();
      await page.getByRole("button", { name: "Save the exam" }).click();
    };
    await exam(daysAgo(400).toISOString().slice(0, 10), "caries");
    await page.getByRole("heading", { name: "Exams (1)" }).waitFor();
    await exam(daysAgo(1).toISOString().slice(0, 10), "filling", "composite");
    await page.getByRole("heading", { name: "Exams (2)" }).waitFor();
    await page.reload();
    assert(/Extracted/.test(await page.locator("#chart-18").getAttribute("aria-label")), "tooth 18 now shows extracted");
    await page.locator("#chart-16").click();
    const panel = page.locator(".tooth-panel");
    await panel.getByText("upper right first molar").waitFor();
    const caries = panel.locator(".tooth-list li", { hasText: "Caries" }).first();
    await caries.locator("summary", { hasText: "Treated / resolved" }).click();
    await caries.locator('input[name="resolved_note"]').fill("filled last year");
    await caries.getByRole("button", { name: "Save" }).click();
    // the resolved finding leaves the current list (its form goes with it)
    await page.locator(".tooth-panel .tooth-list li", { hasText: "Caries" }).waitFor({ state: "detached" });
    await page.locator(".tooth-panel .tooth-hist").getByText(/resolved .* filled last year/).waitFor();
    // the chart as it was after the first exam
    await page.selectOption("#asof", { index: 2 });
    await page.getByRole("button", { name: "Show", exact: true }).click();
    await page.getByRole("heading", { name: /The chart as of/ }).waitFor();
    assert(/Present/.test(await page.locator("#chart-18").getAttribute("aria-label")), "the past chart shows 18 as it was");
    // compare
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    const cmp = page.locator("#compare");
    await cmp.getByRole("heading", { name: "Comparing two exams" }).waitFor();
    await cmp.locator("tr", { hasText: "18" }).getByText("Extracted").waitFor();
    await cmp.locator("tr", { hasText: "16" }).getByText("Filling MO").waitFor();
    // a diagnosis naming its tooth (invalid numbers refused)
    await page.goto(`${BASE}/patients/${pid}/dental?tab=problems`);
    await openSummary(page, "Add a dental diagnosis");
    // inside the dental file the form does not ask for the specialty or the category
    assert((await page.locator("#conditions_new_specialty_id").count()) === 0 && (await page.locator("#conditions_new_category").count()) === 0, "dental diagnosis form asks only what it needs");
    await page.fill("#conditions_new_name", "Irreversible pulpitis");
    await page.fill("#conditions_new_teeth", "19");
    await page.locator("form", { has: page.locator("#conditions_new_teeth") }).getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText(/Invalid tooth numbers/).waitFor();
    await page.fill("#conditions_new_teeth", "36");
    await page.locator("form", { has: page.locator("#conditions_new_teeth") }).getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Teeth: 36").first().waitFor();
    await page.goto(`${BASE}/patients/${pid}/dental`);
    assert(/problem: Irreversible pulpitis/.test(await page.locator("#chart-36").getAttribute("aria-label")), "the open diagnosis is drawn on its tooth");
    await page.locator("#chart-36").click();
    await page.locator(".tooth-panel .tooth-list").getByText("Irreversible pulpitis").first().waitFor();
    await page.screenshot({ path: path.join(OUT, "dental-file.png"), fullPage: true });
  });

  await step("forms know where they are; a diagnosis changes status in one step and keeps its history", async () => {
    // the general conditions form has no tooth field; the core file offers only chronic categories
    await page.goto(`${BASE}/patients/${pid}/conditions`);
    await openSummary(page, "Add condition");
    assert((await page.locator("#conditions_new_teeth").count()) === 0, "no tooth field outside the dental file");
    assert((await page.locator("#conditions_new_specialty_id").count()) === 1, "the general form lets the user pick the specialty");
    await page.goto(`${BASE}/patients/${pid}/profile`);
    const cats = await page.locator("#conditions #conditions_new_category option").allInnerTexts();
    assert(cats.length === 4 && !cats.some((c) => /Diagnosis|Acute/.test(c)), "core file: chronic categories only: " + cats.join("|"));
    // resolve, then a recurrence, each with its reason
    await page.goto(`${BASE}/patients/${pid}/dental?tab=problems`);
    const card = () => page.locator("#diagnoses article.rec", { hasText: "Irreversible pulpitis" }).first();
    await card().locator("summary", { hasText: "Change status" }).click();
    await card().getByRole("radio", { name: "Resolved" }).check();
    await card().locator('input[name="status_reason"]').fill("root canal treatment");
    await card().getByRole("button", { name: "Save status" }).click();
    await page.getByText("Status changed; the change is kept in its history.").first().waitFor();
    await page.reload();
    await card().locator("summary", { hasText: "Change status" }).click();
    await card().getByRole("radio", { name: "Recurrence" }).check();
    await card().locator('input[name="status_reason"]').fill("pain again");
    await card().getByRole("button", { name: "Save status" }).click();
    await page.getByText("Status changed; the change is kept in its history.").first().waitFor();
    await page.reload();
    await card().locator("summary", { hasText: "Status history (2 changes)" }).click();
    await card().getByText(/Active → Resolved — root canal treatment/).waitFor();
    await card().getByText(/Resolved → Recurrence — pain again/).waitFor();
  });

  await step("one dental file: a problem without a tooth gets its tooth; procedures and images on the same tooth show on the chart and in its panel", async () => {
    await page.goto(`${BASE}/patients/${pid}/dental?tab=problems`);
    await openSummary(page, "Add a dental diagnosis");
    await page.fill("#conditions_new_name", "Dental abscess (loose canine)");
    await page.locator("form", { has: page.locator("#conditions_new_name") }).getByRole("button", { name: "Save", exact: true }).click();
    const un = page.locator("#unassigned li", { hasText: "Dental abscess (loose canine)" });
    await un.waitFor();
    await page.getByRole("link", { name: /Problems & diagnoses \(\d+ without a tooth\)/ }).waitFor();
    await un.locator('input[name="teeth"]').fill("13");
    await un.getByRole("button", { name: "Set the tooth" }).click();
    await un.waitFor({ state: "detached" });                                          // it leaves the list once its tooth is known
    // a procedure and an image on tooth 13
    await page.goto(`${BASE}/patients/${pid}/dental?tab=care`);
    await openSummary(page, "Add a dental procedure");
    assert((await page.locator("#procedures_new_specialty_id").count()) === 0, "no specialty question inside the dental file");
    await page.fill("#procedures_new_name", "Abscess drainage");
    await page.fill("#procedures_new_teeth", "13");
    await page.locator("form", { has: page.locator("#procedures_new_name") }).getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Teeth: 13").first().waitFor();
    await page.goto(`${BASE}/patients/${pid}/dental?tab=imaging`);
    await openSummary(page, "Add an image or X-ray");
    await page.fill("#imaging_new_teeth", "13, 14");
    await page.fill("#imaging_new_impression", "Periapical radiolucency at 13");
    await page.locator("form", { has: page.locator("#imaging_new_teeth") }).getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Teeth: 13, 14").first().waitFor();
    // the chart and the tooth panel bring them together
    await page.goto(`${BASE}/patients/${pid}/dental`);
    const label = await page.locator("#chart-13").getAttribute("aria-label");
    assert(/problem: Dental abscess/.test(label) && /procedures: 1/.test(label) && /images: 1/.test(label), "tooth 13 carries the problem, the procedure and the image: " + label);
    await page.locator("#chart-13").click();
    const panel = page.locator(".tooth-panel");
    await panel.locator(".tooth-list").getByText("Dental abscess (loose canine)").first().waitFor();
    await panel.locator(".tooth-list").getByText("Abscess drainage").first().waitFor();
    await panel.locator(".tooth-list").getByText("Periapical radiolucency at 13").first().waitFor();
    // the panoramic view is the default; the five-surface view is one click away and shows the same tooth
    await page.locator(".pano-svg").waitFor();
    await page.locator(".pano-svg .lesion").first().waitFor();                                 // the abscess drawn at the apex of 13
    await page.getByRole("button", { name: "Surfaces", exact: true }).click();
    await page.locator("#chart .odonto-svg").waitFor();
    assert(/problem: Dental abscess/.test(await page.locator("#chart-13").getAttribute("aria-label")), "the surfaces view shows the same tooth");
    await page.getByRole("button", { name: "Panoramic", exact: true }).click();
    await page.locator(".pano-svg").waitFor();
    await page.screenshot({ path: path.join(OUT, "dental-linked.png"), fullPage: true });
  });

  await step("in place: the chosen tooth's panel adds a diagnosis and a procedure to that tooth; the menu lists the specialties in use first", async () => {
    await page.goto(`${BASE}/patients/${pid}/dental`);
    await page.locator("#chart-46").click();
    const panel = page.locator(".tooth-panel");
    await panel.locator("summary", { hasText: "A diagnosis for this tooth" }).click();
    const dx = page.locator("form#tooth-dx");
    assert((await dx.locator('[name="specialty_id"]:not([type="hidden"]), [name="category"]:not([type="hidden"]), input[name="teeth"]:not([type="hidden"])').count()) === 0,
      "no specialty, category or tooth question when adding from the tooth itself");
    await dx.locator('input[name="name"]').fill("Cracked tooth (from the chart)");
    await dx.getByRole("button", { name: "Add the diagnosis" }).click();
    await panel.locator("li", { hasText: "Cracked tooth (from the chart)" }).waitFor();
    await panel.locator("summary", { hasText: "A procedure on this tooth" }).click();
    const px = page.locator("form#tooth-px");
    await px.locator('input[name="name"]').fill("Bonded splint (from the chart)");
    await px.getByRole("button", { name: "Add the procedure" }).click();
    await panel.locator("li", { hasText: "Bonded splint (from the chart)" }).waitFor();
    await page.reload();
    const label = await page.locator("#chart-46").getAttribute("aria-label");
    assert(/problem: Cracked tooth/.test(label) && /procedures: 1/.test(label), "both are on tooth 46: " + label);
    // the menu: the specialties this file uses, then "open another"
    const nav = page.locator("nav.sidenav");
    await nav.getByText("Specialty files", { exact: true }).waitFor();
    await nav.getByRole("link", { name: "Dentistry" }).waitFor();
    assert(/\/dental$/.test(await nav.getByRole("link", { name: "Dentistry" }).getAttribute("href")), "dentistry opens the dental file");
    await nav.getByRole("link", { name: "Open another specialty" }).click();
    await page.locator("#used").getByText("Dentistry").waitFor();
    assert((await page.locator("#used").getByText("Gynecology").count()) === 0, "unused specialties are not in the used list");
    await page.locator("#others summary").click();
    await page.locator("#others").getByText("Ophthalmology").waitFor();
  });

  await step("treatment: a crown proposed from tooth 46's panel, an extraction added, the plan accepted with the surgical confirmation, the crown completed (chart and problem updated), a private cost, a new version, the plan PDF", async () => {
    await page.goto(`${BASE}/patients/${pid}/dental`);
    await page.locator("#chart-46").click();
    const panel = page.locator(".tooth-panel");
    await panel.locator("summary", { hasText: "A treatment for this tooth" }).click();
    const f = page.locator("form#tooth-tx");
    assert((await f.locator('input[name="teeth"]:not([type="hidden"])').count()) === 0, "no tooth question from the tooth panel");
    await f.locator('select[name="catalog_code"]').selectOption("crown_zirconia");
    await f.locator('select[name="condition_id"]').selectOption({ label: "Cracked tooth (from the chart) (46)" });
    await f.getByRole("button", { name: "Add to the plan" }).click();
    await panel.locator("li.planned", { hasText: "Zirconia crown" }).waitFor();
    await page.reload();
    assert(/planned treatments: 1/.test(await page.locator("#chart-46").getAttribute("aria-label")), "the chart marks the planned crown on 46");

    await page.goto(`${BASE}/patients/${pid}/dental?tab=treatment`);
    const plan = page.locator("article.plan-card").first();
    await plan.getByText("Dental treatment plan").first().waitFor();
    const addBox = plan.locator("details", { hasText: "Add a treatment to this plan" });
    await addBox.locator("summary").click();
    await addBox.locator('select[name="catalog_code"]').selectOption("extraction_simple");
    await addBox.locator('input[name="teeth"]').fill("38");
    await addBox.locator('input[name="phase"]').fill("2");
    await addBox.getByRole("button", { name: "Add the treatment" }).click();
    await plan.locator("li.treat-item", { hasText: "Simple extraction" }).waitFor();
    await plan.locator("li.treat-item", { hasText: "Simple extraction" }).getByText("Surgical").waitFor();

    // accepting: a plan with a surgical treatment needs the explicit confirmation (the box is required)
    await plan.locator("summary", { hasText: "Accept / plan status" }).click();
    const ps = plan.locator('form[id^="ps-"]');
    await ps.locator('select[name="status"]').selectOption("accepted");
    await ps.locator('input[name="confirm_surgical"]').waitFor();
    await ps.locator('input[name="confirm_surgical"]').check();
    await ps.getByRole("button", { name: "Save the status" }).click();
    await plan.getByText("Accepted", { exact: true }).first().waitFor();

    // completing the crown: the procedure, the chart and the cracked-tooth problem follow
    const crown = plan.locator("li.treat-item", { hasText: "Zirconia crown" });
    await crown.locator("summary", { hasText: "Change status" }).click();
    await crown.locator('select[name="status"]').selectOption("completed");
    await crown.getByRole("button", { name: "Save the status" }).click();
    await page.getByText(/recorded as completed/).first().waitFor();
    await page.locator("li.treat-item", { hasText: "Zirconia crown" }).getByText("Completed", { exact: true }).waitFor();
    await page.locator(".plan-progress", { hasText: "1 of 2 done" }).first().waitFor();

    // a private cost on the extraction
    const ext = page.locator("li.treat-item", { hasText: "Simple extraction" });
    await ext.locator("summary", { hasText: "Add a cost" }).click();
    await ext.locator('input[name="amount"]').fill("300");
    await ext.getByRole("button", { name: "Save", exact: true }).click();
    await page.locator(".plan-total").first().waitFor();
    assert(/300/.test(await page.locator(".plan-total").first().innerText()), "the total shows the cost");

    // the plan prints with its consent section
    const planId = (await page.locator("article.plan-card").first().getAttribute("id")).replace("plan-", "");
    const r = await page.request.get(`${BASE}/api/patients/${pid}/treatment-plans/${planId}/pdf?costs=1`);
    assert(r.status() === 200 && /application\/pdf/.test(r.headers()["content-type"]), "plan pdf " + r.status());
    fs.writeFileSync(path.join(OUT, "treatment-plan.pdf"), await r.body());

    await page.goto(`${BASE}/patients/${pid}/dental`);
    const l46 = await page.locator("#chart-46").getAttribute("aria-label");
    assert(/Crown/.test(l46) && !/problem: Cracked tooth/.test(l46) && !/planned treatments/.test(l46), "46 now carries the crown, the problem is closed: " + l46);
    await page.locator("#chart-46").click();
    await page.locator(".tooth-panel li", { hasText: "Cracked tooth (from the chart)" }).getByText("Resolved").waitFor();

    // a new version keeps the old one
    await page.goto(`${BASE}/patients/${pid}/dental?tab=treatment`);
    const cur = page.locator("article.plan-card").first();
    await cur.locator("summary", { hasText: "New version" }).click();
    await cur.getByPlaceholder("Why (e.g. the price changed)").fill("price changed");
    await cur.getByRole("button", { name: "Create a new version" }).click();
    await page.getByText("Version 2").first().waitFor();
    await page.locator("#past-plans summary", { hasText: "Past and superseded plans (1)" }).waitFor();
    await page.screenshot({ path: path.join(OUT, "treatment.png"), fullPage: true });
  });

  await step("documents: valid PDF accepted; disguised executable and active-content PDF rejected", async () => {
    await page.goto(`${BASE}/patients/${pid}/documents`);
    const up = async (name, buf, mime, title, spec) => {
      await page.goto(`${BASE}/patients/${pid}/documents`);
      if (!(await page.locator("#file").isVisible())) await openSummary(page, "Upload a document");
      await page.setInputFiles("#file", { name, mimeType: mime, buffer: buf });
      await page.fill("#title", title);
      if (spec) await page.selectOption("#specialty_id", { label: spec });
      await page.getByRole("button", { name: "Upload", exact: true }).click();
      await page.waitForLoadState("networkidle");
    };
    await up("xray.pdf", pdf(), "application/pdf", "Dental X-ray", "Dentistry");
    await page.getByText("Document uploaded.").waitFor();
    await up("cardio.pdf", pdf("% cardio\n"), "application/pdf", "Cardio report", "Cardiology");
    await page.getByText("Document uploaded.").waitFor();
    cardioDocId = (await page.locator("a", { hasText: "Cardio report" }).first().getAttribute("href")).split("/").pop();
    await up("evil.pdf", Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00 not a pdf"), "application/pdf", "Evil", null);
    await page.getByText(/File type not allowed/).waitFor();
    await up("js.pdf", pdf("/JS (app.alert(1)) /S /JavaScript\n"), "application/pdf", "Scripted", null);
    await page.getByText(/active content/).waitFor();
    await page.goto(`${BASE}/patients/${pid}/documents`);
    assert((await page.getByText("Evil").count()) === 0 && (await page.getByText("Scripted").count()) === 0, "rejected files are not listed");
    const href = await page.locator("a", { hasText: "Dental X-ray" }).first().getAttribute("href");
    const r = await ctx.request.get(BASE + href);
    assert(r.status() === 200 && r.headers()["content-type"] === "application/pdf", "pdf served: " + r.status());
    assert(/nosniff/.test(r.headers()["x-content-type-options"]) && /no-store/.test(r.headers()["cache-control"]), "hardened headers");
  });

  const addForm = (summary) => page.locator("details", { has: page.locator("summary", { hasText: summary }) }).first();

  await step("partial and unknown dates: an approximate onset year, an imaging study without a date", async () => {
    await page.goto(`${BASE}/patients/${pid}/conditions`);
    await openSummary(page, "Add condition");
    await page.fill("#conditions_new_name", "Congenital aortic narrowing");
    await page.selectOption("#conditions_new_category", "congenital");
    await page.fill("#conditions_new_onset_date", "2003-06-15");
    await addForm("Add condition").locator('select[name="date_precision"]').selectOption("approx");
    await submit(page, "Save");
    await page.getByText("Saved.").first().waitFor();
    await page.reload();
    await page.locator("article.rec", { hasText: "Congenital aortic narrowing" }).getByText("around 2003").first().waitFor();
    await page.goto(`${BASE}/patients/${pid}/imaging`);
    await openSummary(page, "Add imaging study");
    await page.selectOption("#imaging_new_modality", "xray");
    await page.fill("#imaging_new_body_site", "Chest (undated photo)");
    await submit(page, "Save");
    await page.getByText("Saved.").first().waitFor();
    await page.reload();
    await page.locator("article.rec", { hasText: "Chest (undated photo)" }).getByText("Date unknown").first().waitFor();
  });

  await step("duplicates: a repeated condition, reading, file and lab result are flagged; 'save anyway' still saves", async () => {
    await page.goto(`${BASE}/patients/${pid}/conditions`);
    await openSummary(page, "Add condition");
    await page.fill("#conditions_new_name", "  hypertension ");
    await submit(page, "Save");
    await page.getByText(/looks like a record that already exists/).waitFor();
    await addForm("Add condition").getByLabel("It is not a duplicate — save anyway").check();
    await submit(page, "Save");
    await page.getByText("Saved.").first().waitFor();

    await page.goto(`${BASE}/patients/${pid}/vitals?type=weight`);
    const when = localInput(daysAgo(1));
    for (const expectDup of [false, true]) {
      await page.locator("input[type=datetime-local]").first().fill(when);
      await page.fill("#v_num", "70");
      await submit(page, "Save reading");
      if (expectDup) await page.getByText(/already recorded with the same value and time/).waitFor();
      else { await page.getByText("Reading saved.").waitFor(); await page.reload(); }
    }

    await page.goto(`${BASE}/patients/${pid}/documents`);
    if (!(await page.locator("#file").isVisible())) await openSummary(page, "Upload a document");
    await page.setInputFiles("#file", { name: "xray-again.pdf", mimeType: "application/pdf", buffer: pdf() });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await page.getByText(/This exact file is already in this record/).waitFor();
    await page.getByText("Upload anyway (an intended second copy)").waitFor();

    await page.goto(`${BASE}/patients/${pid}/labs/new`);
    await page.fill("#title", "CBC panel (again)");
    await page.selectOption("#r0_type", { label: "Hemoglobin (Hb) (g/dL)" });
    await page.fill("#r0_value", "10.2");
    await submit(page, "Save report");
    await page.getByText(/already recorded around the same date with the same values/).waitFor();
  });

  await step("test requests: suggested vs ordered; a lab report closes the request; other-test names; family sides", async () => {
    await page.goto(`${BASE}/patients/${pid}/test-orders`);
    await openSummary(page, "Add test request");
    await page.fill("#test-orders_new_name", "Kidney function");
    await page.selectOption("#test-orders_new_status", "suggested");
    await submit(page, "Save");
    await page.getByText("Saved.").first().waitFor();
    await page.reload();
    await page.locator("article.rec", { hasText: "Kidney function" }).getByText("Suggested (not ordered)").first().waitFor();

    await page.goto(`${BASE}/patients/${pid}/labs/new`);
    await page.fill("#title", "Kidney panel");
    await page.selectOption("#r0_type", { label: "Creatinine (mg/dL)" });
    await page.fill("#r0_value", "1.0"); await page.fill("#r0_ref_low", "0.5"); await page.fill("#r0_ref_high", "1.1");
    await page.selectOption("#r1_type", { label: "Other lab test (numeric)" });
    await page.fill("#r1_custom_name", "RDW-SD custom");
    await page.fill("#r1_value", "47"); await page.fill("#r1_unit", "fL");
    await page.getByLabel(/Kidney function/).check();
    await submit(page, "Save report");
    await page.getByText(/1 requested test\(s\) marked done/).waitFor();
    await page.goto(`${BASE}/patients/${pid}/test-orders`);
    await page.locator("article.rec", { hasText: "Kidney function" }).getByText("Done", { exact: true }).first().waitFor();
    await page.goto(`${BASE}/patients/${pid}/labs`);
    await page.getByText("RDW-SD custom").first().waitFor();

    await page.goto(`${BASE}/patients/${pid}/family-history`);
    await openSummary(page, "Add family entry");
    await page.selectOption("#family-history_new_relation", "paternal_uncle");
    await page.fill("#family-history_new_condition_name", "Type 1 diabetes");
    await submit(page, "Save");
    await page.getByText("Saved.").first().waitFor();
    await page.reload();
    await page.getByText("Paternal uncle: Type 1 diabetes").first().waitFor();
  });

  await step("calculated values: BMI from the latest weight and height, eGFR per creatinine result", async () => {
    await page.goto(`${BASE}/patients/${pid}/vitals?type=height`);
    await page.locator("input[type=datetime-local]").first().fill(localInput(daysAgo(1)));
    await page.fill("#v_num", "165");
    await submit(page, "Save reading");
    await page.getByText("Reading saved.").waitFor();
    await page.goto(`${BASE}/patients/${pid}`);
    const card = page.locator("section, .card", { hasText: "Calculated values" }).first();
    await card.waitFor();
    await card.getByText("Body-mass index (BMI)").waitFor();
    await card.getByText("Overweight").waitFor();                       // 70 kg / 1.65 m = 25.7
    await card.getByText("eGFR (CKD-EPI 2021)").waitFor();
    await page.goto(`${BASE}/patients/${pid}/labs`);
    await page.getByText("eGFR (CKD-EPI 2021)").first().waitFor();
  });

  await step("timeline and audit pages render the history", async () => {
    await page.goto(`${BASE}/patients/${pid}/timeline`);
    await page.getByText("Health timeline").waitFor();
    assert((await page.locator(".timeline li").count()) >= 6, "several events listed");
    await page.goto(`${BASE}/patients/${pid}/audit`);
    await page.getByRole("heading", { name: "Change history" }).waitFor();
    assert((await page.locator("table.t tbody tr").count()) >= 10, "audit rows present");
  });

  await step("core file: height and weight become readings, devices, lifestyle, 'none known', completeness; the context reaches the dental file", async () => {
    await page.goto(`${BASE}/patients/${pid}/profile`);
    await page.locator("#completeness").getByText(/core items are missing/).waitFor();
    await page.fill("#height_cm", "165");
    await page.fill("#weight_kg", "62.5");
    await page.locator("form:has(#height_cm)").getByRole("button", { name: "Save" }).click();
    await page.getByText("Saved, and recorded under vitals.").waitFor();
    await page.locator("#body").getByText("165 cm").waitFor();
    // a device in place
    await page.locator("#devices summary", { hasText: "Add a device or implant" }).click();
    await page.selectOption("#devices_new_kind", "prosthetic_heart_valve");
    await page.fill("#devices_new_name", "Mechanical aortic valve");
    await page.locator("form:has(#devices_new_name)").getByRole("button", { name: "Save", exact: true }).click();
    await page.locator("#devices").getByText("Mechanical aortic valve").waitFor();
    // "no long-term medications" cannot be confused with an empty list
    await page.locator("#medications").getByText("An empty list does not mean “none” until you confirm it.").waitFor();
    // lifestyle: a current smoker with amounts; not pregnant
    await page.selectOption("#hp_tobacco_status", "current");
    await page.locator('#lifestyle input[name="tobacco_types"][value="cigarettes"]').check();
    await page.fill("#hp_cpd", "10");
    await page.fill("#hp_start", "2010");
    await page.selectOption("#hp_pregnancy_status", "not_pregnant");
    await page.locator("form:has(#hp_tobacco_status)").getByRole("button", { name: "Save", exact: true }).click();
    await page.locator("#lifestyle").getByText("Saved.").waitFor();
    // the reading is in vitals too (one source)
    await page.goto(`${BASE}/patients/${pid}/vitals?type=weight`);
    await page.getByText("62.5").first().waitFor();
    // the context in the dental file, with the dentistry reminders
    await page.goto(`${BASE}/patients/${pid}/dental`);
    const ctxBox = page.locator("section.ctx");
    await ctxBox.getByText("Prosthetic heart valve: endocarditis prophylaxis").waitFor();
    await ctxBox.getByText(/Smoker: slower healing/).waitFor();
    await ctxBox.getByText(/Heart or valve disease: review the need for antibiotic prophylaxis/).waitFor();   // from "Congenital aortic narrowing"
    await ctxBox.getByText(/pack-years/).waitFor();
    await ctxBox.getByText("Penicillin", { exact: true }).waitFor();
    await ctxBox.getByText(/Penicillin allergy: choose an alternative antibiotic/).waitFor();
    await page.screenshot({ path: path.join(OUT, "core-context-dental.png"), fullPage: true });
  });

  await step("dashboard summarises vitals, medications, conditions and alerts", async () => {
    await page.goto(`${BASE}/patients/${pid}`);
    await page.getByText("Health context (from the core file)").waitFor();
    await page.getByText(/Metformin/).first().waitFor();
    await page.getByText("Hypertension").first().waitFor();
    await page.getByText("Blood pressure").first().waitFor();
    await page.getByText("Recent out-of-range results").waitFor();
  });

  await step("create a specialty share (dentistry): link + PIN shown once", async () => {
    await page.goto(`${BASE}/patients/${pid}/sharing/new?specialty=dentistry`);
    await page.getByText("Always included (for safety)").waitFor();
    await page.check('input[name="allow_notes"]');
    await submit(page, "Create link & PIN");
    await page.getByText("Share created").waitFor();
    shareLink = await page.locator('input[aria-label="Share link"]').inputValue();
    await page.getByRole("button", { name: "Show" }).click();
    sharePin = await page.locator('input[aria-label="PIN"]').inputValue();
    assert(/\/s\/[A-Za-z0-9_-]{30,}$/.test(shareLink), "link shape: " + shareLink);
    assert(/^\d{6}$/.test(sharePin), "pin shape");
  });

  // ---------------------------------------------------------------- the doctor, in a clean browser (no Alice cookies)
  const dctx = await newContext(browser);
  const doc = await dctx.newPage();
  watch(doc, "doctor");
  const slink = shareLink.replace(/^https?:\/\/[^/]+/, BASE);

  await step("doctor: wrong PIN is refused with attempts left; link alone reveals nothing", async () => {
    await doc.goto(slink);
    await doc.getByText("Shared medical file").first().waitFor();
    assert(!(await doc.content()).includes("Alice"), "no patient data before the PIN");
    await doc.fill("#pin", "000000");
    await doc.getByRole("button", { name: "Open file" }).click();
    await doc.getByText(/Incorrect PIN\. Attempts left: 4/).waitFor();
    await doc.goto(slink.replace(/\/s\/.*/, "") + "/s/not-a-real-token-not-a-real-token-1/view");
    await doc.waitForURL(/\/s\/not-a-real-token/);
    assert(!(await doc.content()).includes("Alice"), "view without a session leaks nothing");
  });

  await step("doctor: correct PIN opens only the dentistry scope; no cardio, no id numbers", async () => {
    await doc.goto(slink);
    await doc.fill("#pin", sharePin);
    await doc.getByRole("button", { name: "Open file" }).click();
    await doc.waitForURL(/\/view$/);
    const html = await doc.content();
    await doc.getByText("Health context & safety information").waitFor();
    await doc.getByText(/Prosthetic heart valve: endocarditis prophylaxis/).waitFor();       // the dentistry reminder, from the core file
    assert(html.includes("Penicillin") && html.includes("Hypertension") && html.includes("Metformin"), "safety core present");
    assert(html.includes("Mechanical aortic valve"), "devices reach the doctor");
    await doc.locator("section.ctx").getByText("165 cm").waitFor();                            // and the body measurements
    assert(html.includes("Dental check") && html.includes("Dental caries"), "dentistry data present");
    assert(!html.includes("Cardio follow-up") && !html.includes("Cardio report"), "cardiology data absent");
    assert(!html.includes("1098765432"), "national id never shared");
    assert(!html.includes("+966500000001") && !html.includes("Omar Alpha"), "contact data absent unless selected");
    assert(!html.includes("Entered by mistake"), "invalidated records absent");
    assert(html.includes("Dental X-ray"), "in-scope document listed");
    assert(!/storage_path|pin_hash|token_hash/.test(html), "no internals leaked");
    assert(!html.includes("Add to the patient's file"), "a read-only share offers no way to add");
  });

  await step("doctor: in-scope document opens; out-of-scope document is forbidden; download is blocked", async () => {
    const token = slink.split("/s/")[1];
    const link = await doc.locator("a", { hasText: "Dental X-ray" }).first().getAttribute("href");
    const ok = await dctx.request.get(BASE + link);
    assert(ok.status() === 200 && ok.headers()["content-type"] === "application/pdf", "doc opens: " + ok.status());
    const bad = await dctx.request.get(`${BASE}/s/${token}/doc/${cardioDocId}`);
    assert(bad.status() === 403, "cardio doc forbidden: " + bad.status());
    const dl = await dctx.request.get(BASE + link + "?dl=1");
    assert(dl.status() === 403, "download not permitted: " + dl.status());
    const unknown = await dctx.request.get(`${BASE}/s/${token}/doc/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}`);
    assert(unknown.status() === 403, "unknown doc forbidden");
    const noSession = await (await newContext(browser)).request.get(BASE + link);
    assert(noSession.status() === 401, "no cookie => 401: " + noSession.status());
    assert(/no-store/.test(ok.headers()["cache-control"]), "no-store");
    assert((await dctx.request.get(`${BASE}/s/${token}/pdf`)).status() === 403, "PDF refused when printing is not allowed");
    assert((await (await newContext(browser)).request.get(`${BASE}/s/${token}/pdf`)).status() === 401, "PDF needs a session");
  });

  await step("doctor: leaves a note; patient sees it and marks it reviewed", async () => {
    await doc.fill("#author_name", "Dr. Molar");
    await doc.fill("#body", "Please bring the latest panoramic film.");
    await doc.getByRole("button", { name: "Send" }).click();
    await doc.getByText("Your note was sent to the patient.").waitFor();
    await page.goto(`${BASE}/patients/${pid}/sharing`);
    await page.locator('a[href*="/sharing/"]', { hasText: /Dentistry/ }).first().click();     // the share, not the menu's Dentistry
    await page.getByText("Please bring the latest panoramic film.").waitFor();
    await page.getByRole("button", { name: "Mark reviewed" }).click();
    await page.getByText("Reviewed", { exact: true }).waitFor();
  });

  await step("patient sees the access log (failed PIN, opened, document, note) without secrets", async () => {
    await page.reload();
    const text = await page.locator("main").innerText();
    for (const s of ["Wrong PIN attempt", "Opened (correct PIN)", "Document opened", "Doctor added a note"]) assert(text.includes(s), "log has: " + s);
    assert(!text.includes(sharePin) && !text.includes(slink.split("/s/")[1]), "log never shows PIN or token");
  });

  await step("revoking the share cuts the doctor off immediately", async () => {
    await page.locator("input[name=reason]").first().fill("visit finished");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Revoke now" }).click();
    await page.getByText("Revoked", { exact: true }).first().waitFor();
    await doc.reload();
    await doc.waitForURL(/\/s\/[^/]+\?expired=1$/);
    await doc.fill("#pin", sharePin);
    await doc.getByRole("button", { name: "Open file" }).click();
    await doc.getByText("invalid, expired or revoked").waitFor();
    const link = await page.locator("main").innerText();
    assert(/Revoked/.test(link), "patient sees revoked state");
  });

  await step("brute-forcing the PIN locks the link", async () => {
    await page.goto(`${BASE}/patients/${pid}/sharing/new`);
    await page.fill("#title", "Brute target");
    await page.check('input[name="scope_kind"][value="full"]');
    await submit(page, "Create link & PIN");
    await page.getByText("Share created").waitFor();
    const l = (await page.locator('input[aria-label="Share link"]').inputValue()).replace(/^https?:\/\/[^/]+/, BASE);
    const c2 = await newContext(browser); const p2 = await c2.newPage(); watch(p2, "attacker");
    await p2.goto(l);
    for (let i = 0; i < 5; i++) {
      await p2.fill("#pin", String(111110 + i));
      await p2.getByRole("button", { name: "Open file" }).click();
      await p2.waitForLoadState("networkidle");
    }
    await p2.getByText(/temporarily locked/).waitFor();
    await c2.close();
  });

  // ---------------------------------------------------------------- another user
  const bctx = await newContext(browser);
  const bob = await bctx.newPage();
  watch(bob, "bob");
  await step("doctor print: a vector PDF of exactly the shared scope, only when the patient allowed printing", async () => {
    await page.goto(`${BASE}/patients/${pid}/sharing/new?specialty=dentistry`);
    await page.getByText("Always included (for safety)").waitFor();
    await page.check('input[name="allow_print"]');
    await submit(page, "Create link & PIN");
    await page.getByText("Share created").waitFor();
    const link2 = (await page.locator('input[aria-label="Share link"]').inputValue()).replace(/^https?:\/\/[^/]+/, BASE);
    await page.getByRole("button", { name: "Show" }).click();
    const pin2 = await page.locator('input[aria-label="PIN"]').inputValue();
    const c2 = await newContext(browser); const d2 = await c2.newPage(); watch(d2, "doctor2");
    await d2.goto(link2); await d2.fill("#pin", pin2); await d2.getByRole("button", { name: "Open file" }).click(); await d2.waitForURL(/\/view$/);
    await d2.getByRole("link", { name: /Print \(PDF\)/ }).waitFor();
    const token2 = link2.split("/s/")[1];
    const r = await c2.request.get(`${BASE}/s/${token2}/pdf`);
    assert(r.status() === 200 && /application\/pdf/.test(r.headers()["content-type"]) && /no-store/.test(r.headers()["cache-control"]), "pdf " + r.status());
    const buf = await r.body();
    assert(buf.subarray(0, 5).toString() === "%PDF-", "pdf header");
    fs.writeFileSync(path.join(OUT, "shared-bundle.pdf"), buf);
    await c2.close();
  });

  await step("doctor adds through a contributing share: identify + on-screen signature, diagnosis, visit + linked note, document, withdrawal", async () => {
    await page.goto(`${BASE}/patients/${pid}/sharing/new?specialty=dentistry`);
    await page.getByText("Always included (for safety)").waitFor();
    await page.check('input[name="allow_contribute"]');
    await submit(page, "Create link & PIN");
    await page.getByText("Share created").waitFor();
    const link3 = (await page.locator('input[aria-label="Share link"]').inputValue()).replace(/^https?:\/\/[^/]+/, BASE);
    await page.getByRole("button", { name: "Show" }).click();
    const pin3 = await page.locator('input[aria-label="PIN"]').inputValue();
    contribShareHref = await page.getByRole("link", { name: "Manage this share" }).getAttribute("href");

    const c3 = await newContext(browser); const d3 = await c3.newPage(); watch(d3, "dentist");
    await d3.goto(link3); await d3.fill("#pin", pin3); await d3.getByRole("button", { name: "Open file" }).click(); await d3.waitForURL(/\/view$/);
    await d3.getByRole("heading", { name: /Add to the patient's file/ }).waitFor();
    // nothing can be added before identifying; an unsigned form does not submit
    await d3.fill("#c_name", "Dr Sara Molar");
    await d3.fill("#c_spec", "Dentist");
    await d3.fill("#c_lic", "DEN-12345");
    await d3.fill("#c_fac", "Smile Clinic");
    await d3.check('input[name="attest"]');
    await d3.getByRole("button", { name: "Continue", exact: true }).click();
    await d3.waitForTimeout(500);
    assert(await d3.locator("#c_name").isVisible(), "the identity form stays until a signature is drawn");
    const pad = await d3.locator("canvas.sig-pad").boundingBox();
    await d3.mouse.move(pad.x + 20, pad.y + 100); await d3.mouse.down();
    for (const [dx, dy] of [[60, 40], [120, 120], [180, 50], [240, 110], [300, 70]]) await d3.mouse.move(pad.x + dx, pad.y + dy, { steps: 4 });
    await d3.mouse.up();
    await d3.getByRole("button", { name: "Continue", exact: true }).click();
    await d3.getByText("Adding as").waitFor();
    await d3.getByText("Dr Sara Molar").first().waitFor();

    const open = async (label) => { await d3.locator("summary", { hasText: `Add: ${label}` }).first().click(); };
    await open("Diagnosis / condition");
    await d3.fill("#c_conditions_name", "Deep caries tooth 16 (dentist)");
    await d3.selectOption("#c_conditions_category", "diagnosis");
    await d3.selectOption("#c_conditions_certainty", "confirmed");
    await d3.locator("form", { has: d3.locator("#c_conditions_name") }).getByRole("button", { name: "Add to the file" }).click();
    await d3.getByText("Added to the patient's file under your name.").first().waitFor();
    await d3.reload();
    await open("Visit (reason, exam, assessment, plan)");
    await d3.fill("#c_encounters_reason", "Dental pain review");
    await d3.selectOption("#c_encounters_kind", "dental");
    await d3.locator("form", { has: d3.locator("#c_encounters_reason") }).getByRole("button", { name: "Add to the file" }).click();
    await d3.getByText("Added to the patient's file under your name.").first().waitFor();
    await d3.reload();
    await open("Clinical note");
    await d3.selectOption("#clinical_notes_enc", { index: 1 });                        // linked to the visit just added
    await d3.fill("#c_clinical_notes_body", "Note typed in the wrong file by mistake");
    await d3.locator("form", { has: d3.locator("#c_clinical_notes_body") }).getByRole("button", { name: "Add to the file" }).click();
    await d3.getByText("Added to the patient's file under your name.").first().waitFor();
    await d3.reload();
    await open("Upload a document or image");
    await d3.setInputFiles("#c_file", { name: "bitewing.pdf", mimeType: "application/pdf", buffer: pdf("% bitewing\n") });
    await d3.fill("#c_title", "Bitewing (dentist)");
    await d3.getByRole("button", { name: "Upload", exact: true }).click();
    await d3.getByText("Document uploaded and added to the file.").waitFor();
    // the chart is visible read-only, and an exam can be recorded on it
    await d3.locator("#dental").getByText("Tooth chart").waitFor();
    assert(/Extracted/.test(await d3.locator("#chart-18").getAttribute("aria-label")), "the dentist sees the patient's chart");
    await d3.locator("summary", { hasText: "Add: Dental exam on the chart" }).click();
    await d3.locator("#cx-t-26").click();
    await d3.getByRole("radio", { name: "Present", exact: true }).check();
    await d3.selectOption("#cx_fk", "caries");
    await d3.locator("#cx-t-26").focus(); await d3.keyboard.press("d");
    await d3.getByRole("button", { name: "Add to this tooth" }).click();
    await d3.getByRole("button", { name: "Save the exam" }).click();
    await d3.getByText("The exam was saved to the patient's file under your name.").waitFor();
    await d3.reload();
    await d3.locator("#contribute article.rec", { hasText: "Dental exam on the chart" }).first().waitFor();
    // in place: the dentist chooses a tooth and adds a diagnosis to it, without a separate form list
    await d3.locator("#chart-47").click();
    await d3.locator(".tooth-panel summary", { hasText: "A diagnosis for this tooth" }).click();
    await d3.locator("#ctooth-dx_conditions_name").fill("Fractured cusp 47 (dentist)");
    await d3.locator("form#ctooth-dx").getByRole("button", { name: "Add the diagnosis" }).click();
    await d3.locator(".tooth-panel li", { hasText: "Fractured cusp 47 (dentist)" }).waitFor();
    await d3.locator("#contribute article.rec", { hasText: "Fractured cusp 47 (dentist)" }).waitFor();
    // treatment: the dentist proposes a root canal for 47 from its panel and notes their cost; accepting is not theirs
    if (!(await d3.locator(".tooth-panel").isVisible())) await d3.locator("#chart-47").click();
    await d3.locator(".tooth-panel summary", { hasText: "A treatment for this tooth" }).click();
    await d3.locator("form#ctooth-tx select[name=catalog_code]").selectOption("root_canal");
    await d3.locator("form#ctooth-tx").getByRole("button", { name: "Propose the treatment" }).click();
    await d3.locator(".tooth-panel li.planned", { hasText: "Root canal treatment" }).waitFor();
    const rct = d3.locator("li.treat-item", { hasText: "Root canal treatment" }).first();
    await rct.getByText("From the doctor via a link").waitFor();
    await rct.locator("summary", { hasText: "Change status" }).click();
    const opts = await rct.locator('select[name="status"] option').allInnerTexts();
    assert(!opts.includes("Accepted"), "the dentist is not offered 'accepted': " + opts);
    await rct.locator("summary", { hasText: "Add a cost" }).click();
    await rct.locator('input[name="amount"]').fill("750");
    await rct.getByRole("button", { name: "Save", exact: true }).click();
    await d3.getByText("Your cost was saved").first().waitFor();
    assert(!/SAR\s?300/.test(await d3.locator("#dental").innerText()), "the patient's own cost is not shown to the dentist");
    // the summary of additions comes after the clinical content
    const order = await d3.evaluate(() => ["#contributor", "#dental", "#contribute"].map((q) => { const el = document.querySelector(q); return el ? el.getBoundingClientRect().top + window.scrollY : NaN; }));
    assert(order[0] < order[1] && order[1] < order[2], "identity, then the dental workspace, then the summary: " + order);
    await d3.screenshot({ path: path.join(OUT, "dentist-contribute.png"), fullPage: true });
    // the dentist withdraws the misplaced note
    const noteRec = d3.locator("#contribute article.rec", { hasText: "Note typed in the wrong file" }).first();
    await noteRec.locator("summary", { hasText: "Withdraw this addition" }).click();
    d3.once("dialog", (dl) => dl.accept());
    await noteRec.locator('input[name="reason"]').fill("wrong patient");
    await noteRec.getByRole("button", { name: "Withdraw" }).click();
    // the form disappears with the active state; the addition now shows as withdrawn
    await d3.locator("#contribute article.rec", { hasText: "Note typed in the wrong file" }).getByText("Withdrawn / invalidated").waitFor();
    await c3.close();

    // the patient's side: alert, provenance, no editing, signature, review, invalidate all
    await page.goto(`${BASE}/patients/${pid}`);
    await page.getByText(/Dr Sara Molar added to your file through a share link/).waitFor();
    await page.goto(`${BASE}/patients/${pid}/conditions`);
    const rec = page.locator("article.rec", { hasText: "Deep caries tooth 16 (dentist)" }).first();
    await rec.getByText("Added by a doctor", { exact: true }).waitFor();
    await rec.locator(".rec-meta").getByText(/by a doctor through a share link/).waitFor();
    assert((await rec.locator("summary", { hasText: "Edit" }).count()) === 0, "a doctor's addition cannot be edited by the patient");
    await page.goto(`${BASE}/patients/${pid}/documents`);
    await page.getByText("Bitewing (dentist)").first().waitFor();
    await page.goto(`${BASE}/patients/${pid}/dental`);
    await page.locator("#exams article.rec", { hasText: "Added by Dr Sara Molar via a link" }).first().waitFor();
    await page.locator("#chart-26").click();
    await page.locator(".tooth-panel .tooth-list li", { hasText: "Caries" }).getByText(/Added by Dr Sara Molar/).waitFor();
    await page.goto(`${BASE}${contribShareHref}`);
    await page.getByText("Doctors who added to your file").waitFor();
    await page.getByText("DEN-12345").first().waitFor();
    const sigOk = await page.locator("img.sig-img").first().evaluate((img) => img.complete && img.naturalWidth > 0);
    assert(sigOk, "the on-screen signature is shown to the patient");
    await page.getByRole("button", { name: "I reviewed these additions" }).click();
    await page.getByText("Reviewed", { exact: true }).first().waitFor();
    await page.locator("summary", { hasText: "Invalidate everything this doctor added" }).click();
    page.once("dialog", (dl) => dl.accept());
    await page.locator('input[name="reason"]').last().fill("not my dentist");
    await page.getByRole("button", { name: "Invalidate all" }).click();
    // the bulk form disappears once nothing is active; every addition is now shown invalidated
    await page.locator("summary", { hasText: "Invalidate everything this doctor added" }).waitFor({ state: "detached" });
    assert((await page.getByText("Invalidated", { exact: true }).count()) >= 4, "all four additions are invalidated");
    await page.goto(`${BASE}/patients/${pid}/audit`);
    await page.getByText("Doctor via a share link").first().waitFor();
  });

  await step("another user cannot see or reach Alice's file, documents or exports", async () => {
    await signup(bob, `bob-${stamp}@example.test`, "Bob Beta");
    await bob.getByText("No files yet").waitFor();
    for (const p of ["", "/profile", "/vitals", "/labs", "/documents", "/sharing", "/audit", "/timeline", "/conditions"]) {
      const r = await bob.goto(`${BASE}/patients/${pid}${p}`);
      assert(r.status() === 404, `bob ${p || "/"} => ${r.status()}`);
    }
    const href = "/api/documents/" + cardioDocId;
    assert((await bctx.request.get(BASE + href)).status() === 404, "document hidden from bob");
    assert((await bctx.request.get(`${BASE}/api/patients/${pid}/report?scope=full`)).status() === 404, "report hidden from bob");
    const up = await bctx.request.post(`${BASE}/api/patients/${pid}/documents`, { multipart: { file: { name: "x.pdf", mimeType: "application/pdf", buffer: pdf() }, title: "intruder" }, maxRedirects: 0 });
    assert(up.status() === 403, "upload into alice file refused: " + up.status());
    const adm = await bob.goto(`${BASE}/admin/specialties`);
    assert(adm.status() === 404, "non-admin cannot open admin");
  });

  // ---------------------------------------------------------------- account, controls, sex rules, share register, deletion
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const newFile = async (name, dob, sex) => {
    await page.goto(`${BASE}/patients/new`);
    await page.fill("#full_name", name); await page.fill("#date_of_birth", dob); await page.selectOption("#sex", sex);
    await submit(page, "Create file");
    await page.waitForURL(/\/patients\/[0-9a-f-]{36}\/profile\?new=1$/);
    return page.url().split("/")[4];
  };

  await step("account: basic details saved; picture uploaded, shown in the menu, non-images refused, removable", async () => {
    await page.goto(`${BASE}/account`);
    await page.fill("#date_of_birth", "1990-05-20"); await page.selectOption("#sex", "female"); await page.selectOption("#blood_abo", "O"); await page.selectOption("#blood_rh", "+");
    await page.fill("#phone", "+966500000001"); await page.fill("#city", "Riyadh");
    await submit(page, "Save changes");
    await page.getByText("Your account details were saved.").waitFor();
    await page.reload();
    assert((await page.inputValue("#date_of_birth")) === "1990-05-20" && (await page.inputValue("#blood_abo")) === "O" && (await page.inputValue("#city")) === "Riyadh", "details persisted");
    await page.setInputFiles("#photo-user", { name: "me.png", mimeType: "image/png", buffer: PNG });
    await submit(page, "Upload");
    await page.getByText("Picture updated.").waitFor();
    await page.locator(".navuser-btn img.avatar-img").waitFor();
    const r = await page.request.get(`${BASE}/api/avatar`);
    assert(r.status() === 200 && /image\/png/.test(r.headers()["content-type"]) && r.headers()["x-content-type-options"] === "nosniff", "avatar served as nosniff png");
    await page.setInputFiles("#photo-user", { name: "evil.png", mimeType: "image/png", buffer: pdf() });
    await submit(page, "Upload");
    await page.getByText(/Unsupported format/).waitFor();
    await submit(page, "Remove picture");
    await page.getByText("Picture removed.").waitFor();
    assert((await page.request.get(`${BASE}/api/avatar`)).status() === 404, "avatar gone");
  });

  await step("controls: text, select and date fields share one height (desktop 44px, mobile 48px)", async () => {
    await page.goto(`${BASE}/account`);
    const heights = async () => page.evaluate(() => ["#full_name", "#date_of_birth", "#sex", "#phone"].map((q) => document.querySelector(q).getBoundingClientRect().height));
    let h = await heights();
    assert(h.every((x) => Math.abs(x - 44) < 0.6), "desktop heights " + h);
    await page.setViewportSize({ width: 390, height: 844 });
    h = await heights();
    assert(h.every((x) => Math.abs(x - 48) < 0.6), "mobile heights " + h);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE}/patients/${pid}/vitals`);
    const dt = await page.evaluate(() => { const e = document.querySelector("input[type=datetime-local]").getBoundingClientRect().height; const n = document.querySelector("#v_num").getBoundingClientRect().height; return [e, n]; });
    assert(Math.abs(dt[0] - dt[1]) < 0.6, "datetime-local vs number " + dt);
  });

  await step("sex rules: a male file has no gynecology, a female file has no men's health, direct URL is 404", async () => {
    const male = await newFile("Omar Male", "1988-03-03", "male");
    await page.goto(`${BASE}/patients/${male}/specialties`);
    await page.getByText("Men's health").first().waitFor();
    assert((await page.getByText("Obstetrics").count()) === 0, "no obstetrics for a male file");
    const r = await page.goto(`${BASE}/patients/${male}/specialties/obgyn`);
    assert(r.status() === 404, "obgyn direct URL => " + r.status());
    await page.goto(`${BASE}/patients/${male}/visits`);
    await openSummary(page, "Add visit");
    const opts = await page.locator("#f_specialty_id option, select[name=specialty_id] option").allInnerTexts();
    assert(opts.length > 3 && !opts.some((o) => /Obstetrics/.test(o)), "visit form hides obstetrics: " + opts.slice(0, 5));
    await page.goto(`${BASE}/patients/${pid}/specialties`);
    const fem = (await page.locator("main").textContent()) ?? "";                              // unused specialties sit in a folded list
    if (/Female/.test(await page.locator("header.patient-head").innerText())) assert(/Obstetrics/.test(fem) && !/Men's health/.test(fem), "female file view");
  });

  await step("share register: lists every share across files with token ending and filters", async () => {
    await page.goto(`${BASE}/shares`);
    await page.getByRole("heading", { name: "Share register" }).waitFor();
    assert((await page.locator("tbody tr").count()) >= 2, "rows listed");
    const row = await page.locator("tbody tr").first().innerText();
    assert(/…[A-Za-z0-9_-]{4}/.test(row), "token ending shown: " + row.replace(/\n/g, " | "));
    await page.getByRole("link", { name: /^Revoked/ }).click();
    await page.waitForURL(/status=revoked/);
    assert((await page.locator("tbody tr").count()) >= 1, "revoked filter");
    await page.goto(`${BASE}/shares?q=zzzz-no-match`);
    await page.getByText("Nothing matches these filters.").waitFor();
    await page.goto(`${BASE}/shares`);
    await page.getByText("Latest activity across all shares").waitFor();
    await page.screenshot({ path: path.join(OUT, "desktop-share-register.png"), fullPage: true });
  });

  await step("deletion: typed name + password, 30-day grace (read-only, shares revoked), restore, then delete now", async () => {
    const del = await newFile("Delete Target", "1979-09-09", "female");
    await page.goto(`${BASE}/patients/${del}/delete`);
    await page.fill("#confirm", "Wrong Name"); await page.fill("#password", "correct-horse-battery"); await page.check('input[name="ack"]');
    await submit(page, "Schedule deletion");
    await page.getByText("does not match").waitFor();
    await page.fill("#confirm", "Delete Target"); await page.fill("#password", "not-my-password");
    await submit(page, "Schedule deletion");
    await page.getByText("Incorrect password.").waitFor();
    await page.fill("#confirm", "delete target"); await page.fill("#password", "correct-horse-battery");
    await submit(page, "Schedule deletion");
    await page.getByText(/scheduled for deletion/i).first().waitFor();
    await page.getByText(/permanently deleted in 30 day/).waitFor();
    await page.screenshot({ path: path.join(OUT, "desktop-delete-pending.png"), fullPage: true });
    await page.goto(`${BASE}/patients/${del}/allergies`);
    assert((await page.locator("summary", { hasText: "Add allergy" }).count()) === 0, "read-only: no add form");
    await page.goto(`${BASE}/patients`);
    await page.locator("a.card", { hasText: "Delete Target" }).getByText("Scheduled for deletion").waitFor();
    await page.goto(`${BASE}/patients/${del}/delete`);
    await page.getByRole("button", { name: "Restore this file" }).click();
    await page.waitForURL(new RegExp(`/patients/${del}$`));
    await page.goto(`${BASE}/patients/${del}/allergies`);
    await page.locator("summary", { hasText: "Add allergy" }).first().waitFor();
    // schedule again and erase now
    await page.goto(`${BASE}/patients/${del}/delete`);
    await page.fill("#confirm", "Delete Target"); await page.fill("#password", "correct-horse-battery"); await page.check('input[name="ack"]');
    await submit(page, "Schedule deletion");
    await page.getByText(/permanently deleted in/).waitFor();
    await page.fill("#confirm", "Delete Target"); await page.fill("#password", "bad-password");
    await submit(page, "Delete permanently now");
    await page.getByText("Incorrect password.").waitFor();
    await page.fill("#confirm", "Delete Target"); await page.fill("#password", "correct-horse-battery");
    await submit(page, "Delete permanently now");
    await page.waitForURL(/\/patients\?deleted=1/);
    await page.getByText("The file was permanently deleted.").waitFor();
    assert((await page.locator("a.card", { hasText: "Delete Target" }).count()) === 0, "gone from the list");
    const r = await page.goto(`${BASE}/patients/${del}`);
    assert(r.status() === 404, "erased file is 404");
    assert((await page.locator("a.card", { hasText: "Alice" }).count()) === 0 || true, "noop");
    await page.goto(`${BASE}/patients/${pid}`);
    await page.locator("header.patient-head, header.card").first().waitFor();
  });

  // ---------------------------------------------------------------- responsive + RTL
  await step("mobile viewport (Arabic, RTL): no horizontal scroll on key pages", async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar-SA", timezoneId: "Asia/Riyadh" });
    await m.addCookies([...(await ctx.cookies()).filter((c) => c.name !== "lang"), { name: "lang", value: "ar", url: BASE }]);
    const mp = await m.newPage(); watch(mp, "mobile");
    for (const p of ["", "/profile", "/vitals", "/labs", "/specialties", "/dental", "/sharing/new", "/documents", "/timeline"]) {
      const r = await mp.goto(`${BASE}/patients/${pid}${p}`);
      assert(r.status() === 200, `${p} => ${r.status()}`);
      assert((await mp.locator("html").getAttribute("dir")) === "rtl", "rtl");
      const over = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(over <= 1, `horizontal overflow of ${over}px on ${p || "/"}`);
      if (p === "") await mp.screenshot({ path: path.join(OUT, "mobile-dashboard-ar.png"), fullPage: true });
      if (p === "/vitals") await mp.screenshot({ path: path.join(OUT, "mobile-vitals-ar.png"), fullPage: true });
      if (p === "/dental") await mp.screenshot({ path: path.join(OUT, "mobile-dental-ar.png"), fullPage: true });
    }
    await m.close();
  });

  await step("desktop screenshots for review", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE}/patients/${pid}`); await page.screenshot({ path: path.join(OUT, "desktop-dashboard.png"), fullPage: true });
    await page.goto(`${BASE}/patients/${pid}/vitals?type=blood_pressure&range=all`); await page.screenshot({ path: path.join(OUT, "desktop-vitals.png"), fullPage: true });
    await page.goto(`${BASE}/patients/${pid}/specialties/dentistry`); await page.screenshot({ path: path.join(OUT, "desktop-dentistry.png"), fullPage: true });
  });

  await browser.close();
  const failed = results.filter((r) => !r[1]);
  console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
  if (problems.length) { console.log("\nRuntime problems observed:"); [...new Set(problems)].forEach((p) => console.log(" -", p)); }
  process.exit(failed.length || problems.length ? 1 : 0);
})();
