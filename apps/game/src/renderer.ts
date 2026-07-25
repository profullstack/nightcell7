import { Engine, WebGPUEngine, type AbstractEngine } from "@babylonjs/core";

/**
 * Renderer selection (PRD §17.1, §30.1).
 *
 * WebGPU preferred, WebGL2 fallback. The fallback is not a degraded mode that
 * we tolerate — PRD §35.4 requires a WebGL2 client to complete both campaigns
 * and join multiplayer.
 */

export type RendererKind = "webgpu" | "webgl2";

export interface RendererInfo {
  engine: AbstractEngine;
  kind: RendererKind;
  hardwareScalingLevel: number;
}

export async function createRenderer(canvas: HTMLCanvasElement): Promise<RendererInfo> {
  if (await WebGPUEngine.IsSupportedAsync) {
    try {
      const engine = new WebGPUEngine(canvas, { antialias: true, stencil: true });
      await engine.initAsync();
      return { engine, kind: "webgpu", hardwareScalingLevel: engine.getHardwareScalingLevel() };
    } catch {
      // A WebGPU init failure must not be fatal — fall through to WebGL2.
    }
  }

  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: false,
    stencil: true,
    powerPreference: "high-performance",
    // Losing the GL context should be recoverable rather than a crash
    // (PRD §34.6 lists context loss as a required manual scenario).
    doNotHandleContextLost: false,
  });

  return { engine, kind: "webgl2", hardwareScalingLevel: engine.getHardwareScalingLevel() };
}

/**
 * Dynamic resolution: hold the frame-rate target by scaling the backbuffer
 * rather than dropping frames (PRD §30.6).
 */
export class DynamicResolution {
  private samples: number[] = [];

  constructor(
    private readonly engine: AbstractEngine,
    private readonly targetFps = 60,
    private readonly minScale = 1.0,
    private readonly maxScale = 2.0,
  ) {}

  update(deltaMs: number): void {
    this.samples.push(deltaMs);
    if (this.samples.length < 60) return;

    const average = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    this.samples = [];

    const targetMs = 1000 / this.targetFps;
    const current = this.engine.getHardwareScalingLevel();

    if (average > targetMs * 1.2 && current < this.maxScale) {
      this.engine.setHardwareScalingLevel(Math.min(this.maxScale, current + 0.1));
    } else if (average < targetMs * 0.8 && current > this.minScale) {
      this.engine.setHardwareScalingLevel(Math.max(this.minScale, current - 0.05));
    }
  }
}
