/**
 * Minimal static server for the built game.
 *
 * A dependency-free replacement for the separate `game-web` Caddy service,
 * started by `start-all.mjs`. Content-hashed assets are cached hard; the shell
 * must revalidate so an update is actually picked up (PRD §27.4).
 *
 * Two things a real file server does that this one used to skip, both found
 * when Þrøngva's album shipped and not one track of it played in production:
 *
 * - **The URL is percent-decoded before it touches the filesystem.** The
 *   browser asks for `Þrøngva/After%20the%20Winter%20of%20Want/001.%20...`;
 *   looking that up literally finds nothing, and the SPA fallback answered
 *   every track with `index.html` and a 200. Any file with a space or a
 *   non-ASCII letter in its name had never been servable, including the old
 *   `More Than Enough.mp3`.
 * - **Byte ranges.** An `<audio>` element seeks and, in Safari, starts
 *   playback with `Range` requests, and Safari will not play media from a
 *   server that ignores them. Files are streamed rather than read whole, so a
 *   9 MB track is not buffered in memory per listener.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ktx2": "image/ktx2",
  ".glb": "model/gltf-binary",
  ".webm": "audio/webm",
  ".mp3": "audio/mpeg",
  ".m3u": "audio/x-mpegurl",
  ".wasm": "application/wasm",
};

/**
 * Parse a single `bytes=` range against a file size.
 *
 * Returns `null` when there is no usable range header (serve the whole file),
 * `"invalid"` for a range that cannot be satisfied (416), or the inclusive
 * `[start, end]`. Multi-range requests are answered with the whole file, which
 * the spec allows and no media element sends.
 */
export function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, from, to] = match;
  if (from === "" && to === "") return "invalid";
  let start;
  let end;
  if (from === "") {
    // Suffix range: the last N bytes.
    const length = Number(to);
    if (length === 0) return "invalid";
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(from);
    end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return [start, end];
}

/** @param {string} dist absolute path of the built game */
export function createGameServer(dist) {
  const root = path.resolve(dist);

  const sendShell = (req, res) => {
    // SPA fallback so client-side routes work on reload.
    fs.readFile(path.join(root, "index.html"), (error, html) => {
      if (error) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : html);
    });
  };

  return http.createServer((req, res) => {
    let url;
    try {
      url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    } catch {
      // Malformed percent-encoding.
      res.writeHead(400).end();
      return;
    }

    if (url === "/health/live" || url === "/health/ready") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "game-web" }));
      return;
    }

    // Strip the /play prefix the gateway forwards.
    let relative = url.replace(/^\/play(?=\/|$)/, "") || "/";
    if (relative.endsWith("/")) relative += "index.html";

    // Resolve and confirm the result stays inside dist: a static server is a
    // classic path-traversal surface, and decoding makes `%2e%2e%2f` a real
    // `../`. The separator matters: a bare prefix test would also admit a
    // sibling directory such as `dist-old`.
    const resolved = path.resolve(root, `.${relative}`);
    if (relative.includes("\0") || !resolved.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }

    fs.stat(resolved, (error, stat) => {
      if (error || !stat.isFile()) {
        sendShell(req, res);
        return;
      }

      const hashed = /\.[a-f0-9]{8,}\./.test(path.basename(resolved));
      const headers = {
        "content-type": TYPES[path.extname(resolved).toLowerCase()] ?? "application/octet-stream",
        "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
        "accept-ranges": "bytes",
      };

      const range = parseRange(req.headers.range, stat.size);
      if (range === "invalid") {
        res.writeHead(416, { ...headers, "content-range": `bytes */${stat.size}` }).end();
        return;
      }
      const [start, end] = range ?? [0, stat.size - 1];
      const length = stat.size === 0 ? 0 : end - start + 1;
      res.writeHead(range ? 206 : 200, {
        ...headers,
        "content-length": length,
        ...(range ? { "content-range": `bytes ${start}-${end}/${stat.size}` } : {}),
      });
      if (req.method === "HEAD" || length === 0) {
        res.end();
        return;
      }
      fs.createReadStream(resolved, { start, end })
        .on("error", () => res.destroy())
        .pipe(res);
    });
  });
}
