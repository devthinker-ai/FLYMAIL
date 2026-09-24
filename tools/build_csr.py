#!/usr/bin/env python3
"""
build_csr.py — MaleCNS v1.0 flat connectome feathers → binary CSR brain blob.

Reads (from data/raw/, fetched by tools/download_data.sh):
  annotations.feather        (bodyId, superclass, type, status, statusLabel, somaLocation, …)
  neurotransmitters.feather  (body, consensus_nt, …)
  edges.feather              (body_pre, body_post, weight) — ~1 GB, streamed in batches

Writes
  public/brain.bin       (binary, little-endian)
  public/brain.meta.json (header echo + stats + provenance for the runtime)

Binary format — identical to webgpu-fly / flymail ("WGFLYBRN" v1), so the
vendored engine (src/engine/brain.ts, sim.ts, shaders) needs no changes:

  [ Header — 64 B, 16-byte aligned ]
    magic         char[8]  = "WGFLYBRN"
    version       u32      = 1
    num_neurons   u32      = N
    num_edges     u32      = E
    flags         u32      bit 0: weights are pre-signed by presynaptic NT
    voxel_to_nm   f32[3]   MaleCNS native EM voxel size in nm (8, 8, 8)
    reserved      u32[7]   pad to 64 B

  [ Neurons — N × 32 B ]
    pos_x/pos_y/pos_z  f32   soma position in nm (somaLocation × voxel); 0 if absent
    sign               f32   -1 / 0 / +1 (informational; weights already signed)
    cell_type          u32   FNV-1a top 24 bits of type label + bottom-8 hero enum
    super_class        u32   packed enum (see SUPERCLASS_MAP below)
    flags              u32   bit 0: is_descending  bit 1: is_sensory
    nt_conf            f32   1.0 if consensus_nt present, else 0.0

  [ CSR row_ptr — (N+1) × u32 ]   row[i] = start of i's INCOMING edges
  [ CSR col_idx — E × u32 ]       presynaptic neuron index per incoming edge
  [ CSR weight  — E × f32 ]       sign(pre_nt) × contact_count

Node policy (mirrors doomfly/data-provenance/malecns_v1/normalized/report.json):
  Every annotation entry with a non-empty `superclass` and status != "Glia".
  → 166,700 neurons. Edges: all released minconf-0.5 edges between retained
  entries → 25,582,938 edges / 124,177,617 synaptic contacts.

Run:  python3 tools/build_csr.py          (needs pandas + pyarrow; 24 GB RAM box)
"""
from __future__ import annotations

import hashlib
import json
import struct
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT_BIN = ROOT / "public" / "brain.bin"
OUT_META = ROOT / "public" / "brain.meta.json"

# MaleCNS native EM voxel size in nm (per fly-connectome-template manifest:
# "8 nm voxels, native MaleCNS EM space").
VOXEL_NM = (8.0, 8.0, 8.0)

# Neurotransmitter sign (same table as webgpu-fly/tools/build_csr.py — the
# kernel treats weight sign as the only NT effect):
#   acetylcholine: nAChR excitatory
#   gaba / glutamate: predominantly inhibitory in fly
#   histamine: inhibitory in fly (lamina/LO circuit)
#   dopamine / serotonin / octopamine: modulatory — out of scope, weight 0
NT_SIGN = {
    "acetylcholine": +1.0,
    "gaba": -1.0,
    "glutamate": -1.0,
    "histamine": -1.0,
    "dopamine": 0.0,
    "serotonin": 0.0,
    "octopamine": 0.0,
}

# Packed super-class enum. MUST match src/constants.ts SUPER_CLASS_TABLE.
SUPER_CLASS_TABLE = [
    "unknown",
    "sensory",
    "olfactory",
    "central",
    "vnc",
    "visual",
    "descending",
    "ascending",
    "motor",
    "endocrine",
    "ens",
    "other",
]

