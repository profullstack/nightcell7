/**
 * The pit.world global footer (site name, search, ring, publish), fetched on
 * the server and cached for an hour. Any failure renders nothing: the network
 * footer must never break a page.
 */
const PIT_FOOTER_URL = "https://pit.world/snippets/footer.html?site=nightcell7.com";

export async function PitFooter() {
  try {
    const res = await fetch(PIT_FOOTER_URL, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (!html.includes("data-pit-footer")) return null;
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return null;
  }
}
