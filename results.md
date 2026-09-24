# MALEFLYMAIL — Phase 2 results

**Dataset:** MaleCNS v1.0 complete **male** *Drosophila melanogaster* brain
**and ventral nerve cord** (MaleCNS collaboration: HHMI Janelia, University of
Cambridge, MRC LMB, Google Research; published in Cell, Sept 2026; CC-BY 4.0).
Flat connectome, minconf-0.5 release. **Not FlyWire/FAFB** (that is
`../flymail`'s substrate). Hardware: Apple M4 Pro, Chrome WebGPU (Metal).

**Code:** engine vendored from webgpu-fly (abgnydn, MIT). MALEFLYMAIL UI +
encoder/driver/think/readout + MaleCNS data pipeline: this folder.

## What ran

1. Fetched the 3 pinned source feathers (sha256-verified, ~1.2 GB) →
   `data/raw/` (`tools/download_data.sh`).
2. Built `public/brain.bin` (210 MB): 166,700 neurons / 25,582,938 edges /
   124,177,617 synaptic contacts, `WGFLYBRN` v1 format, NT pre-signed
   (`tools/build_csr.py`).
3. Load `brain.bin` into the WebGPU LIF simulator.
4. Encode each email → 64-dim FNV-1a hash → drive 256 sensory-weighted
   neurons (sensory / olfactory / visual projection classes).
5. Run **T = 1000** LIF steps; accumulate per-class / motor L·R / driver heat.
6. Build 16-d features: **10 brain cascade stats + 6 deterministic
   token-overlap soft scores** (same text that entered the sensory channels).
7. Logistic regression readout (sklearn, seed 42, log1p on brain dims,
   standardize) → 6 categories → prewritten reply template. Optional local
   Ollama model polishes the reply (the "pen"); no cloud LLM.

## Numbers (this run, 2026-09-24)

| Metric | Value |
| --- | --- |
| Neurons (retained) | **166,700** (superclass assigned, not Glia) |
| Edges (retained) | **25,582,938** |
| Synaptic contacts (retained) | **124,177,617** |
| Soma positions | 139,662 / 166,700 |
| Neurotransmitter pre-signing | 166,522 neurons (rest "unclear" → 0) |
| Silenced edges (NT missing/modulatory) | 1,023,803 (4.0%) |
| Holdout accuracy (20% stratified, n=24) | **91.7%** |
| Deploy train accuracy (n=120) | 100% |
| Training corpus | 120 emails (demo inbox + synthetic) |
| Brain run (API, no UI paint) | ~2.9 s / 1000 steps |
| `brain.bin` build | ~13 s (edges streamed in 2,318 batches) |
| Device | WebGPU / Metal, M4 Pro Chrome |

Holdout confusion (rows=true, cols=pred; order payment, receipt, digest,
meeting, complaint, personal):

```
[[4 0 0 0 0 0]
 [0 4 0 0 0 0]
 [0 0 3 1 0 0]
 [0 0 0 4 0 0]
 [0 0 0 1 3 0]
 [0 0 0 0 0 4]]
```

Only two holdout misses, both inside digest/meeting/complaint. Honest note:
91.7% on the MaleCNS substrate vs 95.8% on FlyWire in `../flymail` — the
MaleCNS brain is 25% denser and the driver lands in a different class mix
(olfactory dominates: 89,403 cells), so the cascade statistics are noisier
per email. Same architecture, no special-casing.

Demo emails under the deploy model: `de-cmp-01` → complaint, `en-mtg-01` →
meeting, `en-pay-01` → payment (all correct).

## Super-class distribution (MaleCNS v1.0, 12-entry table)

| class | count | class | count |
| --- | --- | --- | --- |
| sensory | 17,386 | descending | 1,332 |
| olfactory | 89,403 | ascending | 2,393 |
| central | 32,168 | motor | 909 |
| vnc | 13,199 | endocrine | 94 |
| visual | 9,766 | ens | 50 |

(27 upstream superclasses packed into 12 runtime classes; mapping in
`tools/build_csr.py` `SUPERCLASS_MAP`, table in `src/constants.ts`.)

## Reproduce

```bash
bash tools/download_data.sh          # 1.2 GB, sha256-pinned
../webgpu-fly/.venv/bin/python tools/build_csr.py
node tools/smoke.mjs                 # 3-email sanity check, headed
node tools/run_reports.mjs           # 120-email corpus (~4 min)
../train-your-fly/.venv/bin/python tools/fit_readout.py
npm run build
```

Or `./reproduce.sh` for the whole chain.
