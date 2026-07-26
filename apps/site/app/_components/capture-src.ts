/**
 * URL for an in-engine capture.
 *
 * A single place to build these, so the caching rules stay in one file rather
 * than being re-derived at six call sites.
 *
 * **No cache-busting query string.** The obvious fix for stale captures is
 * `?v=<capture time>`, but Next refuses a query on a local image unless it is
 * whitelisted in `images.localPatterns`, and that matches `search` exactly —
 * a value that changes on every capture cannot be whitelisted, and the site
 * build fails outright. Staleness is handled in `next.config.ts` instead:
 * `minimumCacheTTL: 0` makes the optimiser emit `max-age=0, must-revalidate`
 * rather than its four-hour default, and an explicit header does the same for
 * the raw files. With the ETag Next already sends, an unchanged image costs a
 * 304 instead of a re-download.
 */
export function captureSrc(file: string): string {
  return `/media/yard/${file}`;
}
