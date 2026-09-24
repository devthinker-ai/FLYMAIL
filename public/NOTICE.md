# NOTICE — MALEFLYMAIL

## webgpu-fly (engine)

This project vendors files from [webgpu-fly](https://github.com/abgnydn/webgpu-fly)
by Ahmet Barış Günaydın, licensed under the MIT License:

- `src/engine/brain.ts`
- `src/engine/sim.ts`
- `src/engine/simParams.ts`
- `src/engine/cache.ts`
- `src/engine/shaders/*.wgsl`

Copyright (c) 2026 Ahmet Baris Gunaydin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## FlyWire / FAFB connectome data

`public/brain.bin` is derived from the FlyWire v783 complete female Drosophila
brain connectome (Janelia Research Campus / Princeton / Google / Cambridge /
MPI / Oxford / HHMI). Data license: **CC BY 4.0**.
DOI: https://doi.org/10.5281/zenodo.21549559

This build runs the **FlyWire (female) brain**, not MaleCNS.

## Reference genre

Staging and honesty genre inspired by Nick Saraev's "Fly / Inbox" demo
(Sept 2026). No code was copied from that demo.

## MaleCNS v1.0 connectome data

The brain dataset in `public/brain.bin` is built from the **MaleCNS v1.0**
flat connectome (minconf-0.5) — a complete male *Drosophila melanogaster*
brain and ventral nerve cord — from the MaleCNS collaboration:
FlyEM at HHMI Janelia Research Campus, University of Cambridge, MRC LMB, and
Google Research. Published in *Cell* (Sept 2026). License: **CC BY 4.0**.
https://male-cns.janelia.org/download/

Source files (sha256-pinned in `tools/download_data.sh`, mirrored in
`public/brain.meta.json`):

- body-annotations-male-cns-v1.0-minconf-0.5.feather
- body-neurotransmitters-male-cns-v1.0.feather
- connectome-weights-male-cns-v1.0-minconf-0.5.feather

Node/edge retention policy: every annotation with a non-empty superclass and
status != Glia (166,700 neurons); all released minconf-0.5 edges between
retained entries (25,582,938 edges / 124,177,617 synaptic contacts).
