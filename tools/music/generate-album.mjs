#!/usr/bin/env node
/**
 * Render a Þrøngva album from its lyric sheet.
 *
 *   node tools/music/generate-album.mjs docs/music/when-the-ravens-lied/album.md [--check] [--suno] [--only 03]
 *
 * The lyric sheet (see its "Format" section) is parsed into one ElevenLabs
 * composition plan per track: album-wide styles, per-track styles, and per
 * section a duration, local styles and the lines to sing. Each track is
 * rendered with the Music API, tagged with ffmpeg (title, artist, album, track
 * number, lyrics) and written to
 * `apps/game/public/audio/music/Þrøngva/<album>/NNN. <title>.mp3`, which is all
 * the game needs: the soundtrack plugin discovers it by walking the folder.
 *
 * - `--check` parses and validates only. No network, no key.
 * - `--suno` also writes Suno-ready sheets (style prompt + bracket-tagged
 *   lyrics) beside the lyric sheet, the manual path the first album took.
 * - `--only NN` renders one track. Existing MP3s are skipped, so a rerun
 *   resumes; delete a file to re-render it.
 *
 * Needs ELEVENLABS_API_KEY with the `music_generation` permission.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ARTIST = "Þrøngva";
const API = "https://api.elevenlabs.io/v1/music";
// Best first: uncompressed PCM becomes the WAV master (CLAUDE.md), then one
// 320 kbps encode. Lower tiers refuse PCM, so fall back to the best MP3.
const FORMATS = ["pcm_48000", "pcm_44100", "mp3_44100_192", "mp3_44100_128"];
const MP3_BITRATE = "320k";
// Music API limits: a section is 3 s to 120 s, a song at most 5 minutes.
const SECTION_MIN_MS = 3_000;
const SECTION_MAX_MS = 120_000;
const SONG_MAX_MS = 300_000;

const list = (s) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export function parseAlbum(text) {
  const album = { title: "", style: [], avoid: [], tracks: [] };
  let track = null;
  let section = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const h1 = /^# (.+)$/.exec(line);
    if (h1 && !track && !album.title) {
      album.title = h1[1].split(":").slice(1).join(":").trim() || h1[1];
      continue;
    }
    if (line.startsWith("ALBUM-STYLE:")) album.style = list(line.slice(12));
    else if (line.startsWith("ALBUM-AVOID:")) album.avoid = list(line.slice(12));
    const t = /^# (\d+)\. (.+)$/.exec(line);
    if (t) {
      track = { number: Number(t[1]), title: t[2].trim(), style: [], avoid: [], sections: [] };
      album.tracks.push(track);
      section = null;
      continue;
    }
    if (!track) continue;
    if (line.startsWith("style:")) track.style = list(line.slice(6));
    else if (line.startsWith("avoid:")) track.avoid = list(line.slice(6));
    else if (line.startsWith("## ")) {
      const [name, style, seconds] = line.slice(3).split("|").map((x) => x.trim());
      section = { name, style: list(style ?? ""), ms: Math.round(Number(seconds) * 1000), lines: [] };
      track.sections.push(section);
    } else if (line && section) section.lines.push(line);
  }
  return album;
}

export function validate(album) {
  const problems = [];
  if (album.tracks.length === 0) problems.push("no tracks");
  album.tracks.forEach((t, i) => {
    if (t.number !== i + 1) problems.push(`track ${t.title}: numbered ${t.number}, expected ${i + 1}`);
    const total = t.sections.reduce((n, s) => n + s.ms, 0);
    if (total > SONG_MAX_MS) problems.push(`${t.title}: ${total / 1000}s is over ${SONG_MAX_MS / 1000}s`);
    for (const s of t.sections) {
      if (!(s.ms >= SECTION_MIN_MS && s.ms <= SECTION_MAX_MS))
        problems.push(`${t.title} / ${s.name}: ${s.ms}ms is outside ${SECTION_MIN_MS}-${SECTION_MAX_MS}ms`);
      for (const l of s.lines) if (l.length > 200) problems.push(`${t.title} / ${s.name}: line over 200 chars`);
    }
  });
  return problems;
}

export function compositionPlan(album, track) {
  return {
    positive_global_styles: [...album.style, ...track.style],
    negative_global_styles: [...album.avoid, ...track.avoid],
    sections: track.sections.map((s) => ({
      section_name: s.name,
      positive_local_styles: s.style,
      negative_local_styles: [],
      duration_ms: s.ms,
      lines: s.lines,
    })),
  };
}

/** Lyrics in the first album's convention: `[Section: direction]` then the lines. */
export function taggedLyrics(track) {
  return track.sections
    .map((s) => [`[${s.name}${s.style.length ? `: ${s.style.join(", ")}` : ""}]`, ...s.lines].join("\n"))
    .join("\n\n");
}

