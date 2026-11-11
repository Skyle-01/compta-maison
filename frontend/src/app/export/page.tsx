"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import HelpLink from "@/components/HelpLink";
import { useFilters } from "@/components/FiltersProvider";
import { frenchMonth } from "@/lib/api";
import {
  DEFAULT_OPTIONS,
  lastCompleteMonths,
  parseReportRequest,
  reportSearch,
} from "@/lib/reportRequest";

/** How many months the « derniers mois clos » shortcut ticks (the statement's width). */
const RECENT_MONTHS = 6;

const PANEL = "rounded-lg border border-zinc-200 bg-white p-4";

export default function ExportPage() {
  const router = useRouter();
  const { ready, months, partial } = useFilters();
  const [selected, setSelected] = useState<string[]>([]);
  const [operations, setOperations] = useState(DEFAULT_OPTIONS.operations);
  const [flow, setFlow] = useState(DEFAULT_OPTIONS.flow);
  const initialised = useRef(false);

  // The dashboard's « Exporter » link carries ?month=; without it, the latest complete month. Read once.
  useEffect(() => {
    if (!ready || initialised.current) return;
    initialised.current = true;
    setSelected(parseReportRequest(window.location.search, months).months);
  }, [ready, months]);

  const toggle = (month: string) =>
    setSelected((current) => (current.includes(month) ? current.filter((m) => m !== month) : [...current, month]));
  const chosen = months.filter((m) => selected.includes(m));
  const count = chosen.length;

  const openPdf = () => {
    const request = { months: [...chosen].sort(), operations, flow };
    router.push(`/rapport?${reportSearch(request)}`);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">
        Export
        <HelpLink page="/export" />
      </h1>
      <p className="text-sm text-zinc-600">
        Le rapport du foyer, pour quelqu&apos;un qui ne connaît pas l&apos;application : un PDF à imprimer ou à envoyer.
      </p>

      {ready && months.length === 0 ? (
        <p className="text-zinc-500">Aucune transaction pour l&apos;instant : rien à exporter.</p>
      ) : (
        <>
          <section className={`${PANEL} space-y-3`}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-semibold">Mois à exporter</h2>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <button
                  type="button"
                  className="text-zinc-600 underline hover:text-zinc-900 hover:no-underline"
                  onClick={() => setSelected(lastCompleteMonths(months, 1))}
                >
                  Dernier mois clos
                </button>
                <button
                  type="button"
                  className="text-zinc-600 underline hover:text-zinc-900 hover:no-underline"
                  onClick={() => setSelected(lastCompleteMonths(months, RECENT_MONTHS))}
                >
                  {RECENT_MONTHS} derniers mois clos
                </button>
                <button
                  type="button"
                  className="text-zinc-600 underline hover:text-zinc-900 hover:no-underline"
                  onClick={() => setSelected(months)}
                >
                  Tous
                </button>
                <button
                  type="button"
                  className="text-zinc-600 underline hover:text-zinc-900 hover:no-underline"
                  onClick={() => setSelected([])}
                >
                  Aucun
                </button>
              </div>
            </div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3 md:grid-cols-4">
              {months.map((m, i) => (
                <li key={m}>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={selected.includes(m)} onChange={() => toggle(m)} />
                    <span>{frenchMonth(m)}</span>
                    {i === 0 && <span className="text-xs text-zinc-500">en cours</span>}
                    {partial.includes(m) && <span className="text-xs text-zinc-500">partiel</span>}
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-xs text-zinc-500">
              {count === 0 ? "Aucun mois choisi." : `${count} mois choisi${count > 1 ? "s" : ""}.`} Un mois va d&apos;une
              paie à la suivante ; le mois en cours n&apos;est pas encore clos, ses chiffres bougeront.
            </p>
          </section>

          <section className={`${PANEL} space-y-3`}>
            <div>
              <h2 className="font-semibold">PDF</h2>
              <p className="mt-1 text-sm text-zinc-600">
                Des pages A4, un rapport complet par mois, à enregistrer en PDF depuis la fenêtre d&apos;impression.
              </p>
            </div>
            <div className="space-y-1.5 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={operations} onChange={(e) => setOperations(e.target.checked)} />
                Détail des opérations dans « Détail par catégorie »
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={flow} onChange={(e) => setFlow(e.target.checked)} />
                Diagramme des flux d&apos;argent (une page paysage par mois)
              </label>
            </div>
            <button type="button" className="btn-primary" disabled={count === 0} onClick={openPdf}>
              Ouvrir le rapport PDF
            </button>
          </section>
        </>
      )}
    </div>
  );
}
