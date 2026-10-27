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
  // Browsers drop tabs and newlines from URLs, so "/\t/evil.com" (sent as
  // ?next=/%09/evil.com) would land on //evil.com. No control characters or
  // backslashes anywhere.
  for (const ch of next) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || ch === "\\") return null;
  }
  return next;
}
