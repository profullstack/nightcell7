/**
 * A `?next=` value that is a path on this origin, or null. Rejects `//host`
 * and `/\\host` (both are protocol-relative to a browser), and anything
 * absolute, so the parameter cannot be used as an open redirect.
 */
export function safeNext(search: string): string | null {
  const next = new URLSearchParams(search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return null;
  }
  return next;
}
