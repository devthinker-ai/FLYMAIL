/** Categories used by the inbox + readout (fixed order). */
export const CATEGORIES = [
  "payment",
  "receipt",
  "digest",
  "meeting",
  "complaint",
  "personal",
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * MaleCNS v1.0 super-class table (12 entries, stable order).
 *
 * The MaleCNS flat connectome release uses fine-grained superclasses
 * (ol_intrinsic, cb_intrinsic, vnc_intrinsic, ol_sensory, …). We pack them
 * into this fixed 12-entry enum so the runtime, viz, and readout stay
 * dataset-agnostic. Index 0 = unknown (reserved for safety).
 *
 * Mapping (tools/build_csr.py SUPERCLASS_MAP must match this exactly):
 *   1  sensory    ol_sensory, cb_sensory, vnc_sensory (+ tbc variants)
 *   2  olfactory  ol_intrinsic (+ tbc) — the olfactory lobe, largest pool
 *   3  central    cb_intrinsic, cb_efferent (+ tbc) — mushroom-body central brain
 *   4  vnc        vnc_intrinsic, vnc_tbc — the ventral nerve cord
 *   5  visual     visual_projection, visual_centrifugal (+ tbc)
 *   6  descending descending_neuron, sensory_descending, efferent_descending
 *   7  ascending  ascending_neuron, sensory_ascending, efferent_ascending
 *   8  motor      vnc_motor, cb_motor, vnc_efferent — drives the L/R gauges
 *   9  endocrine  cb_endocrine, vnc_endocrine
 *   10 ens        ENS
 *   11 other      anything unmatched
 */
export const SUPER_CLASS_TABLE = [
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
] as const;

export const NUM_SUPER_CLASSES = SUPER_CLASS_TABLE.length; // 12

/** Motor class index (vnc_motor + cb_motor + vnc_efferent) — the L/R gauges. */
export const MOTOR_CLASS = 8;

/**
 * Driver (sensory entry) classes. The email enters through the fly's sensory
 * channels: olfactory/central/VNC sensory neurons plus the visual projection
 * pathway — the MaleCNS analog of FlyWire's {sensory, visual_projection, optic}.
 */
export const DRIVER_CLASSES = new Set([1, 2, 5]); // sensory, olfactory, visual

/** 6 brain cascade rates chosen from the 12 classes (one per index). */
export const CLASS_PICK = [1, 3, 5, 6, 7, 8]; // sensory, central, visual, descending, ascending, motor

/** Verified MaleCNS v1.0 totals (doomfly manifest, minconf 0.5 release). */
export const NUM_NEURONS = 166_700;      // retained neurons (assigned superclass, not Glia)
export const NUM_EDGES = 25_582_938;     // retained pre→post edges
export const NUM_SYNAPTIC_CONTACTS = 124_177_617; // raw contact counts summed across edges

export const FEATURE_DIM = 16;
export const HASH_DIM = 64;
export const DRIVER_COUNT = 256;
export const THINK_STEPS = 1000;
export const THINK_CHUNK = 50;

/** Palette for viz (index = super class). Near-black bg, cyan/white accents. */
export const CLASS_COLORS: string[] = [
  "#4a5568", // unknown
  "#7dd3fc", // sensory — light cyan
  "#94a3b8", // olfactory — slate
  "#86efac", // central — green
  "#67e8f9", // vnc — cyan
  "#38bdf8", // visual — blue
  "#c4b5fd", // descending — light violet
  "#a78bfa", // ascending — violet
  "#fbbf24", // motor — amber
  "#fb7185", // endocrine — rose
  "#e2e8f0", // ens — white
  "#9ca3af", // other — grey
];
