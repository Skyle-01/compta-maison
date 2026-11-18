"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { gapCount } from "@/lib/recurrences";

/** « Le mois » one-line pointer to the flagged recurring flows. Hidden at zero, while loading and on
 *  error: the line is a hint, the page itself reports failures. */
export default function RecurrencesGlance() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    api
      .recurrences(null)
      .then((data) => setCount(gapCount(data.items)))
      .catch(() => setCount(0));
  }, []);
  if (count === 0) return null;
  return (
    <p className="text-sm text-zinc-500">
      {count} écart{count > 1 ? "s" : ""} sur vos flux récurrents.{" "}
      <Link href="/recurrents" className="font-medium underline hover:no-underline">
        Voir les récurrents →
      </Link>
    </p>
  );
}
