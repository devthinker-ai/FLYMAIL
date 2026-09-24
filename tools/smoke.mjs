#!/usr/bin/env node
/** smoke.mjs — load MaleCNS brain in headed Chrome, verify, think 3 emails. */
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.env.MALEFLYMAIL_URL || "http://localhost:5176/";
const OUT = process.env.SMOKE_OUT || "media/smoke.json";

const t0 = Date.now();
const log = (...a) => console.log(`[smoke ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  args: [
    "--use-angle=metal",
    "--enable-unsafe-webgpu",
    "--no-first-run",
    "--user-data-dir=/tmp/maleflymail-smoke",
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  log("navigating", URL);
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 90_000 });

  log("waiting for brain load (210 MB, WebGPU)…");
  await page.waitForFunction(() => window.maleflymail?.ready === true, { timeout: 180_000 });
  log("READY — brain loaded");

  const meta = await page.evaluate(() => {
    const w = window.maleflymail;
    return {
      header: w.brain?.header,
      className: w.brain?.meta?.dataset,
      numNeurons: w.brain?.header?.numNeurons,
      numEdges: w.brain?.header?.numEdges,
    };
  });
  log("brain header:", JSON.stringify(meta));

  // 3 representative emails, one per category cluster
  const emails = [
    { id: "en-pay-01", from: "billing@acme.com", subject: "Your invoice #4821", body: "Dear customer, please find attached your invoice for September. Payment is due within 14 days. Kind regards, ACME Finance." },
    { id: "en-mtg-01", from: "lena@partner.de", subject: "Quick sync Thursday?", body: "Hi! Could we grab 30 min Thursday afternoon to align on the Q4 roadmap? I have two slots: 14:00 or 16:30. Let me know what works. Cheers, Lena" },
    { id: "de-cmp-01", from: "k.unterberger@kundengmbh.de", subject: "Lieferung verzögert — Beschwerde", body: "Sehr geehrte Damen und Herren, unsere Bestellung vom 12.09. ist bis heute nicht angekommen. Wir sind sehr unzufrieden und erwarten eine rasche Lösung. Mit freundlichen Grüßen, K. Unterberger" },
  ];

  const results = [];
  for (const em of emails) {
    const r = await page.evaluate(async (em) => {
      const w = window.maleflymail;
      const { report, readout, plan } = await w.think(em);
      return {
        category: readout?.category,
        trueCategory: em.category,
        dominantClass: report.dominantClass,
        globalRate: report.globalRate,
        motorLHz: report.motorLHz,
        motorRHz: report.motorRHz,
        totalSpikes: report.totalSpikes,
        plan: plan?.text ?? plan,
        replyLen: report.features?.length,
        elapsedMs: report.elapsedMs,
      };
    }, em);
    results.push(r);
    log(`think ${em.id}: readout=${r.category} (true=${em.trueCategory}) dominant=${r.dominantClass} globalRate=${r.globalRate.toFixed(2)} spikes=${r.totalSpikes} motorL/R=${r.motorLHz?.toFixed(2)}/${r.motorRHz?.toFixed(2)} (${r.elapsedMs?.toFixed(0)} ms)`);
  }

  const shot = await page.screenshot({ path: "media/smoke.png" });
  log("screenshot saved:", shot);
  log("page errors:", errors.length ? errors : "none");

  const fs = await import("node:fs");
  fs.mkdirSync("media", { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ t0: new Date(t0).toISOString(), results, errors }, null, 2));
  log("wrote", OUT);
} finally {
  await browser.close();
}
