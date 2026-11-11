"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { type Account, api, errorMessage, formatEuro, frenchMonth } from "@/lib/api";
import MoneyFlowChart from "@/components/MoneyFlowChart";
import ResteTrend from "@/components/ResteTrend";
import { periodSummary } from "@/lib/averages";
import { moneyFlow } from "@/lib/moneyFlow";
import {
  NOTABLE_MIN,
  NOTABLE_RATIO,
  netOfRefunds,
  partialInReport,
  REPORT_AVERAGE,
  reportSummary,
  unclassifiedNote,
} from "@/lib/report";
import { loadReport, type ReportData } from "@/lib/reportData";
import { parseReportRequest, reportRangeTitle, type ReportRequest } from "@/lib/reportRequest";
import { useAccounts } from "@/lib/useAccounts";
import MonthDetail from "./MonthDetail";
import ReportStat from "./ReportStat";
import Sheet from "./Sheet";
import StatementTable from "./StatementTable";
import { HIGHLIGHT } from "./tableStyles";
import TreeRows from "./TreeRows";

/** Months of history in the page 1 Reste chart. */
const TREND_MONTHS = 12;
/** Sankey height that fits a landscape A4 page (186 mm of content, about 700 px) under the sheet
 *  header and its note; a taller chart is scaled down rather than pushed to the next page. */
const FLOW_MAX_HEIGHT = 600;

function Report({
  report,
  month,
  inProgress,
  accounts,
  withFlow,
}: {
  report: ReportData;
  month: string;
  inProgress: boolean;
  accounts: Account[];
  withFlow: boolean;
}) {
  const { data, columns } = report;
  const avg = columns[columns.length - 1];
  // Revenus and Dépenses net of refunds, as in the report's tables (lib/report.ts::netOfRefunds).
  const net = netOfRefunds(data, avg.offset.month_value ?? 0);
  const totals = avg.months > 0 ? netOfRefunds(avg.totals, avg.offset.value) : null;
  const summary = periodSummary(avg, REPORT_AVERAGE);
  const epargneNet = data.epargne - data.desepargne;
  const flow = moneyFlow(data);
  const history = data.history.filter((h) => h.month <= month).slice(-TREND_MONTHS);
  const unclassified = unclassifiedNote(data.uncategorized.count);
  const partial = partialInReport(
    history.map((h) => h.month),
    data.months_partial,
  );
  const today = new Intl.DateTimeFormat("fr-FR").format(new Date());

  return (
    <>
      <section className="sheet">
        <header className="mb-5 border-b border-zinc-200 pb-3">
          <h1 className="text-2xl font-semibold">Comptes du foyer</h1>
          <div className="mt-1 flex items-baseline justify-between text-sm text-zinc-500">
            <span className="text-base text-zinc-700">
              {frenchMonth(month)}
              {inProgress && <span className="ml-2 text-sm text-amber-700">(mois en cours, pas encore clos)</span>}
            </span>
            <span>Établi le {today}</span>
          </div>
        </header>

        <p className="text-base leading-relaxed text-zinc-700">
          {reportSummary(month, net, totals?.reste ?? null)}
        </p>

        <div className="mt-5 grid grid-cols-4 gap-3">
          <ReportStat
            label="Revenus"
            value={net.income}
            average={totals?.income ?? null}
            goodIsUp
            valueClass="text-green-700"
          />
          <ReportStat
            label="Dépenses"
            value={net.expenses}
            average={totals?.expenses ?? null}
            goodIsUp={false}
            valueClass="text-red-700"
          />
          <ReportStat
            label="Épargne"
            value={epargneNet}
            average={totals ? totals.epargne - totals.desepargne : null}
            goodIsUp
            valueClass={epargneNet >= 0 ? "text-violet-700" : "text-amber-700"}
          />
          <ReportStat
            label="Reste"
            value={data.reste}
            average={totals?.reste ?? null}
            goodIsUp
            valueClass={data.reste >= 0 ? "text-green-700" : "text-red-700"}
          />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          {summary
            ? `Moyennes ${summary}, mois clos uniquement.`
            : "Pas encore de mois clos : les moyennes viendront avec le prochain mois."}
        </p>
        {unclassified && <p className="mt-1 text-xs text-amber-700">{unclassified}</p>}

        <div className="mt-5">
          <ResteTrend
            history={history}
            current={month}
            latest={data.history.at(-1)?.month}
            partial={data.months_partial}
          />
        </div>

        <div className="mt-5 rounded-lg bg-zinc-50 p-4 text-sm text-zinc-700">
          <h3 className="mb-2 font-medium">Comment lire ce rapport</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Un mois va d’une paie à la suivante : il commence le jour où le salaire arrive, pas le 1er du
              mois.
            </li>
            <li>
              <strong>Revenus</strong> − <strong>Dépenses</strong> − <strong>Épargne</strong> ={" "}
              <strong>Reste</strong> : ce qui reste sur les comptes courants une fois l’épargne mise de côté
              (négatif : il a fallu puiser dans les réserves ou le découvert).
            </li>
            <li>L’épargne est nette : ce qui a été versé sur les livrets moins ce qui en a été retiré.</li>
            <li>
              Les remboursements (Sécurité sociale, achat rendu…) sont déduits de la catégorie de la dépense
              au lieu de compter comme un revenu : les revenus et les dépenses du rapport sont donc nets, et
              peuvent être un peu plus bas que ceux de l’application. Le reste, lui, est le même.
            </li>
            <li>
              Chaque catégorie est rangée côté revenus ou côté dépenses selon ce qu’elle rapporte ou coûte en
              moyenne. « Non classé » regroupe les opérations pas encore rangées dans une catégorie.
            </li>
            <li>
              Les virements entre nos propres comptes ne sont ni des revenus ni des dépenses : ils sont exclus
              {data.transfers.count > 0 &&
                ` (${data.transfers.count} ce mois-ci, ${formatEuro(data.transfers.total)})`}
              .
            </li>
            <li>
              La moyenne porte sur les {TREND_MONTHS} derniers mois clos ; l’écart compare le mois à cette
              moyenne (en vert quand c’est favorable, en rouge sinon).
            </li>
            {partial.length > 0 && (
              <li>
                {partial.length === 1
                  ? `${frenchMonth(partial[0])} est un mois partiel`
                  : `${partial.map(frenchMonth).join(", ")} sont des mois partiels`}{" "}
                : un compte courant n&apos;y avait pas encore commencé, donc les totaux sont incomplets. Ils ne
                comptent pas dans les moyennes.
              </li>
            )}
            <li>
              Dans les tableaux, un montant en gras signale un mois inhabituel : en{" "}
              <span className={HIGHLIGHT.bad}>rouge</span> un objectif dépassé ou un écart défavorable d’au
              moins {NOTABLE_MIN} € et {NOTABLE_RATIO * 100} % de la moyenne, en{" "}
              <span className={HIGHLIGHT.good}>vert</span> un écart aussi net mais favorable.
            </li>
          </ul>
        </div>
      </section>

      <Sheet title="Les derniers mois" month={month}>
        <StatementTable data={data} columns={columns} />
      </Sheet>

      <Sheet title="Le mois en détail" month={month}>
        <MonthDetail data={data} avg={avg} />
      </Sheet>

      <Sheet title="Détail par catégorie" month={month}>
        <p className="mb-2 text-xs text-zinc-500">
          Le solde de chaque catégorie ce mois-ci (entrées − sorties) et ses opérations, comme dans
          l’application ; le total retombe sur le reste.
        </p>
        <table className="w-full text-xs">
          <tbody>
            <TreeRows
              node={data.by_category}
              depth={0}
              operations={report.operations}
              accounts={accounts}
            />
          </tbody>
        </table>
      </Sheet>

      {withFlow && flow.links.length > 0 && (
        <Sheet title="Flux d’argent du mois" month={month} landscape>
          <p className="mb-2 text-xs text-zinc-500">
            De gauche à droite : d’où vient l’argent, puis où il va. L’épaisseur de chaque bande est
            proportionnelle au montant.
          </p>
          <MoneyFlowChart flow={flow} maxHeight={FLOW_MAX_HEIGHT} />
        </Sheet>
      )}
    </>
  );
}

