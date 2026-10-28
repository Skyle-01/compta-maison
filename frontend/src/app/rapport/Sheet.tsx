import type { ReactNode } from "react";
import { reportTitle } from "@/lib/report";

/** One A4 page of the report (see .sheet in globals.css): previewed on screen at its print width. */
export default function Sheet({
  title,
  month,
  landscape,
  children,
}: {
  title: string;
  month: string;
  landscape?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`sheet ${landscape ? "sheet-landscape" : ""}`}>
      <header className="mb-4 flex items-baseline justify-between border-b border-zinc-200 pb-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="text-xs text-zinc-500">{reportTitle(month)}</span>
      </header>
      {children}
    </section>
  );
}
