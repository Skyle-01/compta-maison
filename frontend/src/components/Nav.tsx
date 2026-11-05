"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, frenchDate, UNCATEGORIZED_CHANGED } from "@/lib/api";
import { NAV_GROUPS } from "@/lib/nav";

/** The report is opened from the dashboard, so it keeps « Le mois » current. */
function isCurrent(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/rapport");
  return pathname.startsWith(href);
}

/** The uncategorised count next to « À classer »: amber while there is work, grey at zero. */
function CountBadge({ count }: { count: number }) {
  return (
    <span
      className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums ${
        count > 0 ? "bg-amber-100 text-amber-900" : "bg-zinc-100 text-zinc-600"
      }`}
    >
      {count}
    </span>
  );
}

/** The navigation, in three labelled groups (to look at, to work on, to configure); « À classer »
 *  carries the uncategorised count, refreshed on every page change and whenever a page signals a
 *  categorisation (notifyUncategorizedChanged). */
export default function Nav() {
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () =>
      api
        .uncategorizedCount()
        .then(setCount)
        .catch(() => setCount(null));
    refresh();
    api
      .latestTransactionDate()
      .then(setLatest)
      .catch(() => setLatest(null));
    window.addEventListener(UNCATEGORIZED_CHANGED, refresh);
    return () => window.removeEventListener(UNCATEGORIZED_CHANGED, refresh);
  }, [pathname]);

  return (
    <nav className="mx-auto flex max-w-5xl items-stretch gap-3 px-6 whitespace-nowrap" aria-label="Navigation principale">
      <span className="self-center pr-1 font-semibold tracking-tight">compta</span>
      {NAV_GROUPS.map((group, i) => (
        <div
          key={group.label}
          role="group"
          aria-label={group.label}
          className={`flex flex-col ${i > 0 ? "border-l border-zinc-200 pl-3" : ""}`}
        >
          <span className="pt-1.5 text-[11px] font-medium leading-4 text-zinc-500">{group.label}</span>
          <div className="flex gap-3.5">
            {group.items.map(({ href, label }) => {
              const current = isCurrent(href, pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={`-mb-px flex items-center border-b-2 pb-2 pt-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${
                    current
                      ? "border-zinc-900 font-medium text-zinc-900"
                      : "border-transparent text-zinc-600 hover:text-zinc-900"
                  }`}
                >
                  {label}
                  {href === "/a-classer" && count != null && <CountBadge count={count} />}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      {latest && (
        <span
          className="ml-auto self-start pt-1.5 text-xs text-zinc-500"
          title="Date de valeur de l’opération la plus récente"
        >
          Dernière opération : {frenchDate(latest)}
        </span>
      )}
    </nav>
  );
}
