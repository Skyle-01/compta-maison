"use client";

import { Fragment, type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  type CategoryAverages,
  type Dashboard,
  errorMessage,
  formatEuro,
  frenchMonth,
} from "@/lib/api";
import BudgetSection from "@/components/BudgetSection";
import Gap from "@/components/Gap";
import MoneyFlowChart from "@/components/MoneyFlowChart";
import ResteTrend from "@/components/ResteTrend";
import { periodSummary } from "@/lib/averages";
import { moneyFlow } from "@/lib/moneyFlow";
import {
  attentionPoints,
  type BreakdownLine,
  buildStatement,
  expenseBreakdown,
  REPORT_AVERAGE,
  reportMonth,
  reportSummary,
  reportTitle,
  type StatementRow,
  statementMonths,
} from "@/lib/report";
import { monthTick } from "@/lib/trend";

/** Months of history in the page 1 Reste chart. */
const TREND_MONTHS = 12;
/** Sankey height that fits a landscape A4 page (186 mm of content, about 700 px) under the sheet
 *  header and its note; a taller chart is scaled down rather than pushed to the next page. */
const FLOW_MAX_HEIGHT = 600;

interface ReportData {
  data: Dashboard;
  /** The averages payload of each statement month, oldest first; the last one is the report month. */
  columns: CategoryAverages[];
}

