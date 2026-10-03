"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, UNCATEGORIZED_CHANGED } from "@/lib/api";

const NAV = [
  { href: "/", label: "Tableau de bord" },
  { href: "/transactions", label: "Transactions" },
  { href: "/a-classer", label: "À classer" },
  { href: "/import", label: "Importer" },
  { href: "/settings", label: "Réglages" },
];

/** The top navigation; « À classer » carries the uncategorised count, refreshed on every page
 *  change and whenever a page signals a categorisation (notifyUncategorizedChanged). */
export default function Nav() {
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const refresh = () =>
      api
        .uncategorizedCount()
        .then(setCount)
        .catch(() => setCount(null));
    refresh();
    window.addEventListener(UNCATEGORIZED_CHANGED, refresh);
    return () => window.removeEventListener(UNCATEGORIZED_CHANGED, refresh);
  }, [pathname]);

  return (
    <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
      <span className="font-semibold tracking-tight">compta</span>
      {NAV.map(({ href, label }) => (
        <Link key={href} href={href} className="text-sm text-zinc-600 hover:text-zinc-900">
          {label}
          {href === "/a-classer" && count != null && ` (${count})`}
        </Link>
      ))}
    </nav>
  );
}