const fileStem = (track) => `${String(track.number).padStart(3, "0")}. ${track.title}`;

async function request(album, track, format) {
  return fetch(`${API}?output_format=${format}`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      model_id: "music_v1",
      composition_plan: compositionPlan(album, track),
      respect_sections_durations: true,
    }),
  });
}

async function render(album, track, out) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not set");
  let res;
  let format;
  for (format of FORMATS) {
    res = await request(album, track, format);
    if (res.ok) break;
    const body = await res.text();
    // Only a format the plan does not allow is worth another try.
    if (!/output_format|subscription|tier|not allowed|pcm/i.test(body) || res.status >= 500)
      throw new Error(`${track.title}: HTTP ${res.status} ${body.slice(0, 400)}`);
    console.log(`  ${format} refused (${res.status}), trying the next format`);
  }
  if (!res.ok) throw new Error(`${track.title}: no output format accepted`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const masters = join(REPO, "build/music-wav", album.title);
  mkdirSync(masters, { recursive: true });
  const master = join(masters, `${fileStem(track)}.${format.startsWith("pcm") ? "wav" : "mp3"}`);
  if (format.startsWith("pcm")) {
    const rate = format.split("_")[1];
    // Raw 16-bit little-endian stereo PCM, wrapped as the WAV master.
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "s16le", "-ar", rate, "-ac", "2", "-i", "pipe:0", master], { input: bytes });
  } else writeFileSync(master, bytes);
  execFileSync("ffmpeg", [
    "-v", "error", "-y", "-i", master,
    "-c:a", "libmp3lame", "-b:a", MP3_BITRATE, "-ar", "48000", "-id3v2_version", "3",
    "-metadata", `title=${track.title}`,
    "-metadata", `artist=${ARTIST}`,
    "-metadata", `album_artist=${ARTIST}`,
    "-metadata", `album=${album.title}`,
    "-metadata", `track=${track.number}/${album.tracks.length}`,
    "-metadata", "genre=Viking Metal / Hip-Hop",
    "-metadata", `date=${new Date().getUTCFullYear()}`,
    "-metadata", `lyrics-eng=${taggedLyrics(track)}`,
    "-metadata", `comment=made with elevenlabs music_v1 (${format}); created=${new Date().toISOString()}`,
    out,
  ]);
}

async function main() {
  const args = process.argv.slice(2);
  const sheet = args.find((a) => !a.startsWith("--") && a.endsWith(".md"));
  if (!sheet) throw new Error("usage: generate-album.mjs <album.md> [--check] [--suno] [--only NN]");
  const only = args.includes("--only") ? Number(args[args.indexOf("--only") + 1]) : null;
  const album = parseAlbum(readFileSync(sheet, "utf8"));
  const problems = validate(album);
  for (const t of album.tracks) {
    const secs = t.sections.reduce((n, s) => n + s.ms, 0) / 1000;
    console.log(`${fileStem(t)}  ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}  ${t.sections.length} sections`);
  }
  if (problems.length) throw new Error(`invalid album:\n  ${problems.join("\n  ")}`);

  if (args.includes("--suno")) {
    const dir = join(dirname(sheet), "suno");
    mkdirSync(dir, { recursive: true });
    for (const t of album.tracks) {
      const style = [...album.style, ...t.style].join(", ");
      writeFileSync(join(dir, `${fileStem(t)}.txt`), `STYLE:\n${style}\n\nEXCLUDE:\n${[...album.avoid, ...t.avoid].join(", ")}\n\nLYRICS:\n${taggedLyrics(t)}\n`);
    }
    console.log(`wrote ${album.tracks.length} Suno sheets to ${dir}`);
  }
  if (args.includes("--check")) return;

  const dir = join(REPO, "apps/game/public/audio/music", ARTIST, album.title);
  mkdirSync(dir, { recursive: true });
  for (const t of album.tracks) {
    if (only && t.number !== only) continue;
    const out = join(dir, `${fileStem(t)}.mp3`);
    if (existsSync(out)) {
      console.log(`skip ${basename(out)} (exists)`);
      continue;
    }
    console.log(`render ${basename(out)} ...`);
    await render(album, t, out);
  }
  const present = album.tracks.map((t) => `${fileStem(t)}.mp3`).filter((f) => existsSync(join(dir, f)));
  const m3u = join(dir, "playlist.m3u");
  writeFileSync(`${m3u}.tmp`, present.map((f) => `./${f}\n`).join(""));
  renameSync(`${m3u}.tmp`, m3u);
  console.log(`${present.length}/${album.tracks.length} tracks in ${dir}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