/** One A4 page of the report (see .sheet in globals.css): previewed on screen at its print width. */
function Sheet({
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

/** A card of the month with its average and the gap between them. */
function ReportStat({
  label,
  value,
  average,
  goodIsUp,
  valueClass,
}: {
  label: string;
  value: number;
  average: number | null;
  goodIsUp: boolean;
  valueClass: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valueClass}`}>{formatEuro(value)}</div>
      {average !== null && (
        <div className="mt-1 text-xs text-zinc-500">
          moyenne {formatEuro(average)} · <Gap month={value} average={average} goodIsUp={goodIsUp} />
        </div>
      )}
    </div>
  );
}

const NUM = "px-1.5 py-1 text-right tabular-nums whitespace-nowrap";
const cell = (value: number | null) => (value === null ? "" : Math.abs(value) < 0.005 ? "–" : formatEuro(value));

/** A statement line: the label, one amount per month (the report month highlighted), the average. */
function StatementLine({
  row,
  current,
  className = "border-b border-zinc-100",
  labelClass = "pl-3",
  amountClass,
}: {
  row: StatementRow;
  current: number;
  className?: string;
  labelClass?: string;
  amountClass?: (value: number) => string;
}) {
  return (
    <tr className={className}>
      <td className={`py-1 pr-2 ${row.muted ? "text-zinc-500" : ""} ${labelClass}`}>{row.label}</td>
      {row.values.map((v, i) => (
        <td key={i} className={`${NUM} ${i === current ? "bg-zinc-50" : ""} ${amountClass?.(v) ?? ""}`}>
          {cell(v)}
        </td>
      ))}
      <td className={`${NUM} border-l border-zinc-200 font-medium ${amountClass?.(row.average ?? 0) ?? ""}`}>
        {cell(row.average)}
      </td>
    </tr>
  );
}

/** Page 2: the last months side by side, a household income statement. */
function StatementTable({ columns, data }: ReportData) {
  const statement = buildStatement(columns, data.history);
  const current = statement.months.length - 1;
  const average = columns[current];
  const span = statement.months.length + 2;
  const sectionColor: Record<string, string> = {
    Revenus: "text-green-700",
    Dépenses: "text-red-700",
    Épargne: "text-violet-700",
  };
  return (
    <>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-300 text-zinc-500">
            <th className="py-1 text-left font-normal" />
            {statement.months.map((m, i) => (
              <th key={m} className={`${NUM} font-normal ${i === current ? "bg-zinc-50" : ""}`}>
                {monthTick(m)}
                <div className="text-[10px]">{m.slice(0, 4)}</div>
              </th>
            ))}
            <th className={`${NUM} border-l border-zinc-200 font-normal`}>
              Moyenne
              <div className="text-[10px]">{average.months > 0 ? `${average.months} mois` : "aucun mois clos"}</div>
            </th>
          </tr>
        </thead>
        <tbody>
          {statement.sections.map((section) => (
            <Fragment key={section.title}>
              <tr>
                <td colSpan={span} className={`pb-1 pt-3 text-sm font-semibold ${sectionColor[section.title] ?? ""}`}>
                  {section.title}
                </td>
              </tr>
              {section.rows.map((row) => (
                <StatementLine key={row.key} row={row} current={current} />
              ))}
              <StatementLine
                row={section.total}
                current={current}
                className="border-b border-zinc-300 font-semibold"
                labelClass=""
              />
            </Fragment>
          ))}
          <tr>
            <td colSpan={span} className="pt-3" />
          </tr>
          <StatementLine
            row={statement.reste}
            current={current}
            className="border-y-2 border-zinc-300 text-sm font-semibold"
            labelClass=""
            amountClass={(v) => (v >= 0 ? "text-green-700" : "text-red-700")}
          />
        </tbody>
      </table>
      <p className="mt-3 text-xs text-zinc-500">
        Chaque colonne retombe sur les chiffres du mois : total des revenus − total des dépenses − épargne
        nette = reste. Les revenus sont détaillés par source, les dépenses par grande catégorie. Une
        catégorie compte en dépenses ou en revenus selon son solde sur la période moyennée ; ce qu’elle reçoit
        ou paie à contre-sens (un remboursement de courses) figure en « Remboursements et compensations », des
        deux côtés. L’épargne nette d’un compte = ce qui y a été mis de côté − ce qui en a été retiré.
      </p>
    </>
  );
}


/** A spending bar, scaled to the largest category of the month. */
function Bar({ value, max, strong }: { value: number; max: number; strong?: boolean }) {
  const width = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-zinc-100">
      <div className={`h-2 rounded-full ${strong ? "bg-red-500" : "bg-red-300"}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function BreakdownRow({ line, max, group }: { line: BreakdownLine; max: number; group?: boolean }) {
  return (
    <tr className={group ? "border-t border-zinc-200" : ""}>
      <td className={`py-1 pr-2 ${group ? "font-medium" : "pl-4 text-zinc-700"}`}>{line.name}</td>
      <td className={`${NUM} ${group ? "font-medium" : ""}`}>{cell(line.month)}</td>
      <td className="w-1/4 px-2">
        <Bar value={line.month} max={max} strong={group} />
      </td>
      <td className={`${NUM} text-zinc-500`}>{cell(line.average)}</td>
      <td className={NUM}>{line.average !== null && <Gap month={line.month} average={line.average} goodIsUp={false} />}</td>
      <td className={`${NUM} text-zinc-500`}>{line.target === null ? "" : formatEuro(line.target)}</td>
    </tr>
  );
}

/** Page 3: where the month's money went, its budget, and what stands out. */
function MonthDetail({ data, avg }: { data: Dashboard; avg: CategoryAverages }) {
  const breakdown = expenseBreakdown(avg);
  const max = Math.max(0, ...breakdown.map((g) => g.month));
  const points = attentionPoints(breakdown, data.budget, data.uncategorized);
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 font-medium">Dépenses par catégorie</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-300 text-zinc-500">
              <th className="py-1 text-left font-normal">Catégorie</th>
              <th className={`${NUM} font-normal`}>Ce mois</th>
              <th />
              <th className={`${NUM} font-normal`}>Moyenne</th>
              <th className={`${NUM} font-normal`}>Écart</th>
              <th className={`${NUM} font-normal`}>Objectif</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map((g) => (
              <Fragment key={g.id}>
                <BreakdownRow line={g} max={max} group />
                {g.leaves.map((l) => (
                  <BreakdownRow key={l.id} line={l} max={max} />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        {breakdown.length === 0 && <p className="text-sm text-zinc-500">Aucune dépense classée ce mois-ci.</p>}
      </section>

      <div className="break-inside-avoid">
        <BudgetSection budget={data.budget} all={false} />
      </div>

      <section className="break-inside-avoid">
        <h3 className="mb-2 font-medium">Points d’attention</h3>
        {points.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700">
            {points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">Rien à signaler ce mois-ci.</p>
        )}
      </section>
    </div>
  );
}

function Report({ report, month, inProgress }: { report: ReportData; month: string; inProgress: boolean }) {
  const { data, columns } = report;
  const avg = columns[columns.length - 1];
  const totals = avg.months > 0 ? avg.totals : null;
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
          {reportSummary(month, data, totals?.reste ?? null)}
        </p>

        <div className="mt-5 grid grid-cols-4 gap-3">
          <ReportStat
            label="Revenus"
            value={data.income}
            average={totals?.income ?? null}
            goodIsUp
            valueClass="text-green-700"
          />
          <ReportStat
            label="Dépenses"
            value={data.expenses}
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
          <ResteTrend history={history} current={month} />
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
              Les virements entre nos propres comptes ne sont ni des revenus ni des dépenses : ils sont exclus
              {data.transfers.count > 0 &&
                ` (${data.transfers.count} ce mois-ci, ${formatEuro(data.transfers.total)})`}
              .
            </li>
            <li>
              La moyenne porte sur les {TREND_MONTHS} derniers mois clos ; l’écart compare le mois à cette
              moyenne (en vert quand c’est favorable, en rouge sinon).
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
    Promise.all([
      api.dashboard(month),
      Promise.all(statementMonths(available, month).map((m) => api.averages(REPORT_AVERAGE, m))),
    ])
      .then(([data, columns]) => {
        if (stale) return;
        setReport({ data, columns });
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
          <Link href="/" className="text-sm text-zinc-600 hover:text-zinc-900">
            ← Tableau de bord
          </Link>
          <h1 className="text-xl font-semibold">Rapport</h1>
        </div>
        <div className="flex items-center gap-3">
          {available && month && (
            <select
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
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
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
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
