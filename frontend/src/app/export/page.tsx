"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import HelpLink from "@/components/HelpLink";
import { useFilters } from "@/components/FiltersProvider";
import { errorMessage, frenchMonth } from "@/lib/api";
import { buildMobileReport, reportFileName } from "@/lib/mobileReport";
import { loadReport } from "@/lib/reportData";
import { DEFAULT_OPTIONS, lastCompleteMonths, parseReportRequest, reportSearch } from "@/lib/reportRequest";

/** How many months the « derniers mois clos » shortcut ticks (the statement's width). */
const RECENT_MONTHS = 6;

const PANEL = "rounded-lg border border-zinc-200 bg-white p-4";
const LINK_BUTTON = "text-zinc-600 underline hover:text-zinc-900 hover:no-underline";

export default function ExportPage() {
  const router = useRouter();
  const { ready, months, partial } = useFilters();
  const [selected, setSelected] = useState<string[]>([]);
  const [pdfOperations, setPdfOperations] = useState(DEFAULT_OPTIONS.operations);
  const [flow, setFlow] = useState(DEFAULT_OPTIONS.flow);
  // A shared HTML file lists only totals unless asked: it is easy to forward.
  const [htmlOperations, setHtmlOperations] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialised = useRef(false);

  // The dashboard's « Exporter » link carries ?month=; without it, the latest complete month. Read once.
  useEffect(() => {
    if (!ready || initialised.current) return;
    initialised.current = true;
    setSelected(parseReportRequest(window.location.search, months).months);
  }, [ready, months]);

  const toggle = (month: string) =>
    setSelected((current) => (current.includes(month) ? current.filter((m) => m !== month) : [...current, month]));
  const chosen = months.filter((m) => selected.includes(m)).sort();
  const count = chosen.length;

  const openPdf = () => {
    router.push(`/rapport?${reportSearch({ months: chosen, operations: pdfOperations, flow })}`);
  };

  /** Builds the HTML page for the chosen months, then saves it or opens it in a new tab. */
  const makeHtml = async (action: "download" | "preview") => {
    setBusy(true);
    setError(null);
    // Open the tab inside the click, before the awaits: browsers block a window opened later.
    const preview = action === "preview" ? window.open("", "_blank") : null;
    try {
      const reports = await Promise.all(chosen.map((m) => loadReport(months, m, htmlOperations)));
      const html = buildMobileReport({
        reports,
        months: chosen,
        available: months,
        operations: htmlOperations,
        today: new Date(),
      });
      const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
      if (preview) {
        preview.location.href = url;
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = reportFileName(chosen);
        link.click();
      }
      // The preview tab keeps reading the blob for a while: release it later.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      preview?.close();
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">
        Export
        <HelpLink page="/export" />
      </h1>
      <p className="text-sm text-zinc-600">
        Le rapport du foyer, pour quelqu&apos;un qui ne connaît pas l&apos;application : un PDF à imprimer ou une
        page web à lire sur un téléphone.
      </p>

      {ready && months.length === 0 ? (
        <p className="text-zinc-500">Aucune transaction pour l&apos;instant : rien à exporter.</p>
      ) : (
        <>
          <section className={`${PANEL} space-y-3`}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-semibold">Mois à exporter</h2>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <button type="button" className={LINK_BUTTON} onClick={() => setSelected(lastCompleteMonths(months, 1))}>
                  Dernier mois clos
                </button>
                <button
                  type="button"
                  className={LINK_BUTTON}
                  onClick={() => setSelected(lastCompleteMonths(months, RECENT_MONTHS))}
                >
                  {RECENT_MONTHS} derniers mois clos
                </button>
                <button type="button" className={LINK_BUTTON} onClick={() => setSelected(months)}>
                  Tous
                </button>
                <button type="button" className={LINK_BUTTON} onClick={() => setSelected([])}>
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
              {count === 0 ? "Aucun mois choisi." : `${count} mois choisi${count > 1 ? "s" : ""}.`} Un mois va
              d&apos;une paie à la suivante ; le mois en cours n&apos;est pas encore clos, ses chiffres bougeront.
            </p>
          </section>

          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <section className={`${PANEL} flex flex-col gap-3`}>
              <div>
                <h2 className="font-semibold">PDF</h2>
                <p className="mt-1 text-sm text-zinc-600">
                  Des pages A4, un rapport complet par mois, à enregistrer depuis la fenêtre d&apos;impression.
                </p>
              </div>
              <div className="space-y-1.5 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={pdfOperations}
                    onChange={(e) => setPdfOperations(e.target.checked)}
                  />
                  Détail des opérations
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={flow} onChange={(e) => setFlow(e.target.checked)} />
                  Diagramme des flux d&apos;argent
                </label>
              </div>
              <div className="mt-auto">
                <button type="button" className="btn-primary" disabled={count === 0} onClick={openPdf}>
                  Ouvrir le rapport PDF
                </button>
              </div>
            </section>

            <section className={`${PANEL} flex flex-col gap-3`}>
              <div>
                <h2 className="font-semibold">Page web pour téléphone</h2>
                <p className="mt-1 text-sm text-zinc-600">
                  Un seul fichier HTML, lisible hors ligne sur un smartphone : à envoyer par mail ou messagerie.
                </p>
              </div>
              <div className="space-y-1.5 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={htmlOperations}
                    onChange={(e) => setHtmlOperations(e.target.checked)}
                  />
                  Détail des opérations
                </label>
                <p className="text-xs text-zinc-500">
                  Décoché, le fichier ne contient que des totaux par catégorie : à préférer pour un fichier qui
                  circule. Coché, il liste les libellés de chaque opération.
                </p>
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={count === 0 || busy}
                  onClick={() => makeHtml("download")}
                >
                  {busy ? "Préparation…" : "Télécharger la page HTML"}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={count === 0 || busy}
                  onClick={() => makeHtml("preview")}
                >
                  Aperçu
                </button>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
