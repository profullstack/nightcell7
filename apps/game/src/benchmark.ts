import type { AbstractEngine } from "@babylonjs/core";

/**
 * Graphics benchmark (PRD §5.1).
 *
 * Free, runs before any large download, and recommends a preset. Its purpose
 * is to stop a player buying an episode their machine cannot run.
 */

export type QualityPreset = "low" | "medium" | "high";

export interface BenchmarkResult {
  averageFps: number;
  onePercentLowFps: number;
  renderer: string;
  recommendedPreset: QualityPreset;
  /** True when the machine misses even the minimum target (PRD §30.1). */
  belowMinimum: boolean;
}

export async function runBenchmark(
  engine: AbstractEngine,
  renderFrame: () => void,
  durationMs = 6000,
): Promise<BenchmarkResult> {
  const frames: number[] = [];
  const start = performance.now();
  let last = start;

  while (performance.now() - start < durationMs) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const now = performance.now();
    frames.push(now - last);
    last = now;
    renderFrame();
  }

  return summarize(frames, engine.description ?? "unknown");
}

export function summarize(frameTimesMs: number[], renderer: string): BenchmarkResult {
  if (frameTimesMs.length === 0) {
    return {
      averageFps: 0,
      onePercentLowFps: 0,
      renderer,
      recommendedPreset: "low",
      belowMinimum: true,
    };
  }

  const sorted = [...frameTimesMs].sort((a, b) => a - b);
  const average = frameTimesMs.reduce((a, b) => a + b, 0) / frameTimesMs.length;
  // The 1% low is what players actually feel; a good average with bad lows
  // still stutters.
  const index = Math.max(0, Math.floor(sorted.length * 0.99) - 1);
  const worst = sorted[index] ?? average;

  const averageFps = 1000 / average;
  const onePercentLowFps = 1000 / worst;

  let recommendedPreset: QualityPreset = "low";
  if (averageFps >= 90 && onePercentLowFps >= 55) recommendedPreset = "high";
  else if (averageFps >= 58 && onePercentLowFps >= 40) recommendedPreset = "medium";

  return {
    averageFps,
    onePercentLowFps,
    renderer,
    recommendedPreset,
    // Minimum target is a stable 30 FPS at 720p low (PRD §30.1).
    belowMinimum: averageFps < 30,
  };
}
