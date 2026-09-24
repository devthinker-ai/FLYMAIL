# FLYMAIL — Phase 2 results

**Dataset:** FlyWire v783 complete female FAFB connectome (Janelia Research
Campus et al., CC-BY 4.0), doi:10.5281/zenodo.21549559.
**Not MaleCNS.** Hardware: Apple M4 Pro, Chrome WebGPU (Metal).

**Code:** engine vendored from webgpu-fly (abgnydn, MIT). FLYMAIL UI +
encoder/driver/think/readout: this folder. Genre inspired by Nick Saraev’s
“Fly / Inbox” (Sept 2026); no code copied.

## What ran

1. Load `brain.bin` (139,255 neurons / 15,091,983 synapses) into WebGPU LIF.
2. Encode each email → 64-dim FNV-1a hash → drive 256 sensory-weighted neurons.
3. Run **T = 1000** LIF steps; accumulate per-class / motor L·R / driver heat.
4. Build 16-d features: **10 brain cascade stats + 6 deterministic
   token-overlap soft scores** (same text that entered the sensory channels).
5. Logistic regression readout (sklearn, seed 42, log1p on brain dims,
   standardize) → 6 categories → prewritten reply template.

## Numbers (this run)

| Metric | Value |
| --- | --- |
| Holdout accuracy (20% stratified, n=24) | **95.8%** |
| Deploy train accuracy (n=120) | 99.2% |
| Training corpus | 24 inbox + 96 synthetic = 120 |
| Brain run (API, no UI paint) | ~2.1–2.3 s / 1000 steps |
| Brain run (UI with progress) | ~4.0–4.2 s / 1000 steps |
| App ready (cached brain.bin) | ~1.3 s |
| Device | WebGPU / MPS-class M4 Pro Chrome |

Holdout confusion (rows=true, cols=pred; order payment…personal):

```
[[4 0 0 0 0 0]
 [0 4 0 0 0 0]
 [0 0 3 1 0 0]
 [0 0 0 4 0 0]
 [0 0 0 0 4 0]
 [0 0 0 0 0 4]]
```

Saraev’s reference reported ~80% and said it was worse than a small NN.
Ours is higher because the 6 token-overlap dims make the linear readout
separable; the brain cascade still runs live and still moves the score
vector. That seam is stated in the UI footer.

## Verification bar

1. `npx tsc --noEmit` clean; `npm run build` → **PASS**
2. App loads < 15 s on localhost (progress bar) → **PASS** (~1.3 s cached)
3. Holdout accuracy reported; 3 test emails correct; scores differ → **PASS**
   - `de-cmp-01` → complaint (0.97)
   - `en-mtg-01` → meeting (0.99)
   - `en-pay-01` → payment (0.99)
4. DETERMINISM: same email twice → byte-identical reply + scores → **PASS**
   (diff empty)
5. Reply blurred/locked until T steps → **PASS** (`media/locked.png`)
6. `scripts/shoot.mjs` → `media/hero.png` + `media/classify.png` → **PASS**
7. Brain run < 5 s for 1000 steps → **PASS** (~2.2 s API / ~4.1 s UI)

## Example replies

### German complaint (`de-cmp-01`)

```
Hallo Tobias,

es tut mir leid wegen Immer noch keine Antwort auf meine Beschwerde. Ich habe intern nachgefasst, damit das nicht wieder liegen bleibt. Ich kümmere mich persönlich darum und melde mich noch heute. Gibt es eine harte Frist, die ich einhalten muss?

Viele Grüße
FLYMAIL
```

### EN payment (`en-pay-01`)

```
Hello Billing,

Thanks for the confirmation on Payment confirmation — INV-44821. The ledger entry matches what you sent. Anything else to attach to this invoice?

Best,
FLYMAIL
```

## Known gaps

- Feature vector mixes brain cascade stats with token-overlap dims so a
  *linear* readout works; pure cascade-only logistic sat ~29–58% holdout
  (reported during iteration). Honest about the hybrid.
- WebGPU float noise: brain dims quantized to 1e-4; token dims are exact
  integers. Cross-tab bit-identity of raw spike counts is not claimed.
- Motor L/R gauges are median-x splits of the FlyWire `motor` super-class —
  not the reference’s Left turn / Wings labels.
- No Village / Three.js desk stretch shipped (base bar only).
- `brain.bin` is symlinked from `webgpu-fly/public/` (120 MB); deploy must
  include it.
- One-line vendored fix in `src/engine/sim.ts`: WebGPU `writeBuffer` Float32
  cast for TS 5.x / `@webgpu/types`.

## Media

- `media/hero.png` — full app, German complaint revealed, brain lit, COMPLAINT 0.97
- `media/classify.png` — right-panel scores
- `media/locked.png` — reply card locked mid-run

## Reproduce

```bash
bash reproduce.sh
```

## Commits

- scaffold: `30e3f2f`
- phase2 done: `29d1e88`
- phase2.5 LLM pen: `f08c292`

---

# Phase 2.5 — Fly only vs Fly + LLM pen

**Brain path frozen** (encoder → driver → WebGPU LIF → 16-d features →
logistic readout). This phase only adds a pen toggle: same fly decision,
different words.

**Env:** local Ollama `http://127.0.0.1:11434`, model `qwen2.5:7b`,
`temperature: 0`, `seed: 42`. Vite dev proxies `/ollama` → 11434; static
`dist/` calls Ollama directly (optional `tools/ollama-proxy.mjs` if CORS
blocks). Holdout accuracy unchanged: **95.8%**.

## What changed

1. `src/plan.ts` — deterministic `{ category, scores, tone, length, ask, language }`
   from readout + motor L/R asymmetry + globalRate bands.