export default function ReportPage() {
  const accounts = useAccounts();
  const [available, setAvailable] = useState<string[] | null>(null);
  const [request, setRequest] = useState<ReportRequest | null>(null);
  // One report per requested month, in the request's order (oldest first).
  const [reports, setReports] = useState<ReportData[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The months and options come from the Export page's link; read once, client-side.
    api
      .dashboard()
      .then((d) => {
        setAvailable(d.months_available);
        setRequest(parseReportRequest(window.location.search, d.months_available));
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    if (!request || !available) return;
    let stale = false;
    Promise.all(request.months.map((m) => loadReport(available, m, request.operations)))
      .then((loaded) => {
        if (stale) return;
        setReports(loaded);
        setError(null);
      })
      .catch((e) => {
        if (!stale) setError(errorMessage(e));
      });
    return () => {
      stale = true;
    };
  }, [request, available]);

  // The browser names the saved PDF after the page title.
  useEffect(() => {
    if (!request) return;
    const previous = document.title;
    document.title = reportRangeTitle(request.months);
    return () => {
      document.title = previous;
    };
  }, [request]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/export" className="text-sm text-zinc-600 hover:text-zinc-900">
            ← Export
          </Link>
          <h1 className="text-xl font-semibold">Rapport PDF</h1>
          {request && (
            <span className="text-sm text-zinc-500">
              {request.months.map(frenchMonth).join(", ")}
            </span>
          )}
        </div>
        <button type="button" onClick={() => window.print()} disabled={!reports} className="btn-primary">
          Enregistrer en PDF
        </button>
      </div>
      <p className="text-xs text-zinc-500 print:hidden">
        Dans la fenêtre d&apos;impression, choisissez « Enregistrer au format PDF » comme imprimante. Les mois et
        le contenu se choisissent sur la page Export.
      </p>

      {error && <p className="text-red-700">{error}</p>}
      {available?.length === 0 ? (
        <p className="text-zinc-500">Aucune transaction pour l&apos;instant : rien à mettre dans un rapport.</p>
      ) : reports && request ? (
        // Centred on screen, so the landscape page may overflow the content column on both sides.
        <div className="flex flex-col items-center gap-6 print:block">
          {reports.map((report, i) => (
            <Report
              key={request.months[i]}
              report={report}
              month={request.months[i]}
              inProgress={request.months[i] === available?.[0]}
              accounts={accounts}
              withFlow={request.flow}
            />
          ))}
        </div>
      ) : (
        !error && <p className="text-zinc-500">Chargement…</p>
      )}
    </div>
  );
}
