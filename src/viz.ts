import { CLASS_COLORS } from "./constants";
import type { Brain } from "./engine/brain";

export interface VizState {
  heat: Float32Array | null;
  drivers: Uint32Array | null;
  pulse: number; // 0..1 animation phase
}

/**
 * Canvas 2D orthographic top-down projection of neurons.pos (nm→px).
 * Dark near-black card, cyan/white dots; heat glow on firing neurons;
 * driver neurons outlined so the viewer sees where the email entered.
 */
export class BrainViz {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private brain: Brain | null = null;
  private bounds: { minX: number; maxX: number; minY: number; maxY: number } | null =
    null;
  private raf = 0;
  private state: VizState = { heat: null, drivers: null, pulse: 0 };
  private driverSet: Set<number> | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
  }

  setBrain(brain: Brain) {
    this.brain = brain;
    const pos = brain.neurons.pos;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    // Project x/z (top-down); MaleCNS coords are in native EM voxel space
    for (let i = 0; i < brain.header.numNeurons; i += 4) {
      const x = pos[3 * i]!;
      const z = pos[3 * i + 2]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minY) minY = z;
      if (z > maxY) maxY = z;
    }
    this.bounds = { minX, maxX, minY, maxY };
    this.draw();
  }

  setDrivers(indices: Uint32Array) {
    this.state.drivers = indices;
    this.driverSet = new Set(Array.from(indices));
  }

  setHeat(heat: Float32Array | null) {
    this.state.heat = heat;
  }

  startPulse() {
    cancelAnimationFrame(this.raf);
    const tick = (t: number) => {
      this.state.pulse = (Math.sin(t / 200) + 1) / 2;
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stopPulse() {
    cancelAnimationFrame(this.raf);
    this.state.pulse = 0;
    this.draw();
  }

  draw() {
    const { canvas, ctx, brain, bounds } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#07090d";
    ctx.fillRect(0, 0, w, h);

    if (!brain || !bounds) {
      ctx.fillStyle = "#64748b";
      ctx.font = "12px IBM Plex Mono, monospace";
      ctx.fillText("waiting for brain…", 12, 24);
      return;
    }

    const pad = 8;
    const spanX = bounds.maxX - bounds.minX || 1;
    const spanY = bounds.maxY - bounds.minY || 1;
    const scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
    const ox = (w - spanX * scale) / 2;
    const oy = (h - spanY * scale) / 2;

    const pos = brain.neurons.pos;
    const sc = brain.neurons.superClass;
    const heat = this.state.heat;
    const drivers = this.driverSet;

    // Pass 1: base dots (subsample for perf on full 139k)
    const stride = heat ? 2 : 3;
    for (let i = 0; i < brain.header.numNeurons; i += stride) {
      const x = ox + (pos[3 * i]! - bounds.minX) * scale;
      const y = oy + (pos[3 * i + 2]! - bounds.minY) * scale;
      const c = CLASS_COLORS[sc[i]!] ?? "#94a3b8";
      const activity = heat ? heat[i]! : 0;
      if (activity > 0.5) {
        const glow = Math.min(1, activity / 8);
        ctx.fillStyle = `rgba(125, 211, 252, ${0.15 + glow * 0.7})`;
        ctx.beginPath();
        ctx.arc(x, y, 1.5 + glow * 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = c;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(x, y, 1.2, 1.2);
        ctx.globalAlpha = 1;
      }
    }

    // Pass 2: driver outlines
    if (drivers && this.state.drivers) {
      const pulse = 1 + this.state.pulse * 0.8;
      ctx.strokeStyle = `rgba(251, 191, 36, ${0.55 + this.state.pulse * 0.4})`;
      ctx.lineWidth = 1;
      for (let k = 0; k < this.state.drivers.length; k++) {
        const i = this.state.drivers[k]!;
        const x = ox + (pos[3 * i]! - bounds.minX) * scale;
        const y = oy + (pos[3 * i + 2]! - bounds.minY) * scale;
        ctx.beginPath();
        ctx.arc(x, y, 2.5 * pulse, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }
}