SUPERCLASS_MAP = {
    # 1 sensory
    "ol_sensory": 1, "cb_sensory": 1, "vnc_sensory": 1,
    "ol_sensory_tbc": 1, "cb_sensory_tbc": 1, "vnc_sensory_tbc": 1,
    # 2 olfactory
    "ol_intrinsic": 2, "ol_intrinsic_tbc": 2,
    # 3 central
    "cb_intrinsic": 3, "cb_efferent": 3,
    "cb_intrinsic_tbc": 3, "cb_efferent_tbc": 3,
    # 4 vnc
    "vnc_intrinsic": 4, "vnc_tbc": 4,
    # 5 visual
    "visual_projection": 5, "visual_centrifugal": 5,
    "visual_projection_tbc": 5, "visual_centrifugal_tbc": 5,
    # 6 descending
    "descending_neuron": 6, "sensory_descending": 6, "efferent_descending": 6,
    "descending_neuron_tbc": 6,
    # 7 ascending
    "ascending_neuron": 7, "sensory_ascending": 7, "efferent_ascending": 7,
    "sensory_ascending_tbc": 7, "efferent_ascending_tbc": 7,
    # 8 motor
    "vnc_motor": 8, "cb_motor": 8, "vnc_efferent": 8,
    # 9 endocrine
    "cb_endocrine": 9, "vnc_endocrine": 9,
    # 10 ens
    "ens": 10,
}

# Hero cell types (bottom 8 bits of cell_type) — MaleCNS `type` labels.
HERO_CELL_TYPES = {
    "kenyon": 1, "mbon": 2, "lhn": 3, "pn": 4, "orn": 5,
    "gf": 6, "dn": 7, "mn": 8,
}


def classify_hero(label: str) -> int:
    if not isinstance(label, str) or not label:
        return 0
    if label.startswith("KC"):
        return HERO_CELL_TYPES["kenyon"]
    if label.startswith("MBON"):
        return HERO_CELL_TYPES["mbon"]
    if label.startswith("ORN"):
        return HERO_CELL_TYPES["orn"]
    if label.startswith("LH"):
        return HERO_CELL_TYPES["lhn"]
    if label.startswith("DN"):
        return HERO_CELL_TYPES["dn"]
    if label.startswith("MN"):
        return HERO_CELL_TYPES["mn"]
    return 0


def pack_cell_type(label) -> int:
    if not isinstance(label, str) or not label:
        return 0
    hero = classify_hero(label)
    h = 2166136261
    for c in label.encode("utf-8"):
        h ^= c
        h = (h * 16777619) & 0xFFFFFFFF
    return ((h & 0xFFFFFF00) | hero) & 0xFFFFFFFF


