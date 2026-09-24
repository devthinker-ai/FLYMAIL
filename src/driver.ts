import type { Brain } from "./engine/brain";
import { DRIVER_CLASSES, DRIVER_COUNT, HASH_DIM } from "./constants";

/** Mulberry32 — deterministic PRNG from a 32-bit seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DRIVER_SEED = 0xf1a001a1;
const PROJ_SEED = 0xf1a002b2;

export interface DriverPack {
  /** 256 neuron indices (sensory / visual_projection / optic weighted). */
  indices: Uint32Array;
  /** 64 × 256 projection matrix, row-major. */
  projection: Float32Array;
}

/**
 * Seeded selection of DRIVER_COUNT neuron indices, biased toward sensory
 * channels (superClass ∈ {sensory, visual_projection, optic}).
 * Plus a fixed 64×256 projection matrix.
 */
export function buildDriver(brain: Brain): DriverPack {
  const N = brain.header.numNeurons;
  const sc = brain.neurons.superClass;

  const preferred: number[] = [];
  const other: number[] = [];
  for (let i = 0; i < N; i++) {
    if (DRIVER_CLASSES.has(sc[i]!)) preferred.push(i);
    else other.push(i);
  }

  const rng = mulberry32(DRIVER_SEED);
  const pick = (pool: number[], k: number): number[] => {
    // Fisher–Yates partial shuffle
    const arr = pool.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr.slice(0, Math.min(k, arr.length));
  };

  // Prefer ~80% from sensory-ish classes, fill remainder from others.
  const nPref = Math.min(Math.floor(DRIVER_COUNT * 0.8), preferred.length);
  const nOther = DRIVER_COUNT - nPref;
  const selected = [...pick(preferred, nPref), ...pick(other, nOther)];
  // Sort for stable UI highlight order
  selected.sort((a, b) => a - b);
  const indices = Uint32Array.from(selected);

  const projRng = mulberry32(PROJ_SEED);
  const projection = new Float32Array(HASH_DIM * DRIVER_COUNT);
  // Structured: each of 64 hash dims primarily drives 4 dedicated neurons,
  // plus a small dense random remainder so the cascade isn't brittle.
  for (let r = 0; r < HASH_DIM; r++) {
    for (let k = 0; k < 4; k++) {
      const c = (r * 4 + k) % DRIVER_COUNT;
      projection[r * DRIVER_COUNT + c]! += 1.0;
    }
    for (let c = 0; c < DRIVER_COUNT; c++) {
      projection[r * DRIVER_COUNT + c]! += (projRng() * 2 - 1) * 0.15;
    }
  }
  // L2-normalize each column (driver neuron) so drive magnitude is stable
  for (let c = 0; c < DRIVER_COUNT; c++) {
    let sumSq = 0;
    for (let r = 0; r < HASH_DIM; r++) {
      const v = projection[r * DRIVER_COUNT + c]!;
      sumSq += v * v;
    }
    const nrm = Math.sqrt(sumSq) || 1;
    for (let r = 0; r < HASH_DIM; r++) {
      projection[r * DRIVER_COUNT + c]! /= nrm;
    }
  }

  return { indices, projection };
}

/**
 * Map a 64-dim email vector through the projection onto the N-length
 * external input buffer (nonzero only at driver indices).
 */
export function emailToExternal(
  encoding: Float32Array,
  pack: DriverPack,
  numNeurons: number,
  gain = 1.0,
): Float32Array {
  const ext = new Float32Array(numNeurons);
  const { indices, projection } = pack;
  for (let c = 0; c < DRIVER_COUNT; c++) {
    let drive = 0;
    for (let r = 0; r < HASH_DIM; r++) {
      drive += encoding[r]! * projection[r * DRIVER_COUNT + c]!;
    }
    ext[indices[c]!] = Math.abs(drive) * gain;
  }
  return ext;
}
