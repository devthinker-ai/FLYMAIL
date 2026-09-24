#!/usr/bin/env node
/**
 * Localhost-only IMAP companion for MALEFLYMAIL Live mode.
 * Fetches recent mail from Gmail + IONOS. Never sends.
 * Bind: 127.0.0.1 only. Secrets from server/.env (gitignored).
 */
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv(join(__dirname, ".env"));

const PORT = Number(process.env.MAIL_PORT || 5177);
const LIMIT = Math.max(1, Number(process.env.INBOX_LIMIT || 30));

function loadEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function accountConfigs() {
  const accounts = [];
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    accounts.push({
      provider: "gmail",
      host: "imap.gmail.com",
      port: 993,
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, ""),
    });
  }
  if (process.env.IONOS_USER && process.env.IONOS_PASSWORD) {
    accounts.push({
      provider: "ionos",
      host: process.env.IONOS_HOST || "imap.ionos.de",
      port: Number(process.env.IONOS_PORT || 993),
      user: process.env.IONOS_USER,
      pass: process.env.IONOS_PASSWORD,
    });
  }
  return accounts;
}

function detectLang(text) {
  return /[äöüß]/i.test(text) ? "de" : "en";
}

function parseFrom(from) {
  if (!from) return { name: "Unknown", address: "" };
  if (typeof from === "object" && from.value?.[0]) {
    const v = from.value[0];
    return {
      name: (v.name || v.address || "Unknown").trim(),
      address: (v.address || "").trim(),
    };
  }
  const s = String(from);
  const m = s.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (m) {
    return {
      name: (m[1].replace(/^["']|["']$/g, "").trim() || m[2]).trim(),
      address: m[2].trim(),
    };
  }
  return { name: s.trim() || "Unknown", address: s.includes("@") ? s.trim() : "" };
}

async function fetchAccount(cfg, perAccountLimit) {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });

  const emails = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const exists = client.mailbox?.exists ?? 0;
      if (exists === 0) return emails;

      const start = Math.max(1, exists - perAccountLimit + 1);
      const range = `${start}:${exists}`;

      for await (const msg of client.fetch(range, {
        uid: true,
        envelope: true,
        source: true,
      })) {
        let subject = msg.envelope?.subject || "(no subject)";
        let fromName = msg.envelope?.from?.[0]?.name || "";
        let fromAddr = msg.envelope?.from?.[0]?.address || "";
        let body = "";

        if (msg.source) {
          try {
            const parsed = await simpleParser(msg.source);
            subject = parsed.subject || subject;
            const pf = parseFrom(parsed.from);
            fromName = pf.name || fromName;
            fromAddr = pf.address || fromAddr;
            body = (parsed.text || "").trim();
            if (!body && parsed.html) {
              body = String(parsed.html)
                .replace(/<style[\s\S]*?<\/style>/gi, "")
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            }
          } catch {
            /* keep envelope fields */
          }
        }

        if (body.length > 8000) body = body.slice(0, 8000) + "…";
        const blob = `${subject}\n${body}`;
        const date = msg.envelope?.date
          ? new Date(msg.envelope.date).toISOString()
          : new Date(0).toISOString();

        emails.push({
          id: `${cfg.provider}-${msg.uid}`,
          uid: msg.uid,
          provider: cfg.provider,
          from: fromName || fromAddr || "Unknown",
          address: fromAddr || `${cfg.provider}@local`,
          subject,
          body: body || "(empty body)",
          lang: detectLang(blob),
          category: "personal",
          date,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch {
      /* */
    }
  }
  return emails;
}

async function buildInbox() {
  const accounts = accountConfigs();
  if (accounts.length === 0) {
    return {
      emails: [],
      errors: [
        {
          provider: "config",
          message:
            "No accounts configured. Copy server/.env.example → server/.env and fill Gmail / IONOS credentials.",
        },
      ],
      accounts: { gmail: false, ionos: false },
    };
  }

  const per = Math.ceil(LIMIT / accounts.length) + 5;
  const results = await Promise.allSettled(
    accounts.map((a) => fetchAccount(a, per)),
  );

  const emails = [];
  const errors = [];
  const status = { gmail: false, ionos: false };

  results.forEach((r, i) => {
    const provider = accounts[i].provider;
    if (r.status === "fulfilled") {
      status[provider] = true;
      emails.push(...r.value);
    } else {
      status[provider] = false;
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      errors.push({ provider, message: msg });
      console.error(`[mail] ${provider} failed:`, msg);
    }
  });

  emails.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return {
    emails: emails.slice(0, LIMIT),
    errors,
    accounts: status,
  };
}

async function probeAccount(cfg) {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
  try {
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    const accounts = accountConfigs();
    const probes = {};
    for (const a of accounts) {
      probes[a.provider] = await probeAccount(a);
    }
    const configured = {
      gmail: accounts.some((a) => a.provider === "gmail"),
      ionos: accounts.some((a) => a.provider === "ionos"),
    };
    sendJson(res, 200, {
      ok: true,
      configured,
      accounts: probes,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/inbox") {
    try {
      const payload = await buildInbox();
      sendJson(res, 200, payload);
    } catch (e) {
      sendJson(res, 500, {
        emails: [],
        errors: [
          {
            provider: "server",
            message: e instanceof Error ? e.message : String(e),
          },
        ],
        accounts: { gmail: false, ionos: false },
      });
    }
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  const accounts = accountConfigs();
  console.log(
    `MALEFLYMAIL mail companion on http://127.0.0.1:${PORT} (${accounts.map((a) => a.provider).join(", ") || "no accounts"})`,
  );
});
