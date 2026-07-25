import { performance } from "node:perf_hooks";
import { TDM_RULES, type MatchRules } from "@nightcell7/game-core";
import { ARDAVAN_YARD, BotController, MatchSimulation, TICK_MS } from "@nightcell7/multiplayer-sim";

/**
 * Simulation load and soak harness (PRD §34.3).
 *
 * Establishes shard capacity by measurement rather than guesswork (PRD §30.4).
 * This runs the authoritative simulation in-process at full room capacity — it
 * measures the thing that actually costs CPU on a shard, without needing a
 * cluster of real clients to find a tick-budget regression.
 *
 * A separate network-level harness (real WebSocket clients against a deployed
 * shard) is the other half of the gate; this one is what runs in CI.
 *
 * Usage:
 *   pnpm loadtest                       # default: 20 rooms, 50 matches
 *   pnpm loadtest -- --rooms 40 --matches 10
 */

interface Options {
  rooms: number;
  matches: number;
  /** Cap each match so a soak run finishes in reasonable time. */
  maxTicksPerMatch: number;
}

function parseArgs(rawArgv: string[]): Options {
  const options: Options = { rooms: 20, matches: 50, maxTicksPerMatch: 3000 };
  // `pnpm loadtest -- --rooms 8` forwards a bare "--" separator; drop it or
  // every flag shifts by one and the defaults silently win.
  const argv = rawArgv.filter((token) => token !== "--");

  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = Number(argv[i + 1]);
    if (!Number.isFinite(value)) continue;
    if (key === "--rooms") options.rooms = value;
    if (key === "--matches") options.matches = value;
    if (key === "--ticks") options.maxTicksPerMatch = value;
  }
  return options;
}

/**
 * Shortened rules so matches actually reach a natural end inside the harness.
 *
 * The soak gate is about running the FULL match lifecycle repeatedly —
 * including scoring out, the end-of-match path and disposal. A run where every
 * match is cut off by the tick cap would only be measuring the steady state.
 */
const LOAD_TEST_RULES: MatchRules = {
  ...TDM_RULES,
  scoreLimit: 12,
  durationMs: 60_000,
  warmupMs: 0,
};

interface RoomHarness {
  sim: MatchSimulation;
  bots: BotController[];
}

function createRoom(index: number): RoomHarness {
  const sim = new MatchSimulation({
    matchId: `load_${index}`,
    map: ARDAVAN_YARD,
    rules: LOAD_TEST_RULES,
  });
  sim.startNow();

  const bots: BotController[] = [];
  for (let i = 0; i < TDM_RULES.maxPlayers; i += 1) {
    const id = `r${index}_p${i}`;
    sim.addPlayer({ id, userId: id, displayName: `Bot ${i}`, isBot: true });
    bots.push(new BotController(id, index * 100 + i + 1));
  }

  return { sim, bots };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  console.log(
    JSON.stringify({
      msg: "load test starting",
      rooms: options.rooms,
      matches: options.matches,
      playersPerRoom: TDM_RULES.maxPlayers,
      tickBudgetMs: TICK_MS,
    }),
  );

  const tickDurations: number[] = [];
  const heapSamples: number[] = [];
  let totalTicks = 0;
  let completedMatches = 0;
  /** Cut off by the tick cap — a truncated sample, NOT an aborted match. */
  let truncatedMatches = 0;

  const startedAt = performance.now();

  for (let batch = 0; completedMatches + truncatedMatches < options.matches; batch += 1) {
    const rooms: RoomHarness[] = [];
    const roomsThisBatch = Math.min(
      options.rooms,
      options.matches - completedMatches - truncatedMatches,
    );
    for (let i = 0; i < roomsThisBatch; i += 1) rooms.push(createRoom(batch * options.rooms + i));

    for (let tick = 0; tick < options.maxTicksPerMatch; tick += 1) {
      const tickStart = performance.now();

      let anyLive = false;
      for (const room of rooms) {
        if (room.sim.phase !== "live") continue;
        anyLive = true;
        for (const bot of room.bots) bot.update(room.sim);
        room.sim.step();
      }

      // Time to advance EVERY room one tick. This is the number that must stay
      // inside the 33.3 ms budget at certified capacity (PRD §30.4).
      tickDurations.push(performance.now() - tickStart);
      totalTicks += 1;

      if (!anyLive) break;
      if (tick % 300 === 0) heapSamples.push(process.memoryUsage().heapUsed);
    }

    for (const room of rooms) {
      if (room.sim.phase === "ended" && room.sim.terminationReason !== null) completedMatches += 1;
      else truncatedMatches += 1;
    }

    // Encourage collection between batches so the growth check reflects
    // retained memory rather than uncollected garbage.
    globalThis.gc?.();
  }

  const elapsedMs = performance.now() - startedAt;
  const sorted = [...tickDurations].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const worst = sorted[sorted.length - 1] ?? 0;

  const firstHeap = heapSamples[0] ?? 0;
  const lastHeap = heapSamples[heapSamples.length - 1] ?? 0;
  const heapGrowthMb = (lastHeap - firstHeap) / 1024 / 1024;

  // PRD §30.4: p95 simulation work below 20 ms at certified room capacity.
  const p95WithinBudget = p95 < 20;
  const noRunaway = heapGrowthMb < 128;

  // A run where nothing finished has not exercised the match lifecycle, so it
  // cannot certify anything even if the tick timings look fine.
  const exercisedFullLifecycle = completedMatches > 0;

  const report = {
    msg: "load test complete",
    rooms: options.rooms,
    matchesCompleted: completedMatches,
    matchesTruncatedByTickCap: truncatedMatches,
    totalTicks,
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(1)),
    tickMs: {
      p50: Number(p50.toFixed(3)),
      p95: Number(p95.toFixed(3)),
      p99: Number(p99.toFixed(3)),
      max: Number(worst.toFixed(3)),
      budget: Number(TICK_MS.toFixed(3)),
    },
    heapGrowthMb: Number(heapGrowthMb.toFixed(1)),
    gates: {
      p95WithinBudget,
      noRunawayMemory: noRunaway,
      exercisedFullLifecycle,
    },
    certifiedRoomsPerProcess: p95WithinBudget && exercisedFullLifecycle ? options.rooms : null,
  };

  console.log(JSON.stringify(report, null, 2));

  if (!p95WithinBudget) {
    console.error(
      `FAIL: p95 tick ${p95.toFixed(2)}ms exceeds the 20ms simulation budget at ${options.rooms} rooms.`,
    );
  }
  if (!noRunaway) {
    console.error(`FAIL: heap grew ${heapGrowthMb.toFixed(1)}MB across the soak run.`);
  }
  if (!exercisedFullLifecycle) {
    console.error(
      "FAIL: no match reached a natural end; raise --ticks so the run means something.",
    );
  }

  process.exitCode = p95WithinBudget && noRunaway && exercisedFullLifecycle ? 0 : 1;
}

void main();