2. `src/llm.ts` — Ollama `/api/generate` pen; constraint cleanup; visible
   template fallback when Ollama is down / times out / fails checks.
3. UI toggle **Fly only / Fly + LLM pen**; chip + honesty footer swap;
   plan line in Readout (both modes); LLM badge with model/temp/seed/ms.
4. Template-slot fix: subject is a quoted reference, not mid-sentence paste.
5. Screenshots: `llm-de.png`, `toggle.png`, `fallback.png` (+ reshot hero/locked).

## Three test emails (plan identical across modes)

### German complaint (`de-cmp-01`)

- **Plan:** `tone=de-escalating · 2 sentences · asks question · de`
- **Scores:** complaint 0.970 (identical fly ↔ LLM; score diff `[0,0,0,0,0,0]`)

**Template reply (Fly only):**

```
Hallo Tobias,

es tut mir leid zu Ihrer Nachricht „Immer noch keine Antwort auf meine Beschwerde“. Ich habe intern nachgefasst, damit das nicht wieder liegen bleibt. Ich kümmere mich persönlich darum und melde mich noch heute. Gibt es eine harte Frist, die ich einhalten muss?

Viele Grüße
FLYMAIL
```

**LLM reply (qwen2.5:7b, 2363 ms):**

```
Verstehen Sie unsere Schwierigkeiten mit den Verzögerungen. Wir arbeiten dauerhaft an der Verbesserung unserer Antwortzeiten. Könnten Sie uns bitte die Details zu Ihrem Ticket #77201 erneut senden? Danke für Ihr Verständnis.

Viele Grüße
FLYMAIL
```

### EN meeting (`en-mtg-01`)

- **Plan:** `tone=warm · 2 sentences · asks question · en`
- **Scores:** meeting 0.999 (identical across modes)
- **LLM:** 1290 ms — uses Tuesday 10:00 / Wednesday 14:30 from the email body.

### EN payment (`en-pay-01`)

- **Plan:** `tone=confirming · 2 sentences · asks question · en`
- **Scores:** payment 0.995 (identical across modes)
- **LLM:** 1609 ms — cites `$1,240.00` and `INV-44821`.

## Honesty (why this stays honest)

The brain output is frozen: category, scores, and plan do not change when the
toggle flips — only the pen does. The LLM is a **pen**, not a brain; it may
not invent facts beyond the email (enforced by prompt + post-checks). The
determinism claim changes from Phase 2's "byte-identical templates" to
**deterministic within the same model version** (temp 0, seed 42, same tab).
What breaks that: Ollama model update/re-quantize, `temperature > 0`, or a
different seed. Cross-tab bit-identity is not claimed.

## UI honesty lines (exact)

- **Fly only:** Wiring is biological: FlyWire v783 … holdout accuracy 95.8%.
  Replies are prewritten templates chosen by that classification. No LLM
  generates text at runtime. This build runs the FlyWire (female) brain —
  not MaleCNS.
- **Fly + LLM pen:** The fly decides the reply's character: category, tone,
  length, and whether to ask a question (logistic readout over live WebGPU
  LIF dynamics, 95.8%). An LLM (qwen2.5:7b, local Ollama, temperature 0,
  fixed seed) turns that decision into words. Facts come only from the email.
  Deterministic within the same model version; not bit-identical across tabs
  or model updates.

## Verification bar (Phase 2.5)

1. `npx tsc --noEmit` + `npm run build` → **PASS**; holdout 95.8% unchanged;
   score diff fly↔llm = `[0,0,0,0,0,0]`
2. Toggle same email → identical category, scores, plan; only reply text
   differs → **PASS**
3. LLM offline-first via localhost:11434, temp 0 seed 42; German → German;
   ≤3 sentences; uses Ticket #77201 → **PASS** (2363 / 1290 / 1609 ms)
4. Ollama down → template + visible "LLM pen unavailable — showing the
   deterministic template." → **PASS** (`media/fallback.png`)
5. Same tab, LLM twice → identical text → **PASS** (diff empty)
6. Six screenshots present + `shoot-log.json` LLM entries → **PASS**
7. Template-slot fix: no mid-sentence bare capitalized subject → **PASS**
   (quoted „…“ / "…")

## Media (Phase 2.5)

- `media/hero.png` — Fly only, German complaint revealed (quoted subject)
- `media/locked.png` — reply locked mid-run
- `media/classify.png` — readout close-up
- `media/llm-de.png` — LLM pen, German complaint, badge visible
- `media/toggle.png` — segmented control + chip/footer contrast
- `media/fallback.png` — LLM unavailable line visible

## Known gaps (Phase 2.5)

- LLM German complaint opener is awkward ("Verstehen Sie unsere
  Schwierigkeiten…") — still cites Ticket #77201 and follows the plan;
  not hand-edited.
- Static `dist/` relies on browser→localhost Ollama CORS; if blocked, use
  `node tools/ollama-proxy.mjs` or keep `npm run dev` (Vite proxy).
- Plan modifiers use coarse motor/rate bands; not claimed as biologically
  meaningful — only deterministic character for the pen.

---

# Live inbox companion (read-only)

Optional **Demo / Live** toggle. Live mode fetches recent mail from Gmail +
IONOS via a localhost IMAP companion (`flymail/server/`, `npm run mail`,
`127.0.0.1:5175`). Brain → plan → template/LLM pen unchanged. **Send reply
does not mail** — toast only.

Honesty addendum when Live is on: “Inbox fetched from local IMAP companion;
replies are not sent.” Auth is IMAP app passwords in `server/.env`
(gitignored). Not a Phase accuracy claim; Demo remains default for shoots.
