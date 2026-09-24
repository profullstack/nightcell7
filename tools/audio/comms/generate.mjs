#!/usr/bin/env node
/**
 * Squad radio: voice every line in apps/game/src/comms-lines.json, then put it
 * on the radio.
 *
 *   node tools/audio/comms/generate.mjs [--only nightcell/order_move_out,...] [--fx-only]
 *
 * 1. Voice. OpenAI text-to-speech (`gpt-4o-mini-tts`) with the per-speaker
 *    direction in the catalogue. The delivered FLAC is the master, kept in
 *    docs/audio/comms/raw/<side>/<id>.flac and never overwritten: speech
 *    synthesis is not bit-reproducible, so unlike the synthesised effects the
 *    master is the provenance record.
 * 2. Radio. ffmpeg band-limits the voice to a handset (350 Hz to 3.2 kHz),
 *    compresses and soft-clips it, lays channel hiss under it, and frames it
 *    with a key-up click and a squelch tail. Lines addressed to the player
 *    ("push the hardpoint") skip the key-up click, and callsigns ("Rook,")
 *    skip the tail, so the game can play callsign + order as one transmission.
 *    Output: apps/game/public/audio/comms/<side>/<id>.mp3, mono 24 kHz.
 *
 * docs/audio/comms/manifest.json records model, voice, direction, text, date
 * and hashes for every line.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CATALOGUE = JSON.parse(readFileSync(join(ROOT, "apps/game/src/comms-lines.json"), "utf8"));
const RAW = join(ROOT, "docs/audio/comms/raw");
const OUT = join(ROOT, "apps/game/public/audio/comms");
const MANIFEST = join(ROOT, "docs/audio/comms/manifest.json");
const MODEL = process.env.NC7_TTS_MODEL ?? "gpt-4o-mini-tts";

const args = process.argv.slice(2);
const only = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1].split(",")) : null;
const fxOnly = args.includes("--fx-only");
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { lines: {} };
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

async function speak(text, voice) {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      voice: voice.voice,
      input: text,
      instructions: voice.instructions,
      response_format: "flac",
    }),
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer());
}

/** The handset: band-limited, squashed, a little dirty, with hiss and squelch. */
function radio(input, output, { keyUp, tail }) {
  const voice =
    "[0:a]aresample=24000,aformat=channel_layouts=mono," +
    // Trim the synthesiser's lead-in and tail: a callout is a burst, not a pause.
    "silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.03," +
    "areverse,silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.14,areverse," +
    "highpass=f=350:poles=2,lowpass=f=3200:poles=2," +
    "acompressor=threshold=0.06:ratio=9:attack=2:release=90:makeup=5," +
    "asoftclip=type=atan:threshold=0.55,volume=0.8,apad=pad_dur=0.04[v];" +
    "anoisesrc=color=white:amplitude=0.018:sample_rate=24000,highpass=f=900,lowpass=f=3600[hiss];" +
    "[v][hiss]amix=inputs=2:duration=first:normalize=0[body]";
  const click =
    "aevalsrc='0.55*sin(2*PI*1750*t)*exp(-t*70)+0.25*(random(0)-0.5)*exp(-t*40)':s=24000:d=0.07[click]";
  const squelch =
    "anoisesrc=color=white:amplitude=0.32:sample_rate=24000:duration=0.2,highpass=f=700,lowpass=f=4200," +
    "afade=t=out:st=0.05:d=0.15[squelch]";
  const parts = [voice];
  const chain = [];
  if (keyUp) {
    parts.push(click);
    chain.push("[click]");
  }
  chain.push("[body]");
  if (tail) {
    parts.push(squelch);
    chain.push("[squelch]");
  }
  const graph = `${parts.join(";")};${chain.join("")}concat=n=${chain.length}:v=0:a=1[out]`;
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    input,
    "-filter_complex",
    graph,
    "-map",
    "[out]",
    "-ac",
    "1",
    "-ar",
    "24000",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "48k",
    output,
  ]);
}

const jobs = [];
for (const [side, lines] of Object.entries(CATALOGUE.lines)) {
  mkdirSync(join(RAW, side), { recursive: true });
  mkdirSync(join(OUT, side), { recursive: true });
  for (const [id, line] of Object.entries(lines)) {
    const key = `${side}/${id}`;
    if (only && !only.has(key)) continue;
    jobs.push({ side, id, key, line, voice: CATALOGUE.voices[side][line.speaker] });
  }
}

// A few at a time: the speech endpoint rate-limits bursts.
const queue = [...jobs];
async function worker() {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const raw = join(RAW, job.side, `${job.id}.flac`);
    if (!existsSync(raw)) {
      if (fxOnly) throw new Error(`${job.key}: no master`);
      writeFileSync(raw, await speak(job.line.text, job.voice));
      manifest.lines[job.key] = {
        model: MODEL,
        voice: job.voice.voice,
        instructions: job.voice.instructions,
        text: job.line.text,
        generated: new Date().toISOString(),
      };
    }
    const out = join(OUT, job.side, `${job.id}.mp3`);
    const addressed = /^[a-z]/.test(job.line.text);
    const callsign = job.id.startsWith("callsign_");
    radio(raw, out, { keyUp: !addressed, tail: !callsign });
    manifest.lines[job.key].sha256 = sha(raw);
    console.log("ok", job.key);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${jobs.length} lines`);
