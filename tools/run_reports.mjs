#!/usr/bin/env node
/**
 * Headed Chrome + WebGPU: walk training corpus one email at a time → data/reports.csv
 *
 *   MALEFLYMAIL_URL=http://127.0.0.1:5176 MALEFLYMAIL_HEADED=1 node tools/run_reports.mjs
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile, appendFile, access } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 5176;
const URL = process.env.MALEFLYMAIL_URL || `http://127.0.0.1:${PORT}`;
const HEADED = process.env.MALEFLYMAIL_HEADED !== "0";
const OUT = path.join(ROOT, "data", "reports.csv");

async function portOpen(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(true));
    s.once("listening", () => {
      s.close();
      resolve(false);
    });
    s.listen(port, "127.0.0.1");
  });
}

async function waitForServer(url, ms = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 404) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server not up: ${url}`);
}

async function main() {
  let child = null;
  const busy = await portOpen(PORT);
  if (!busy && !process.env.MALEFLYMAIL_URL) {
    console.log("starting vite…");
    let args = ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(PORT)];
    try {
      await access(path.join(ROOT, "dist", "index.html"));
    } catch {
      args = ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(PORT)];
    }
    child = spawn("npm", args, { cwd: ROOT, stdio: "inherit", shell: true });
  }

  try {
    await waitForServer(URL);
    console.log(`opening ${URL}`);

    const browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: HEADED ? false : "new",
      protocolTimeout: 600_000,
      args: [
        "--enable-unsafe-webgpu",
        "--ignore-gpu-blocklist",
        "--use-angle=metal",
        "--no-sandbox",
        "--disable-dev-shm-usage",
      ],
      defaultViewport: { width: 1280, height: 800 },
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(600_000);

    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
    console.log("waiting for brain + WebGPU…");
    await page.waitForFunction(() => window.maleflymail?.ready === true, {
      timeout: 300_000,
    });

    // Build corpus inside the page (uses same synthetic.ts)
    const corpus = await page.evaluate(async () => {
      // Re-import path not available; use dump via incremental API.
      // Expose corpus builder through flymail if present.
      if (window.maleflymail.buildCorpus) return window.maleflymail.buildCorpus(96);
      return null;
    });

    let emails = corpus;
    if (!emails) {
      // Fallback: ask page to return corpus via dumpReports helper we add
      emails = await page.evaluate(() => window.maleflymail.listCorpus(96));
    }

    console.log(`brain ready — ${emails.length} emails`);
    await mkdir(path.dirname(OUT), { recursive: true });
    const header = ["id", "category", ...Array.from({ length: 16 }, (_, i) => `f${i}`)].join(",");
    await writeFile(OUT, header + "\n");

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      const t0 = Date.now();
      const row = await page.evaluate(async (em) => {
        const { report } = await window.maleflymail.think(em);
        return [
          JSON.stringify(em.id),
          em.category,
          ...report.features.map((f) => Number(f).toFixed(8)),
        ].join(",");
      }, email);
      await appendFile(OUT, row + "\n");
      const ms = Date.now() - t0;
      if (i % 5 === 0 || i === emails.length - 1) {
        console.log(`[${i + 1}/${emails.length}] ${email.id} ${ms}ms → ${email.category}`);
      }
    }

    console.log(`wrote ${OUT}`);
    await browser.close();
  } finally {
    if (child) child.kill("SIGTERM");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
