import {
  OLLAMA_MAX_WORDS,
  OLLAMA_MODEL,
  OLLAMA_SEED,
  OLLAMA_TEMPERATURE,
  OLLAMA_TIMEOUT_MS,
  ollamaGenerateUrl,
} from "./config";
import { formatPlanForPrompt, type ReplyPlan } from "./plan";

export interface ComposeEmail {
  from: string;
  subject: string;
  body: string;
  address?: string;
}

export type ComposeResult =
  | { ok: true; text: string; model: string; elapsedMs: number }
  | { ok: false; reason: string };

const SYSTEM_PROMPT = `You draft the body of a short email reply. You receive a plan (intent, tone, length, whether to ask a question) and the incoming email. Use ONLY facts present in the incoming email (names, ticket numbers, amounts, dates). No meta commentary, no mentions of flies or simulations. Output the reply body only — no subject line, no signature (the app adds the signature). Maximum sentences are given in the plan's length field. Match the plan language (de = German, en = English).`;

/**
 * LLM pen: turn a fly plan + email into reply body text.
 * Failures are returned — never silently swapped for a template here.
 */
export async function composeReply(
  email: ComposeEmail,
  plan: ReplyPlan,
): Promise<ComposeResult> {
  const t0 = performance.now();
  const user = [
    "Plan:",
    formatPlanForPrompt(plan),
    "",
    "Incoming email:",
    `From: ${email.from}${email.address ? ` <${email.address}>` : ""}`,
    `Subject: ${email.subject}`,
    "",
    email.body,
  ].join("\n");

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const res = await fetch(ollamaGenerateUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        system: SYSTEM_PROMPT,
        prompt: user,
        stream: false,
        options: {
          temperature: OLLAMA_TEMPERATURE,
          seed: OLLAMA_SEED,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { ok: false, reason: `ollama HTTP ${res.status}` };
    }

    const data = (await res.json()) as { response?: string };
    const raw = (data.response ?? "").trim();
    if (!raw) return { ok: false, reason: "empty response" };

    const cleaned = enforceConstraints(raw, plan);
    if (!cleaned.ok) return cleaned;

    return {
      ok: true,
      text: cleaned.text,
      model: OLLAMA_MODEL,
      elapsedMs: performance.now() - t0,
    };
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "timeout"
          : e.message
        : String(e);
    return { ok: false, reason: msg };
  } finally {
    window.clearTimeout(timer);
  }
}

function enforceConstraints(
  raw: string,
  plan: ReplyPlan,
): { ok: true; text: string } | { ok: false; reason: string } {
  let text = raw.replace(/\r\n/g, "\n").trim();

  // Strip a leading "Subject:" / "Betreff:" line if the model adds one.
  text = text.replace(/^(?:Subject|Betreff)\s*:\s*.+\n+/i, "");

  // Strip trailing signature blocks the model invents.
  text = text.replace(
    /\n+(?:Best(?:\s+regards)?|Viele Grüße|Mit freundlichen Grüßen|Cheers|Thanks|Regards|MALEFLYMAIL)\s*,?\s*\n[\s\S]*$/i,
    "",
  );
  text = text.replace(/\n+[-–—]+\s*\n[\s\S]*$/u, "");
  text = text.trim();

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > OLLAMA_MAX_WORDS) {
    return { ok: false, reason: `too many words (${words.length})` };
  }

  const sentences = splitSentences(text);
  // Soft cap: if plan says N and model wrote more than N+2, truncate.
  const maxKeep = plan.length + 2;
  if (sentences.length > maxKeep) {
    text = sentences.slice(0, maxKeep).join(" ").trim();
  }

  if (!text) return { ok: false, reason: "empty after cleanup" };
  return { ok: true, text };
}

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/gu);
  if (!parts) return text ? [text] : [];
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** App-owned signature (LLM must not invent one). */
export function appendSignature(body: string, language: "en" | "de"): string {
  const sig = language === "de" ? "Viele Grüße\nFLYMAIL" : "Best,\nFLYMAIL";
  return `${body.trim()}\n\n${sig}`;
}
