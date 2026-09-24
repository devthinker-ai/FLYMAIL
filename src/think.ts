import type { Brain } from "./engine/brain";
import { FlySim } from "./engine/sim";
import { encodeEmail, tokenize } from "./encoder";
import { buildDriver, emailToExternal, type DriverPack } from "./driver";
import {
  CATEGORIES,
  FEATURE_DIM,
  MOTOR_CLASS,
  SUPER_CLASS_TABLE,
  THINK_CHUNK,
  THINK_STEPS,
  CLASS_PICK,
  NUM_SUPER_CLASSES,
  type Category,
} from "./constants";

export interface EmailLike {
  id: string;
  subject: string;
  body: string;
  from?: string;
}

export interface BrainReport {
  perClass: number[];
  totalSpikes: number;
  dominantClass: string;
  globalRate: number;
  motorLHz: number;
  motorRHz: number;
  heat: Float32Array;
  features: number[];
  steps: number;
  elapsedMs: number;
}

export interface ThinkProgress {
  step: number;
  totalSteps: number;
  heat: Float32Array;
  totalSpikes: number;
  motorLHz: number;
  motorRHz: number;
  perClass: number[];
}

export interface ThinkContext {
  brain: Brain;
  sim: FlySim;
  driver: DriverPack;
  motorL: Uint32Array;
  motorR: Uint32Array;
  classCounts: Uint32Array;
  durationSec: number;
}

/** Median of motor-neuron x positions → L/R split. */
export function splitMotorLR(brain: Brain): { motorL: Uint32Array; motorR: Uint32Array } {
  const sc = brain.neurons.superClass;
  const pos = brain.neurons.pos;
  const motorIdx: number[] = [];
  for (let i = 0; i < brain.header.numNeurons; i++) {
    if (sc[i] === MOTOR_CLASS) motorIdx.push(i);
  }
  const xs = motorIdx.map((i) => pos[3 * i]!);
  const sorted = xs.slice().sort((a, b) => a - b);
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) >> 1]!
        : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;

  const L: number[] = [];
  const R: number[] = [];
  for (const i of motorIdx) {
    if (pos[3 * i]! <= median) L.push(i);
    else R.push(i);
  }
  return { motorL: Uint32Array.from(L), motorR: Uint32Array.from(R) };
}

export async function createThinkContext(brain: Brain): Promise<ThinkContext> {
  const sim = await FlySim.create(brain);
  const driver = buildDriver(brain);
  const { motorL, motorR } = splitMotorLR(brain);
  const classCounts = new Uint32Array(NUM_SUPER_CLASSES);
  const sc = brain.neurons.superClass;
  for (let i = 0; i < brain.header.numNeurons; i++) classCounts[sc[i]!]!++;
  return {
    brain,
    sim,
    driver,
    motorL,
    motorR,
    classCounts,
    durationSec: (THINK_STEPS * sim.params.dtMs) / 1000,
  };
}

function accumulateFromRate(
  rate: Float32Array,
  brain: Brain,
  windowSteps: number,
  perClass: Float64Array,
  heat: Float32Array,
): number {
  const sc = brain.neurons.superClass;
  let total = 0;
  for (let i = 0; i < rate.length; i++) {
    const spikes = rate[i]! * windowSteps;
    heat[i]! += spikes;
    perClass[sc[i]!]! += spikes;
    total += spikes;
  }
  return total;
}

function motorHz(
  heat: Float32Array,
  indices: Uint32Array,
  durationSec: number,
): number {
  if (indices.length === 0 || durationSec <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < indices.length; i++) sum += heat[indices[i]!]!;
  return sum / indices.length / durationSec;
}

/** Token-overlap soft scores per category (deterministic; label-free at inference). */
const CAT_WORDS: Record<Category, string[]> = {
  payment: ["payment", "invoice", "zahlung", "rechnung", "deposit", "paid", "betrag", "cleared", "inv"],
  receipt: ["receipt", "purchase", "order", "beleg", "subscription", "total", "kaufbeleg", "bought"],
  digest: ["digest", "newsletter", "weekly", "unsubscribe", "roundup", "issue"],
  meeting: ["meeting", "calendar", "sync", "termin", "reschedule", "tuesday", "wednesday", "thursday", "slot"],
  complaint: ["complaint", "beschwerde", "unacceptable", "inakzeptabel", "ticket", "refund", "escalate", "waiting", "warte", "ignored", "frustrated"],
  personal: ["dinner", "coffee", "kaffee", "weekend", "photos", "hey", "thanks", "sonntag", "catching"],
};

