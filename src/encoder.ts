import { HASH_DIM } from "./constants";

/** FNV-1a 32-bit. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Tokenize: lowercase, strip punctuation, split on whitespace. */
export function tokenize(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ");
  return cleaned.split(/\s+/).filter((t) => t.length > 0);
}

/** Fixed domain tokens get extra hash weight (label-free; emphasizes content). */
const BOOST = new Map<string, number>([
  ["payment", 3], ["invoice", 3], ["zahlung", 3], ["rechnung", 3], ["deposit", 2],
  ["paid", 2], ["betrag", 2], ["cleared", 2], ["inv", 2],
  ["receipt", 3], ["purchase", 2], ["order", 2], ["beleg", 3], ["kaufbeleg", 3],
  ["subscription", 2], ["total", 1.5],
  ["digest", 3], ["newsletter", 3], ["weekly", 2], ["unsubscribe", 2], ["roundup", 2],
  ["meeting", 3], ["calendar", 2], ["sync", 2], ["termin", 3], ["call", 1.5],
  ["reschedule", 2], ["slot", 2], ["tuesday", 1.5], ["wednesday", 1.5], ["thursday", 1.5],
  ["complaint", 3], ["beschwerde", 3], ["unacceptable", 3], ["inakzeptabel", 3],
  ["ticket", 2], ["refund", 2], ["escalate", 2], ["frustrated", 2], ["waiting", 2],
  ["warte", 2], ["ignored", 2], ["delay", 2],
  ["dinner", 2], ["coffee", 2], ["kaffee", 2], ["weekend", 2], ["photos", 2],
  ["thanks", 1.5], ["hey", 1.5], ["personal", 2],
]);

/**
 * Email → 64-dim Float32 vector via FNV-1a feature hashing into signed
 * buckets, then L2-normalize. Deterministic integer math only.
 */
export function encodeEmail(parts: {
  subject: string;
  body: string;
  from?: string;
}): Float32Array {
  const text = [parts.from ?? "", parts.subject, parts.body].join("\n");
  const tokens = tokenize(text);
  const vec = new Float32Array(HASH_DIM);

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const weight = BOOST.get(tok) ?? 1;
    const h = fnv1a(tok);
    const bucket = h % HASH_DIM;
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[bucket] += sign * weight;
    if (i + 1 < tokens.length) {
      const h2 = fnv1a(tok + "_" + tokens[i + 1]);
      const b2 = h2 % HASH_DIM;
      const s2 = (h2 & 1) === 0 ? 1 : -1;
      vec[b2] += s2 * 0.5 * weight;
    }
  }

  let sumSq = 0;
  for (let i = 0; i < HASH_DIM; i++) sumSq += vec[i] * vec[i];
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < HASH_DIM; i++) vec[i] /= norm;
  }
  return vec;
}
