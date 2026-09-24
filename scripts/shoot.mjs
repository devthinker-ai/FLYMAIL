#!/usr/bin/env node
/**
 * Screenshots for Phase 2 + 2.5:
 *   hero, classify, locked, llm-de, toggle, fallback
 * Updates media/shoot-log.json with fly-only + LLM-pen entries.
 */
import { spawn } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
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
const MEDIA = path.join(ROOT, "media");
const SKIP_FALLBACK = process.env.MALEFLYMAIL_SKIP_FALLBACK === "1";

const TARGETS = [
  { id: "de-cmp-01", label: "German complaint" },
  { id: "en-mtg-01", label: "EN meeting" },
  { id: "en-pay-01", label: "EN payment" },
];

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
      /* */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server not up: ${url}`);
}

async function clickEmail(page, id) {
  const subjects = {
    "de-cmp-01": "Immer noch keine Antwort",
    "en-mtg-01": "Confirming our meeting",
    "en-pay-01": "Payment confirmation — INV-44821",
    "en-rcp-01": "Receipt for your Cloud subscription",
  };
  const needle = subjects[id];
  await page.evaluate((needle) => {
    const rows = [...document.querySelectorAll(".email-row")];
    const hit = rows.find((r) => (r.textContent || "").includes(needle));
    if (!hit) throw new Error("email not found: " + needle);
    hit.click();
  }, needle);
}

async function setPen(page, mode) {
  await page.evaluate((m) => {
    window.maleflymail?.setPenMode?.(m);
  }, mode);
  await page.waitForFunction(
    (m) => window.maleflymail?.penMode === m,
    { timeout: 5_000 },
    mode,
  );
  // Let React flush reply recompose
  await new Promise((r) => setTimeout(r, 400));
}

async function runBrain(page) {
  await page.click('[data-testid="run-brain"]');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="reply-card"]')?.dataset.phase === "done",
    { timeout: 120_000 },
  );
  // LLM pen may still be writing after phase=done
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-testid="run-brain"]');
      return btn && !btn.disabled;
    },
    { timeout: 120_000 },
  );
  await new Promise((r) => setTimeout(r, 300));
}

async function waitForLlmOrFallback(page) {
  await page.waitForFunction(
    () => {
      const card = document.querySelector('[data-testid="reply-card"]');
      if (!card || card.dataset.phase !== "done") return false;
      if (card.dataset.pen !== "llm") return true;
      const badge = document.querySelector('[data-testid="llm-badge"]');
      const fb = document.querySelector('[data-testid="llm-fallback"]');
      return !!(badge || fb);
    },
    { timeout: 120_000 },
  );
}

async function main() {
  await mkdir(MEDIA, { recursive: true });
  let child = null;
  if (!(await portOpen(PORT)) && !process.env.MALEFLYMAIL_URL) {
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
    const browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: false,
      args: [
        "--enable-unsafe-webgpu",
        "--ignore-gpu-blocklist",
        "--use-angle=metal",
        "--no-sandbox",
      ],
      defaultViewport: { width: 1440, height: 900 },
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(300_000);
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.maleflymail?.ready === true, {
      timeout: 300_000,
    });

    // --- Fly only: German complaint hero ---
    await setPen(page, "fly");
    await clickEmail(page, TARGETS[0].id);
    await runBrain(page);
    await page.screenshot({
      path: path.join(MEDIA, "hero.png"),
      fullPage: false,
    });

    const box = await page.$('[data-testid="classify-box"]');
    if (box) {
      await box.screenshot({ path: path.join(MEDIA, "classify.png") });
    } else {
      await page.screenshot({
        path: path.join(MEDIA, "classify.png"),
        clip: { x: 1100, y: 60, width: 320, height: 520 },
      });
    }

    // Collect fly-only results for 3 targets
    const results = [];
    for (const t of TARGETS) {
      await setPen(page, "fly");
      await clickEmail(page, t.id);
      await runBrain(page);
      const bundle = await page.evaluate(() => window.maleflymail.getLast());
      results.push({
        label: t.label,
        id: t.id,
        mode: "fly",
        ...bundle,
      });
      console.log("[fly]", t.label, "→", bundle?.category, bundle?.planLine);
    }

    // --- Toggle shot (contrast readable) ---
    await page.screenshot({
      path: path.join(MEDIA, "toggle.png"),
      fullPage: false,
    });

    // --- LLM pen: German complaint ---
    await clickEmail(page, "de-cmp-01");
    await runBrain(page); // ensure cache for this email
    await setPen(page, "llm");
    await waitForLlmOrFallback(page);
    await page.screenshot({
      path: path.join(MEDIA, "llm-de.png"),
      fullPage: false,
    });
    const llmDe = await page.evaluate(() => window.maleflymail.getLast());
    results.push({
      label: "German complaint (LLM pen)",
      id: "de-cmp-01",
      mode: "llm",
      ...llmDe,
    });
    console.log("[llm]", "de-cmp-01", llmDe?.llmFallback ? "FALLBACK" : llmDe?.llm);

    // LLM entries for remaining two (toggle only — brain cached if same session
    // but email switch clears UI; re-run brain then switch to llm)
    for (const t of TARGETS.slice(1)) {
      await setPen(page, "fly");
      await clickEmail(page, t.id);
      await runBrain(page);
      const flyBundle = await page.evaluate(() => window.maleflymail.getLast());
      await setPen(page, "llm");
      await waitForLlmOrFallback(page);
      const llmBundle = await page.evaluate(() => window.maleflymail.getLast());
      results.push({
        label: `${t.label} (LLM pen)`,
        id: t.id,
        mode: "llm",
        ...llmBundle,
        scoresFly: flyBundle?.scores,
      });
      console.log("[llm]", t.label, "→", llmBundle?.category, llmBundle?.llm);
    }

    // Locked screenshot
    await setPen(page, "fly");
    await clickEmail(page, "en-rcp-01");
    await page.click('[data-testid="run-brain"]');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="reply-card"]')?.dataset.phase === "running",
      { timeout: 30_000 },
    );
    await page.screenshot({ path: path.join(MEDIA, "locked.png"), fullPage: false });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="reply-card"]')?.dataset.phase === "done",
      { timeout: 120_000 },
    );

    // Fallback: kill reachability by pointing at a dead port via page evaluate override
    if (!SKIP_FALLBACK) {
      await page.evaluate(() => {
        const orig = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const url = typeof input === "string" ? input : input.url;
          if (url.includes("11434") || url.includes("/ollama/")) {
            return Promise.reject(new Error("simulated ollama down"));
          }
          return orig(input, init);
        };
      });
      await clickEmail(page, "de-cmp-01");
      await runBrain(page);
      await setPen(page, "llm");
      await page.waitForSelector('[data-testid="llm-fallback"]', { timeout: 60_000 });
      await page.screenshot({
        path: path.join(MEDIA, "fallback.png"),
        fullPage: false,
      });
      console.log("[fallback] captured media/fallback.png");
    }

    await writeJson(path.join(MEDIA, "shoot-log.json"), results);
    await browser.close();
    console.log(
      "screenshots → media/hero.png, classify.png, locked.png, llm-de.png, toggle.png, fallback.png",
    );
  } finally {
    if (child) child.kill("SIGTERM");
  }
}

async function writeJson(p, obj) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(p, JSON.stringify(obj, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
