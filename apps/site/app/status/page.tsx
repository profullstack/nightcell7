import type { Metadata } from "next";
import { PageShell } from "../_components/page-shell";

export const metadata: Metadata = { title: "Service Status" };

/** Always live: a status page that can be cached is not a status page. */
export const dynamic = "force-dynamic";

interface Probe {
  name: string;
  path: string;
  ok: boolean;
  detail: string;
}

async function probe(name: string, path: string): Promise<Probe> {
  const origin = process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:8080";
  try {
    const response = await fetch(`${origin}${path}`, { cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      name,
      path,
      ok: response.ok,
      detail: response.ok
        ? (JSON.stringify(body.details ?? body.status ?? "ok") ?? "ok")
        : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      name,
      path,
      ok: false,
      detail: error instanceof Error ? error.message : "unreachable",
    };
  }
}

export default async function StatusPage() {
  const [api, multiplayer] = await Promise.all([
    probe("API", "/api/v1/version"),
    probe("Multiplayer", "/api/v1/multiplayer/status"),
  ]);
  const checkedAt = new Date().toISOString();
  const allOk = api.ok && multiplayer.ok;

  return (
    <PageShell
      label="Operations"
      title="Service status"
      lede="Measured when you loaded this page, not cached."
    >
      <p style={{ fontSize: "1.1rem" }}>
        <span className="tag" style={{ color: allOk ? "var(--success)" : "var(--signal-red)" }}>
          {allOk ? "All systems operational" : "Degraded"}
        </span>
      </p>

      <table className="table">
        <thead>
          <tr>
            <th>Service</th>
            <th>State</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {[api, multiplayer].map((p) => (
            <tr key={p.name}>
              <td>{p.name}</td>
              <td style={{ color: p.ok ? "var(--success)" : "var(--signal-red)" }}>
                {p.ok ? "operational" : "unavailable"}
              </td>
              <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>{p.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="price-note">Checked {checkedAt}</p>

      <h3>What this page does not show</h3>
      <p>
        There is no live player count here. Publishing one before a real population exists would be
        theatre, and a fabricated number is worse than no number.
      </p>

      <h3>Known limitations</h3>
      <ul>
        <li>Single region, single shard.</li>
        <li>
          Payments, email and content downloads are not yet configured with production credentials.
        </li>
        <li>The whole stack runs as one deployment, so any restart briefly affects everything.</li>
      </ul>
    </PageShell>
  );
}