export function tokenScores(email: EmailLike): number[] {
  const tokens = new Set(tokenize([email.from ?? "", email.subject, email.body].join("\n")));
  return CATEGORIES.map((cat) => {
    let n = 0;
    for (const w of CAT_WORDS[cat]) if (tokens.has(w)) n++;
    return n;
  });
}

/**
 * Feature vector (16):
 *  [0..9]   brain cascade — 6 class rates + global + motorL + motorR + driverTop1
 *  [10..15] deterministic token-overlap soft scores (one per category)
 */
function buildFeatures(
  perClass: Float64Array,
  classCounts: Uint32Array,
  totalSpikes: number,
  durationSec: number,
  N: number,
  motorLHz: number,
  motorRHz: number,
  heat: Float32Array,
  driverIndices: Uint32Array,
  email: EmailLike,
): number[] {
  const features = new Array<number>(FEATURE_DIM).fill(0);
  const classPick = CLASS_PICK;
  for (let i = 0; i < 6; i++) {
    const c = classPick[i]!;
    const n = classCounts[c]! || 1;
    features[i] = durationSec > 0 ? perClass[c]! / (durationSec * n) : 0;
  }
  features[6] = durationSec > 0 ? totalSpikes / (durationSec * N) : 0;
  features[7] = motorLHz;
  features[8] = motorRHz;

  let top1 = 0;
  const invDur = durationSec > 0 ? 1 / durationSec : 0;
  for (let k = 0; k < driverIndices.length; k++) {
    const r = heat[driverIndices[k]!]! * invDur;
    if (r > top1) top1 = r;
  }
  features[9] = top1;

  const tok = tokenScores(email);
  for (let i = 0; i < 6; i++) features[10 + i] = tok[i]!;

  for (let i = 0; i < 10; i++) {
    features[i] = Math.round(features[i]! * 1e4) / 1e4;
  }
  return features;
}

/** Run T LIF steps with constant external drive from the email encoding. */
export async function think(
  ctx: ThinkContext,
  email: EmailLike,
  onProgress?: (p: ThinkProgress) => void,
  steps: number = THINK_STEPS,
): Promise<BrainReport> {
  const t0 = performance.now();
  const { brain, sim, driver, motorL, motorR, classCounts } = ctx;
  const N = brain.header.numNeurons;
  const encoding = encodeEmail(email);
  const ext = emailToExternal(encoding, driver, N, 3.0);

  sim.reset();
  sim.setExternalInput(ext);

  const heat = new Float32Array(N);
  const perClass = new Float64Array(NUM_SUPER_CLASSES);
  let totalSpikes = 0;
  const durationSec = (steps * sim.params.dtMs) / 1000;

  let done = 0;
  while (done < steps) {
    const chunk = Math.min(THINK_CHUNK, steps - done);
    const rate = await sim.captureRollingRate(chunk);
    totalSpikes += accumulateFromRate(rate, brain, chunk, perClass, heat);
    done += chunk;

    if (onProgress) {
      const elapsedFrac = done / steps;
      const durSoFar = durationSec * elapsedFrac || 1e-6;
      onProgress({
        step: done,
        totalSteps: steps,
        heat,
        totalSpikes,
        motorLHz: motorHz(heat, motorL, durSoFar),
        motorRHz: motorHz(heat, motorR, durSoFar),
        perClass: Array.from(perClass),
      });
    }
  }

  const motorLHz = motorHz(heat, motorL, durationSec);
  const motorRHz = motorHz(heat, motorR, durationSec);
  const features = buildFeatures(
    perClass,
    classCounts,
    totalSpikes,
    durationSec,
    N,
    motorLHz,
    motorRHz,
    heat,
    driver.indices,
    email,
  );

  let domIdx = 0;
  for (let c = 1; c < NUM_SUPER_CLASSES; c++) {
    if (perClass[c]! > perClass[domIdx]!) domIdx = c;
  }

  return {
    perClass: Array.from(perClass),
    totalSpikes,
    dominantClass: SUPER_CLASS_TABLE[domIdx]!,
    globalRate: totalSpikes / durationSec / N,
    motorLHz,
    motorRHz,
    heat,
    features,
    steps,
    elapsedMs: performance.now() - t0,
  };
}
