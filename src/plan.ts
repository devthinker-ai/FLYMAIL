import type { Category } from "./constants";
import type { ReadoutResult } from "./readout";
import type { BrainReport } from "./think";

export type PlanLanguage = "en" | "de";
export type Tone =
  | "de-escalating"
  | "confirming"
  | "grateful"
  | "brisk"
  | "warm"
  | "curious";

export interface ReplyPlan {
  category: Category;
  scores: number[];
  tone: Tone;
  /** Target sentence count for the reply body (before signature). */
  length: 1 | 2 | 3;
  ask: boolean;
  language: PlanLanguage;
}

interface BasePlan {
  tone: Tone;
  length: 1 | 2 | 3;
  ask: boolean;
}

/** Exhaustive category defaults — the fly's "character" prior. */
const BASE_BY_CATEGORY: Record<Category, BasePlan> = {
  payment: { tone: "confirming", length: 2, ask: true },
  receipt: { tone: "grateful", length: 1, ask: false },
  digest: { tone: "brisk", length: 1, ask: false },
  meeting: { tone: "warm", length: 2, ask: true },
  complaint: { tone: "de-escalating", length: 2, ask: true },
  personal: { tone: "curious", length: 2, ask: true },
};

type AsymBand = "L" | "R" | "bal";
type RateBand = "lo" | "mid" | "hi";

function asymBand(motorLHz: number, motorRHz: number): AsymBand {
  const d = motorLHz - motorRHz;
  if (d > 10) return "L";
  if (d < -10) return "R";
  return "bal";
}

function rateBand(globalRate: number): RateBand {
  if (globalRate > 5) return "hi";
  if (globalRate > 3) return "mid";
  return "lo";
}

/**
 * Pure, deterministic plan from readout + brain report.
 * Category/language stay byte-identical to Phase 2 classification;
 * tone/length/ask are a fixed table over (category, dominantClass, motor
 * asymmetry, globalRate bands).
 */
export function buildPlan(
  email: { lang?: string },
  readout: ReadoutResult,
  report: Pick<BrainReport, "dominantClass" | "globalRate" | "motorLHz" | "motorRHz">,
): ReplyPlan {
  const language: PlanLanguage = email.lang === "de" ? "de" : "en";
  const base = { ...BASE_BY_CATEGORY[readout.category] };
  const asym = asymBand(report.motorLHz, report.motorRHz);
  const rate = rateBand(report.globalRate);
  const dom = report.dominantClass;

  // Motor-heavy cascade → slightly longer; optic/sensory-heavy → brisker.
  if (dom === "motor" || dom === "descending") {
    if (base.length < 3) base.length = (base.length + 1) as 1 | 2 | 3;
  } else if (dom === "optic" || dom === "sensory" || dom === "visual_projection") {
    if (base.length > 1) base.length = (base.length - 1) as 1 | 2 | 3;
  }

  // L-bias → prefer a closing question; R-bias → drop it when optional.
  if (asym === "L") base.ask = true;
  else if (asym === "R" && readout.category !== "complaint") base.ask = false;

  // High global rate → shorten one step (busy brain → brief reply).
  if (rate === "hi" && base.length > 1) {
    base.length = (base.length - 1) as 1 | 2 | 3;
  } else if (rate === "lo" && base.length < 3 && readout.category === "complaint") {
    base.length = (base.length + 1) as 1 | 2 | 3;
  }

  // Clamp: receipt/digest stay short even after modifiers.
  if (readout.category === "digest" || readout.category === "receipt") {
    base.length = 1;
  }

  return {
    category: readout.category,
    scores: readout.scores.slice(),
    tone: base.tone,
    length: base.length,
    ask: base.ask,
    language,
  };
}

/** One-line readout display: "tone=de-escalating · 2 sentences · asks question · de" */
export function formatPlanLine(plan: ReplyPlan): string {
  const ask = plan.ask ? "asks question" : "no question";
  const unit = plan.length === 1 ? "sentence" : "sentences";
  return `tone=${plan.tone} · ${plan.length} ${unit} · ${ask} · ${plan.language}`;
}

/** Plain lines for the LLM user prompt. */
export function formatPlanForPrompt(plan: ReplyPlan): string {
  return [
    `intent: ${plan.category}`,
    `tone: ${plan.tone}`,
    `length: ${plan.length} sentences`,
    `ask_question: ${plan.ask ? "yes" : "no"}`,
    `language: ${plan.language}`,
  ].join("\n");
}
