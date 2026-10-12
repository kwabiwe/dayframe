import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The place editor's page in Blocks (UIA-308), matching iPhone's place editor (7b): "‹ Places"
 * back to the Library's Places tab, the display-face title, then the editor's groups.
 */
export function PlaceEditorPage({ children, subtitle, title }: { children: ReactNode; subtitle: string; title: string }) {
  return (
    <div className="df-pe-page">
      <Link className="df-pe-back" href="/places">
        <span aria-hidden="true" className="df-pe-back-mark">‹</span>
        Places
      </Link>
      <div className="df-page-head">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
