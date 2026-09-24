import { CATEGORIES, FEATURE_DIM, type Category } from "./constants";
import { encodeEmail } from "./encoder";
import bundledReadout from "../public/readout.json";

export interface ReadoutModel {
  coefficients: number[][];
  intercept: number[];
  featureMean: number[];
  featureStd: number[];
  accuracy: number;
  confusion: number[][];
  categories: string[];
  nTrain?: number;
  nHoldout?: number;
  transform?: string;
  source?: string;
}

export interface ReadoutResult {
  category: Category;
  scores: number[];
  logits: number[];
  usedFallback: boolean;
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/** Pure matrix-vector inference. No training in the browser. */
export function classifyFeatures(
  features: number[],
  model: ReadoutModel | null,
): ReadoutResult {
  if (!model || !model.coefficients || model.coefficients.length !== 6) {
    return hashFallback(features);
  }

  const x = new Array<number>(FEATURE_DIM);
  for (let i = 0; i < FEATURE_DIM; i++) {
    let transformed = features[i]!;
    if (model.transform === "log1p" && i < 10) {
      transformed = Math.log1p(Math.max(0, transformed));
    }
    const std = model.featureStd[i]! || 1;
    x[i] = (transformed - model.featureMean[i]!) / std;
  }

  const logits = new Array<number>(6);
  for (let c = 0; c < 6; c++) {
    let s = model.intercept[c]!;
    const row = model.coefficients[c]!;
    for (let i = 0; i < FEATURE_DIM; i++) s += row[i]! * x[i]!;
    logits[c] = s;
  }
  const scores = softmax(logits);
  let best = 0;
  for (let c = 1; c < 6; c++) if (scores[c]! > scores[best]!) best = c;
  return {
    category: CATEGORIES[best]!,
    scores,
    logits,
    usedFallback: false,
  };
}

function hashFallback(features: number[]): ReadoutResult {
  let h = 0x811c9dc5;
  for (const f of features) {
    const bits = floatToU32(f);
    h ^= bits;
    h = Math.imul(h, 0x01000193);
  }
  const logits = CATEGORIES.map((_, i) => ((h >>> (i * 5)) & 31) / 31);
  const scores = softmax(logits);
  let best = 0;
  for (let c = 1; c < 6; c++) if (scores[c]! > scores[best]!) best = c;
  return {
    category: CATEGORIES[best]!,
    scores,
    logits,
    usedFallback: true,
  };
}

function floatToU32(f: number): number {
  const buf = new ArrayBuffer(4);
  new Float32Array(buf)[0] = f;
  return new Uint32Array(buf)[0]!;
}

export async function loadReadout(
  url = "/readout.json",
): Promise<ReadoutModel | null> {
  try {
    const r = await fetch(url);
    if (r.ok) return (await r.json()) as ReadoutModel;
  } catch {
    /* fall through */
  }
  const bundled = bundledReadout as ReadoutModel;
  if (bundled?.coefficients?.length === 6) return bundled;
  return null;
}

export function encodingHint(subject: string, body: string): Float32Array {
  return encodeEmail({ subject, body });
}
