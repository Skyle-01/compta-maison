"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  type CategoryAverages,
  type CategoryNode,
  type Dashboard,
  errorMessage,
  formatEuro,
  frenchMonth,
  leafFilters,
  type Transaction,
} from "@/lib/api";
import MoneyFlowChart from "@/components/MoneyFlowChart";
import ResteTrend from "@/components/ResteTrend";
import { periodSummary } from "@/lib/averages";
import { moneyFlow } from "@/lib/moneyFlow";
import {
  NOTABLE_MIN,
  NOTABLE_RATIO,
  netOfRefunds,
  REPORT_AVERAGE,
  reportMonth,
  reportSummary,
  reportTitle,
  statementMonths,
  treeLeaves,
} from "@/lib/report";
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

interface ReportData {
  data: Dashboard;
  /** The averages payload of each statement month, oldest first; the last one is the report month. */
  columns: CategoryAverages[];
  /** The operations of each leaf of `data.by_category` (see treeLeaves). */
  operations: Map<CategoryNode, Transaction[]>;
}

function Report({ report, month, inProgress }: { report: ReportData; month: string; inProgress: boolean }) {
  const { data, columns } = report;
  const avg = columns[columns.length - 1];
  // Revenus and Dépenses net of refunds, as in the report's tables (lib/report.ts::netOfRefunds).
  const net = netOfRefunds(data, avg.offset.month_value ?? 0);
  const totals = avg.months > 0 ? netOfRefunds(avg.totals, avg.offset.value) : null;
  const summary = periodSummary(avg, REPORT_AVERAGE);
  const epargneNet = data.epargne - data.desepargne;
  const flow = moneyFlow(data);
  const history = data.history.filter((h) => h.month <= month).slice(-TREND_MONTHS);
  const today = new Intl.DateTimeFormat("fr-FR").format(new Date());

  return (
    // Centred on screen, so the landscape page may overflow the content column on both sides.
    <div className="flex flex-col items-center gap-6 print:block">
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

        <div className="mt-5">
          <ResteTrend
            history={history}
            current={month}
            latest={data.history.at(-1)?.month}
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
            <TreeRows node={data.by_category} depth={0} operations={report.operations} />
          </tbody>
        </table>
      </Sheet>

      {flow.links.length > 0 && (
        <Sheet title="Flux d’argent du mois" month={month} landscape>
          <p className="mb-2 text-xs text-zinc-500">
            De gauche à droite : d’où vient l’argent, puis où il va. L’épaisseur de chaque bande est
            proportionnelle au montant.
          </p>
          <MoneyFlowChart flow={flow} maxHeight={FLOW_MAX_HEIGHT} />
        </Sheet>
      )}
    </div>
  );
}

export default function ReportPage() {
  const [available, setAvailable] = useState<string[] | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // ?month=YYYY-MM from the dashboard's « Rapport PDF » link; read once, client-side.
    const requested = new URLSearchParams(window.location.search).get("month");
    api
      .dashboard()
      .then((d) => {
        setAvailable(d.months_available);
        setMonth(reportMonth(d.months_available, requested));
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    if (!month || !available) return;
    let stale = false; // a slower answer for a previous month must not overwrite this one
    const load = async (): Promise<ReportData> => {
      const [data, columns] = await Promise.all([
        api.dashboard(month),
        Promise.all(statementMonths(available, month).map((m) => api.averages(REPORT_AVERAGE, m))),
      ]);
      // One request per leaf, as the dashboard's drill-down does (1000: the API's page maximum).
      const leaves = treeLeaves(data.by_category);
      const pages = await Promise.all(
        leaves.map((n) => api.listTransactions({ ...leafFilters(n, month), limit: 1000 })),
      );
      return { data, columns, operations: new Map(leaves.map((n, i) => [n, pages[i].items])) };
    };
    load()
      .then((loaded) => {
        if (stale) return;
        setReport(loaded);
        setError(null);
      })
      .catch((e) => {
        if (!stale) setError(errorMessage(e));
      });
    return () => {
      stale = true;
    };
  }, [month, available]);

  // The browser names the saved PDF after the page title.
  useEffect(() => {
    if (!month) return;
    const previous = document.title;
    document.title = reportTitle(month);
    return () => {
      document.title = previous;
    };
  }, [month]);

  const choose = (m: string) => {
    setMonth(m);
    setReport(null);
    window.history.replaceState(null, "", `?month=${m}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Link
            href={month && month !== available?.[0] ? `/?month=${month}` : "/"}
            className="text-sm text-zinc-600 hover:text-zinc-900"
          >
            ← Tableau de bord
          </Link>
          <h1 className="text-xl font-semibold">Rapport</h1>
        </div>
        <div className="flex items-center gap-3">
          {available && month && (
            <select
              className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
              value={month}
              onChange={(e) => choose(e.target.value)}
              aria-label="Mois du rapport"
            >
              {available.map((m, i) => (
                <option key={m} value={m}>
                  {frenchMonth(m)}
                  {i === 0 ? " (en cours)" : ""}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!report}
            className="btn-primary"
          >
            Enregistrer en PDF
          </button>
        </div>
      </div>
      <p className="text-xs text-zinc-500 print:hidden">
        Dans la fenêtre d’impression, choisissez « Enregistrer au format PDF » comme imprimante.
      </p>

      {error && <p className="text-red-700">{error}</p>}
      {available?.length === 0 ? (
        <p className="text-zinc-500">Aucune transaction pour l’instant : rien à mettre dans un rapport.</p>
      ) : report && month ? (
        <Report report={report} month={month} inProgress={month === available?.[0]} />
      ) : (
        !error && <p className="text-zinc-500">Chargement…</p>
      )}
    </div>
  );
}
