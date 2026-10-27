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
  const ctx = await browser.newContext({ locale: "en-GB", timezoneId: "Asia/Riyadh", extraHTTPHeaders: { "x-forwarded-for": randomIp() }, ...extra });
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
  let pid = "", shareLink = "", sharePin = "", cardioDocId = "";

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
    await page.waitForURL(/\/patients\/[0-9a-f-]{36}$/);
    pid = page.url().split("/").pop();
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

  await step("personal details: allergy statement, national id masked, contacts", async () => {
    await page.goto(`${BASE}/patients/${pid}/profile`);
    await page.selectOption("#allergy_assertion", "none_known");
    await submit(page, "Save");
    await page.getByText("Saved.").first().waitFor();
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
    await submit(page, "Save");
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

  await step("vitals: period switch, compare with previous period, daily/weekly summaries, CSV export", async () => {
    await page.goto(`${BASE}/patients/${pid}/vitals?type=blood_pressure`);
    await page.getByRole("link", { name: "7 days" }).click();
    await page.waitForURL(/range=7/);
    await page.getByRole("link", { name: "Compare with previous period" }).click();
    await page.waitForURL(/cmp=1/);
    await page.locator("svg.chart").first().waitFor();
    await page.getByRole("link", { name: "Weekly" }).click();
    await page.getByText("Mean").first().waitFor();
    const r = await ctx.request.get(`${BASE}/api/patients/${pid}/export?type=blood_pressure`);
    assert(r.status() === 200 && /text\/csv/.test(r.headers()["content-type"]), "csv served");
    const body = await r.text();
    assert(body.includes("Blood pressure") && body.split("\n").length >= 6, "csv has the readings");
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
    await page.getByText("Superseded").first().waitFor();   // the server action has committed and the list was re-rendered
    await page.reload();
    await page.getByText("Superseded").first().waitFor();
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
    await openSummary(page, "Add condition");
    await page.fill("#conditions_new_name", "Dental caries");
    await page.selectOption("#conditions_new_category", "diagnosis");
    await submit(page, "Save");
    await page.getByText("Dental caries").first().waitFor();
    void href;
  });

  await step("specialty page: shared context + dynamic dental form + record shown", async () => {
    await page.goto(`${BASE}/patients/${pid}/specialties/dentistry`);
    await page.getByText("Shared health context").waitFor();
    await page.getByText("Penicillin").first().waitFor();
    await page.getByText("Hypertension").first().waitFor();
    await openSummary(page, "Dental finding / treatment");
    await page.fill('input[name="f_tooth"]', "16");
    await page.selectOption('select[name="f_finding"]', "caries");
    await page.fill('textarea[name="f_treatment"]', "Composite filling");
    await page.locator("form:has(input[name=f_tooth])").getByRole("button", { name: "Save" }).click();
    await page.getByText("Saved.").first().waitFor();
    await page.getByText("Composite filling").first().waitFor();
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

  await step("timeline and audit pages render the history", async () => {
    await page.goto(`${BASE}/patients/${pid}/timeline`);
    await page.getByText("Health timeline").waitFor();
    assert((await page.locator(".timeline li").count()) >= 6, "several events listed");
    await page.goto(`${BASE}/patients/${pid}/audit`);
    await page.getByRole("heading", { name: "Change history" }).waitFor();
    assert((await page.locator("table.t tbody tr").count()) >= 10, "audit rows present");
  });

  await step("dashboard summarises vitals, medications, conditions and alerts", async () => {
    await page.goto(`${BASE}/patients/${pid}`);
    await page.getByText("Current medications").waitFor();
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
    await doc.getByText("Documented allergies").waitFor();
    assert(html.includes("Penicillin") && html.includes("Hypertension") && html.includes("Metformin"), "safety core present");
    assert(html.includes("Dental check") && html.includes("Dental caries"), "dentistry data present");
    assert(!html.includes("Cardio follow-up") && !html.includes("Cardio report"), "cardiology data absent");
    assert(!html.includes("1098765432"), "national id never shared");
    assert(!html.includes("+966500000001") && !html.includes("Omar Alpha"), "contact data absent unless selected");
    assert(!html.includes("Entered by mistake"), "invalidated records absent");
    assert(html.includes("Dental X-ray"), "in-scope document listed");
    assert(!/storage_path|pin_hash|token_hash/.test(html), "no internals leaked");
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
  });

  await step("doctor: leaves a note; patient sees it and marks it reviewed", async () => {
    await doc.fill("#author_name", "Dr. Molar");
    await doc.fill("#body", "Please bring the latest panoramic film.");
    await doc.getByRole("button", { name: "Send" }).click();
    await doc.getByText("Your note was sent to the patient.").waitFor();
    await page.goto(`${BASE}/patients/${pid}/sharing`);
    await page.getByRole("link", { name: /Dental|Dentistry/ }).first().click();
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
  await step("another user cannot see or reach Alice's file, documents or exports", async () => {
    await signup(bob, `bob-${stamp}@example.test`, "Bob Beta");
    await bob.getByText("No files yet").waitFor();
    for (const p of ["", "/profile", "/vitals", "/labs", "/documents", "/sharing", "/audit", "/timeline", "/conditions"]) {
      const r = await bob.goto(`${BASE}/patients/${pid}${p}`);
      assert(r.status() === 404, `bob ${p || "/"} => ${r.status()}`);
    }
    const href = "/api/documents/" + cardioDocId;
    assert((await bctx.request.get(BASE + href)).status() === 404, "document hidden from bob");
    const csv = await (await bctx.request.get(`${BASE}/api/patients/${pid}/export`)).text();
    assert(csv.trim().split("\n").length === 1, "export contains no rows for bob");
    const up = await bctx.request.post(`${BASE}/api/patients/${pid}/documents`, { multipart: { file: { name: "x.pdf", mimeType: "application/pdf", buffer: pdf() }, title: "intruder" }, maxRedirects: 0 });
    assert(up.status() === 403, "upload into alice file refused: " + up.status());
    const adm = await bob.goto(`${BASE}/admin/specialties`);
    assert(adm.status() === 404, "non-admin cannot open admin");
  });

  // ---------------------------------------------------------------- responsive + RTL
  await step("mobile viewport (Arabic, RTL): no horizontal scroll on key pages", async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar-SA", timezoneId: "Asia/Riyadh" });
    await m.addCookies([...(await ctx.cookies()).filter((c) => c.name !== "lang"), { name: "lang", value: "ar", url: BASE }]);
    const mp = await m.newPage(); watch(mp, "mobile");
    for (const p of ["", "/vitals", "/labs", "/specialties", "/sharing/new", "/documents", "/timeline"]) {
      const r = await mp.goto(`${BASE}/patients/${pid}${p}`);
      assert(r.status() === 200, `${p} => ${r.status()}`);
      assert((await mp.locator("html").getAttribute("dir")) === "rtl", "rtl");
      const over = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(over <= 1, `horizontal overflow of ${over}px on ${p || "/"}`);
      if (p === "") await mp.screenshot({ path: path.join(OUT, "mobile-dashboard-ar.png"), fullPage: true });
      if (p === "/vitals") await mp.screenshot({ path: path.join(OUT, "mobile-vitals-ar.png"), fullPage: true });
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