def main() -> int:
    ann_p = RAW / "annotations.feather"
    nt_p = RAW / "neurotransmitters.feather"
    edges_p = RAW / "edges.feather"
    for p in (ann_p, nt_p, edges_p):
        if not p.exists():
            print(f"missing: {p}", file=sys.stderr)
            print("run: bash tools/download_data.sh", file=sys.stderr)
            return 1

    t0 = time.time()

    # ---- [1/6] neurons -----------------------------------------------------
    print(f"[1/6] loading annotations ({ann_p.stat().st_size / 1e6:.0f} MB)")
    ann = pd.read_feather(ann_p)
    print(f"      rows: {len(ann):,}")

    keep = ann["superclass"].notna() & ann["superclass"].astype(str).str.strip().ne("")
    keep &= ann["status"] != "Glia"
    ann = ann.loc[keep].sort_values("bodyId").reset_index(drop=True)
    n = len(ann)
    print(f"      retained neurons (superclass assigned, not Glia): {n:,}")

    body_ids = ann["bodyId"].to_numpy()
    id_to_idx = {int(b): i for i, b in enumerate(body_ids)}

    # ---- [2/6] neurotransmitters + positions -------------------------------
    print(f"[2/6] loading neurotransmitters ({nt_p.stat().st_size / 1e6:.0f} MB)")
    nt = pd.read_feather(nt_p).set_index("body")
    nt_map = nt["consensus_nt"].astype(str).str.lower()

    superclasses = ann["superclass"].astype(str).str.strip().to_numpy()
    types = ann["type"].astype(object).to_numpy()
    soma = ann["somaLocation"].astype(object).to_numpy()

    neurons = np.zeros(n, dtype=[
        ("pos_x", "<f4"), ("pos_y", "<f4"), ("pos_z", "<f4"),
        ("sign", "<f4"),
        ("cell_type", "<u4"),
        ("super_class", "<u4"),
        ("flags", "<u4"),
        ("nt_conf", "<f4"),
    ])

    pre_sign = np.zeros(n, dtype=np.float32)
    n_with_soma = n_with_nt = 0
    class_counts = np.zeros(12, dtype=np.int64)

    for i in range(n):
        sc = superclasses[i].lower()
        idx = SUPERCLASS_MAP.get(sc, 11)  # 11 = other
        neurons[i]["super_class"] = idx
        class_counts[idx] += 1

        b = int(body_ids[i])
        if b in nt_map.index:
            nt_name = str(nt_map.loc[b]).strip()
            sign = NT_SIGN.get(nt_name, 0.0)
            neurons[i]["sign"] = sign
            neurons[i]["nt_conf"] = 1.0
            pre_sign[i] = sign
            n_with_nt += 1

        loc = soma[i]
        try:
            if loc is not None and len(loc) == 3 and all(np.isfinite(v) for v in loc):
                neurons[i]["pos_x"] = float(loc[0]) * VOXEL_NM[0]
                neurons[i]["pos_y"] = float(loc[1]) * VOXEL_NM[1]
                neurons[i]["pos_z"] = float(loc[2]) * VOXEL_NM[2]
                n_with_soma += 1
        except (TypeError, ValueError):
            pass

        neurons[i]["cell_type"] = pack_cell_type(types[i])

        flags = 0
        if sc in SUPERCLASS_MAP and SUPERCLASS_MAP[sc] == 6:
            flags |= 1
        if SUPERCLASS_MAP.get(sc, 11) == 1:
            flags |= 2
        neurons[i]["flags"] = flags

    print(f"      soma positions: {n_with_soma:,} / {n:,}")
    print(f"      NT assigned:    {n_with_nt:,} / {n:,}")

    # ---- [3/6] edges (streamed batches, ~1 GB) ------------------------------
    import pyarrow as pa
    import pyarrow.ipc as ipc

    print(f"[3/6] streaming edges ({edges_p.stat().st_size / 1e6:.0f} MB)")
    reader = ipc.open_file(pa.memory_map(str(edges_p), "r"))
    schema_names = [f.name for f in reader.schema]
    print(f"      schema: {schema_names}")

    col_pre = schema_names.index("body_pre")
    col_post = schema_names.index("body_post")
    col_w = schema_names.index("weight")

    pre_idx_all: list[np.ndarray] = []
    post_idx_all: list[np.ndarray] = []
    w_all: list[np.ndarray] = []
    src_rows = src_contacts = 0

    id_arr = body_ids  # sorted → searchsorted works
    for k in range(reader.num_record_batches):
        b = reader.get_batch(k)
        pre = b.column(col_pre).to_numpy(zero_copy_only=False)
        post = b.column(col_post).to_numpy(zero_copy_only=False)
        w = b.column(col_w).to_numpy(zero_copy_only=False).astype(np.int64)
        src_rows += len(pre)
        src_contacts += int(w.sum())

        i = np.searchsorted(id_arr, pre)
        j = np.searchsorted(id_arr, post)
        # clamp for the equality check (ids beyond the max)
        i_ok = (i < n) & (id_arr[np.minimum(i, n - 1)] == pre)
        j_ok = (j < n) & (id_arr[np.minimum(j, n - 1)] == post)
        keepm = i_ok & j_ok
        pre_idx_all.append(i[keepm].astype(np.uint32))
        post_idx_all.append(j[keepm].astype(np.uint32))
        w_all.append(w[keepm].astype(np.float32))
        if (k + 1) % 10 == 0 or k == reader.num_record_batches - 1:
            print(f"      batch {k + 1}/{reader.num_record_batches}", flush=True)

    pre_idx = np.concatenate(pre_idx_all) if pre_idx_all else np.zeros(0, np.uint32)
    post_idx = np.concatenate(post_idx_all) if post_idx_all else np.zeros(0, np.uint32)
    weights = np.concatenate(w_all) if w_all else np.zeros(0, np.float32)
    e = len(pre_idx)
    retained_contacts = int(weights.sum())
    print(f"      source edge rows:   {src_rows:,}")
    print(f"      source contacts:    {src_contacts:,}")
    print(f"      retained edges:     {e:,}")
    print(f"      retained contacts:  {retained_contacts:,}")

    # ---- [4/6] pre-sign + incoming-edge CSR ---------------------------------
    print("[4/6] pre-signing weights, building incoming-edge CSR")
    weights_signed = (weights * pre_sign[pre_idx]).astype(np.float32)
    n_silenced = int((weights_signed == 0).sum())
    n_self = int((pre_idx == post_idx).sum())
    print(f"      silenced (NT missing/modulatory): {n_silenced:,}")
    print(f"      self-edges kept (upstream keeps autapses): {n_self:,}")

    order = np.argsort(post_idx, kind="stable")
    post_sorted = post_idx[order]
    col_idx = pre_idx[order].astype(np.uint32)
    weight_arr = weights_signed[order]

    row_ptr = np.zeros(n + 1, dtype=np.uint32)
    counts = np.bincount(post_sorted, minlength=n).astype(np.uint32)
    np.cumsum(counts, out=row_ptr[1:])
    assert int(row_ptr[-1]) == e

    # ---- [5/6] write brain.bin ----------------------------------------------
    print(f"[5/6] writing {OUT_BIN}")
    OUT_BIN.parent.mkdir(parents=True, exist_ok=True)
    with OUT_BIN.open("wb") as f:
        f.write(b"WGFLYBRN")
        f.write(struct.pack("<III", 1, n, e))
        f.write(struct.pack("<I", 0x1))  # bit 0: pre-signed weights
        f.write(struct.pack("<fff", *VOXEL_NM))
        f.write(b"\x00" * (7 * 4))
        f.write(neurons.tobytes())
        f.write(row_ptr.tobytes())
        f.write(col_idx.tobytes())
        f.write(weight_arr.tobytes())
    size_mb = OUT_BIN.stat().st_size / 1e6
    print(f"      {size_mb:.1f} MB written")

    # ---- [6/6] meta ----------------------------------------------------------
    bin_sha = hashlib.sha256(OUT_BIN.read_bytes()).hexdigest()
    meta = {
        "version": 1,
        "dataset": "male-cns:v1.0",
        "sex": "male",
        "coverage": "brain_and_ventral_nerve_cord",
        "num_neurons": n,
        "num_edges": e,
        "voxel_to_nm": list(VOXEL_NM),
        "stats": {
            "with_soma": n_with_soma,
            "with_nt": n_with_nt,
            "silenced_edges": n_silenced,
            "self_edges": n_self,
            "retained_synaptic_contacts": retained_contacts,
            "source_edge_rows": src_rows,
            "source_synaptic_contacts": src_contacts,
            "class_counts": {
                SUPER_CLASS_TABLE[i]: int(class_counts[i]) for i in range(12)
            },
        },
        "super_class_table": SUPER_CLASS_TABLE,
        "node_policy": "Every annotation with a non-empty superclass and status != Glia (matches doomfly/data-provenance/malecns_v1 normalized report).",
        "edge_policy": "All released minconf-0.5 edges between retained entries; upstream autapses kept; weight = contact count pre-signed by presynaptic consensus NT.",
        "sources": {
            "annotations.feather": {
                "url": "https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/body-annotations-male-cns-v1.0-minconf-0.5.feather",
                "sha256": "2177e246113e4cfbf1e7772ec37c6da1955ff22e8063d0b1f833101f99a9a3b2",
            },
            "neurotransmitters.feather": {
                "url": "https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/body-neurotransmitters-male-cns-v1.0.feather",
                "sha256": "95c9289220663abeb3409f3ad9e5a7f8a53f8093f5139d15502cd08da8879621",
            },
            "edges.feather": {
                "url": "https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/connectome-weights-male-cns-v1.0-minconf-0.5.feather",
                "sha256": "e35da783d1c686b2b58b3b87cd6a403ae43bfcfba8bff28e08ef752c1a56afc1",
            },
        },
        "brain_bin_sha256": bin_sha,
        "license": "CC BY 4.0",
        "attribution": "MaleCNS collaboration: FlyEM at HHMI Janelia, University of Cambridge, MRC LMB, Google Research. https://male-cns.janelia.org/download/",
        "build_seconds": round(time.time() - t0, 1),
    }
    OUT_META.write_text(json.dumps(meta, indent=2) + "\n")
    print(f"[6/6] wrote {OUT_META}")
    print(json.dumps({
        "num_neurons": n, "num_edges": e, "size_mb": round(size_mb, 1),
        "with_soma": n_with_soma, "with_nt": n_with_nt,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
