import type { ReactNode } from "react";

/**
 * Shared shell for the site's text pages.
 *
 * Keeps every secondary page on the same editorial grid as the campaign pages
 * so legal and support content does not read like it was bolted on
 * (PRD §21.5).
 */
export function PageShell({
  label,
  title,
  lede,
  children,
}: {
  label: string;
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  return (
    <section className="section" style={{ borderTop: "none" }}>
      <div className="shell">
        <p className="section__label">{label}</p>
        <h2>{title}</h2>
        {lede ? <p className="lede">{lede}</p> : null}
        <div className="prose">{children}</div>
      </div>
    </section>
  );
}

/**
 * Marks content that is a working draft rather than a reviewed document.
 *
 * The legal and cultural review gates in PRD §36 are not met yet, and a
 * storefront that implies otherwise is worse than one that says so.
 */
export function DraftNotice({ children }: { children: ReactNode }) {
  return (
    <aside className="notice" role="note">
      {children}
    </aside>
  );
}
