#!/usr/bin/env node
/**
 * Check the radio lines by ear-proxy, since nobody listens to 150 clips:
 * duration and peak of every processed clip, and (with --transcribe) a
 * speech-to-text pass over the processed audio, compared word for word with
 * the catalogue text. A line the transcriber cannot read through the radio
 * treatment is a line a player cannot either.
 *
 *   node tools/audio/comms/check.mjs [--transcribe] [--only side/id,...]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CATALOGUE = JSON.parse(readFileSync(join(ROOT, "apps/game/src/comms-lines.json"), "utf8"));
const OUT = join(ROOT, "apps/game/public/audio/comms");
const args = process.argv.slice(2);
const transcribe = args.includes("--transcribe");
const only = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1].split(",")) : null;

const words = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

function similarity(a, b) {
  const x = words(a);
  const y = new Set(words(b));
  if (!x.length) return 1;
  return x.filter((w) => y.has(w)).length / x.length;
}

let failures = 0;
const rows = [];
for (const [side, lines] of Object.entries(CATALOGUE.lines)) {
  for (const [id, line] of Object.entries(lines)) {
    const key = `${side}/${id}`;
    if (only && !only.has(key)) continue;
    const file = join(OUT, side, `${id}.mp3`);
    if (!existsSync(file)) {
      rows.push(`MISSING ${key}`);
      failures += 1;
      continue;
    }
    const duration = Number(
      execFileSync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        file,
      ])
        .toString()
        .trim(),
    );
    const vol = spawnSync("ffmpeg", [
      "-i",
      file,
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-",
    ]).stderr.toString();
    const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(vol)?.[1] ?? "NaN");
    let heard = "";
    let score = 1;
    if (transcribe) {
      const form = new FormData();
      form.append("model", "gpt-4o-mini-transcribe");
      form.append("file", new Blob([readFileSync(file)], { type: "audio/mpeg" }), `${id}.mp3`);
      const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
      });
      heard = (await r.json()).text ?? "";
      // A lone callsign ("Rook,") is transcribed phonetically ("rok"); only
      // real sentences are compared word for word.
      score = words(line.text).length > 1 ? similarity(line.text, heard) : 1;
    }
    const bad = duration > 9 || duration < 0.3 || peak > -0.1 || score < 0.75;
    if (bad) failures += 1;
    rows.push(
      `${bad ? "BAD " : "ok  "}${key.padEnd(40)} ${duration.toFixed(2)}s peak ${peak}dB` +
        (transcribe ? ` ${(score * 100).toFixed(0)}% "${heard}"` : ""),
    );
  }
}
console.log(rows.join("\n"));
console.log(`${failures} failing`);
process.exitCode = failures ? 1 : 0;
