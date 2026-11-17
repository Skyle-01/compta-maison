/** The report as one self-contained HTML page for a phone: no framework, no network, inline CSS and
 *  SVG, a few lines of script to switch month (without it every month is listed). Built as a string
 *  from the same data and helpers as the printable PDF, so both show the same figures. Every
 *  dynamic text goes through `esc`. */
import {
  type BudgetSummary,
  type CategoryAverages,
  type CategoryNode,
  type MonthTotals,
  type Transaction,
  formatEuro,
  frenchMonth,
  signedAmount,
  treeLabel,
} from "./api";
import { averageGap, gapText, gapTone } from "./averages";
import { barWidth, budgetLeft, budgetRatio, budgetTone, hasTargets } from "./budget";
import { MOBILE_CSS } from "./mobileReportStyle";
import {
  type AverageGroup,
  type AverageLine,
  type BreakdownGroup,
  type BreakdownLine,
  type BreakdownSide,
  type MonthCard,
  type ReportCard,
  REPORT_AVERAGE,
  REPORT_AVERAGE_TEXT,
  REPORT_NAME,
  averageMonth,
  averageNote,
  breakdown,
  cell,
  dayMonth,
  monthFigures,
  splitNote,
} from "./report";
import type { ReportData } from "./reportData";
import { reportRangeTitle } from "./reportRequest";
import { monthTick, trendTicks } from "./trend";

export interface MobileReportInput {
  /** One report per month, in `months` order (oldest first). */
  reports: ReportData[];
  months: string[];
  /** Dashboard.months_available, newest first: the first one is still filling. */
  available: string[];
  /** List the operations of each category: off by default, a shared file shows only totals. */
  operations: boolean;
  today: Date;
}

const esc = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const euros0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

const signClass = (value: number): string => (value >= 0 ? "good" : "bad");

/** « 3,2 % » of the largest value as a CSS width, 0 to 100. */
const share = (value: number, max: number): number =>
  max > 0 ? Math.round(Math.max(0, Math.min(1, value / max)) * 1000) / 10 : 0;

/** "comptes-foyer-2026-08.html", or "comptes-foyer-2026-06-2026-08.html" for several months. */
export function reportFileName(months: string[]): string {
  const ends = months.length > 1 ? [months[0], months[months.length - 1]] : months.slice(0, 1);
  return `comptes-foyer-${ends.join("-")}.html`;
}

function gapSpan(month: number, average: number | null, goodIsUp: boolean): string {
  if (average === null) return "";
  const text = gapText(month, average);
  if (text === null) return "";
  const tone = gapTone(averageGap(month, average) ?? 0, goodIsUp);
  return `<span class="${tone === "flat" ? "muted" : tone === "good" ? "good" : "bad"}">${esc(text)}</span>`;
}

/** One line of the equation « Revenus − Dépenses − Épargne = Reste » with its average and gap. */
function equationRow(op: string, card: ReportCard, average: number | null, total = false): string {
  const gap = gapSpan(card.value, average, card.goodIsUp);
  const sub =
    average === null ? "" : `<span class="sub">moyenne ${esc(formatEuro(average))}${gap ? ` · ${gap}` : ""}</span>`;
  return `<div class="row${total ? " total" : ""}"><dt><span class="op">${op}</span>${esc(card.label)}</dt><dd class="${card.tone}">${esc(formatEuro(card.value))}</dd>${sub}</div>`;
}

/** The four cards as « Revenus − Dépenses − Épargne = Reste ». */
const CARD_OPERATORS = ["", "−", "−", "="];
function equationHtml(cards: MonthCard[]): string {
  return cards.map((c, i) => equationRow(CARD_OPERATORS[i], c, c.average, i === cards.length - 1)).join("");
}

function line(side: BreakdownSide, l: BreakdownLine, max: number, bar: boolean): string {
  const cls = l.tone ? ` n-${l.tone}` : "";
  return `<div class="line"><span>${esc(l.name)}</span><span class="amt${cls}">${esc(cell(l.month))}</span>${
    bar ? `<span class="bar ${side}"><i style="width:${share(l.month, max)}%"></i></span>` : ""
  }</div>`;
}

/** A category group: its amount and bar, its leaves (with the average and a target) folded below. */
function breakdownHtml(title: string, groups: BreakdownGroup[], side: BreakdownSide, empty: string): string {
  if (groups.length === 0) return `<h3>${title}</h3><p class="muted">${empty}</p>`;
  const max = Math.max(0, ...groups.map((g) => g.month));
  const rows = groups.map((g) => {
    if (g.leaves.length === 0) return `<div class="cat">${line(side, g, max, true)}</div>`;
    const leaves = g.leaves
      .map((l) => {
        const detail = [
          l.average === null ? null : `moyenne ${formatEuro(l.average)}`,
          l.target === null ? null : `objectif ${formatEuro(l.target)}`,
        ]
          .filter(Boolean)
          .join(" · ");
        return `<li><span class="nm">${esc(l.name)}${
          detail ? `<span class="detail">${esc(detail)}</span>` : ""
        }</span><span class="amt${l.tone ? ` n-${l.tone}` : ""}">${esc(cell(l.month))}</span></li>`;
      })
      .join("");
    return `<details class="cat"><summary>${line(side, g, max, true)}</summary><ul class="leaves">${leaves}</ul></details>`;
  });
  return `<h3>${title}</h3>${rows.join("")}`;
}

function budgetHtml(b: BudgetSummary): string {
  if (!hasTargets(b)) return "";
  const row = (label: string, actual: number, target: number, strong: boolean) => {
    const ratio = budgetRatio(actual, target);
    const tone = budgetTone(ratio);
    const left = budgetLeft(actual, target);
    const cls = tone === "over" ? "over" : tone === "warn" ? "near" : "ok";
    return `<div class="cat"><div class="line flat"><span${strong ? ' style="font-weight:600"' : ""}>${esc(label)}</span><span class="amt">${esc(
      formatEuro(actual),
    )} <span class="muted" style="font-weight:400">/ ${esc(formatEuro(target))}</span></span><span class="bar ${cls}"><i style="width:${barWidth(
      ratio,
    )}%"></i></span><span class="small ${tone === "over" ? "bad" : "muted"}" style="grid-column:1/-1">${
      left < 0 ? `${esc(formatEuro(-left))} de dépassement` : `reste ${esc(formatEuro(left))}`
    }</span></div></div>`;
  };
  const savings =
    b.savings_target === null
      ? ""
      : (() => {
          const short = b.savings_target - b.savings_actual;
          return `<p class="small" style="margin-top:.75rem">Épargne : ${esc(formatEuro(b.savings_actual))} <span class="muted">/ ${esc(
            formatEuro(b.savings_target),
          )} visés</span> <span class="${short > 0.005 ? "bad" : "good"}">${
            short > 0.005 ? `il manque ${esc(formatEuro(short))}` : "objectif atteint"
          }</span></p>`;
        })();
  return `<h3>Objectifs du mois</h3>${row("Total des objectifs", b.actual, b.target, true)}${b.groups
    .map((g) => row(g.name, g.actual, g.target, false))
    .join("")}${savings}<p class="note">Dépenses sans objectif : ${esc(formatEuro(b.untargeted))}</p>`;
}

/** « Reste mois par mois »: one bar per month, the report month in full colour, the month still
 *  filling dashed, labels thinned to fit a phone. */
function trendHtml(history: MonthTotals[], current: string, latest: string | undefined, partial: string[]): string {
  if (history.length < 2) return "";
  const W = 320;
  const H = 128;
  const top = 18;
  const plotH = 84;
  const values = history.map((h) => h.reste);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const y = (v: number) => top + ((max - v) / span) * plotH;
  const band = (W - 8) / history.length;
  const barW = Math.min(28, band * 0.62);
  const ticks = new Set(trendTicks(history, current));
  const bars = history
    .map((h, i) => {
      const x = 4 + i * band + (band - barW) / 2;
      const negative = h.reste < 0;
      const isCurrent = h.month === current;
      const strong = negative ? "#b91c1c" : "#115e59";
      const light = negative ? "#ef4444" : "#0d9488";
      const y0 = y(0);
      const yv = y(h.reste);
      const filling = h.month === latest;
      const label = `${frenchMonth(h.month)} : ${formatEuro(h.reste)}${partial.includes(h.month) ? " (partiel)" : ""}`;
      const value = isCurrent
        ? `<text x="${(x + barW / 2).toFixed(1)}" y="${(negative ? Math.max(y0, yv) + 12 : Math.min(y0, yv) - 4).toFixed(
            1,
          )}" text-anchor="middle" font-size="11" font-weight="600" fill="${negative ? "#b91c1c" : "#115e59"}">${esc(
            euros0.format(h.reste),
          )}</text>`
        : "";
      const tick = ticks.has(h.month)
        ? `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="10" fill="#71717a">${esc(
            monthTick(h.month),
          )}</text>`
        : "";
      return `<g><title>${esc(label)}</title><rect x="${x.toFixed(1)}" y="${Math.min(y0, yv).toFixed(1)}" width="${barW.toFixed(
        1,
      )}" height="${Math.max(1, Math.abs(yv - y0)).toFixed(1)}" rx="2" fill="${isCurrent ? strong : light}"${
        filling ? ` stroke="${strong}" stroke-width="1.5" stroke-dasharray="3 2"` : ""
      }/>${value}${tick}</g>`;
    })
    .join("");
  const summary = history.map((h) => `${frenchMonth(h.month)} ${formatEuro(h.reste)}`).join(", ");
  return `<h3>Reste mois par mois</h3><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(
    `Reste mois par mois : ${summary}`,
  )}"><line x1="0" x2="${W}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="#a1a1aa" stroke-width="1"/>${bars}</svg>${
    latest !== undefined && history.some((h) => h.month === latest)
      ? '<p class="note">Le mois en pointillés n&apos;est pas encore clos.</p>'
      : ""
  }`;
}

/** The balance tree with every leaf's operations: only on request, it carries the labels. */
function treeHtml(node: CategoryNode, depth: number, operations: Map<CategoryNode, Transaction[]>): string {
  if (node.credit === 0 && node.debit === 0) return "";
  const pad = `padding-left:${depth * 0.875}rem`;
  const own = `<div class="trow${depth <= 1 ? " strong" : ""}" style="${pad}"><span>${esc(treeLabel(node.name))}</span><span class="${signClass(
    node.balance,
  )}">${esc(formatEuro(node.balance))}</span></div>`;
  const ops = (operations.get(node) ?? [])
    .map((t) => {
      const split = splitNote(t);
      return `<div class="op" style="padding-left:${(depth + 1) * 0.875}rem"><span><span class="d">${esc(dayMonth(t.date_valeur))}</span>${esc(
        t.libelle,
      )}${t.account_id ? `<span class="acc">${esc(t.account_id)}</span>` : ""}${
        split ? ` <span class="muted">(${esc(split)})</span>` : ""
      }</span><span class="amt ${t.credit > 0 ? "good" : "bad"}">${esc(formatEuro(signedAmount(t)))}</span></div>`;
    })
    .join("");
  return own + ops + node.children.map((c) => treeHtml(c, depth + 1, operations)).join("");
}

function monthArticle(month: string, r: ReportData, input: MobileReportInput): string {
  const { data, averages: avg } = r;
  const { parts, cards, history, unclassified, partialNote, averageNote: averageLine } = monthFigures(
    data,
    avg,
    month,
  );
  const inProgress = month === input.available[0];

  const operations = input.operations
    ? `<details class="more"><summary>Opérations par catégorie</summary><div class="tree">${treeHtml(
        data.by_category,
        0,
        r.operations,
      )}</div></details>`
    : "";

  return `<article id="${esc(month)}" data-month="${esc(month)}">
<h2>${esc(frenchMonth(month))}${inProgress ? ' <span class="tag">mois en cours, pas encore clos</span>' : ""}</h2>
<p class="verdict ${signClass(data.reste)}">${esc(parts.verdict)}</p>
${parts.average ? `<p class="avg muted">${esc(parts.average)}</p>` : ""}
<p class="story">${esc(parts.story)}</p>
<dl class="eq">${equationHtml(cards)}</dl>
<p class="note">${esc(averageLine)}</p>
${unclassified ? `<p class="alert">${esc(unclassified)}</p>` : ""}
${breakdownHtml("Où part l'argent", breakdown(avg, "expenses"), "expenses", "Aucune dépense classée ce mois-ci.")}
${breakdownHtml("D'où vient l'argent", breakdown(avg, "income"), "income", "Aucun revenu classé ce mois-ci.")}
${budgetHtml(data.budget)}
${trendHtml(history, month, data.history.at(-1)?.month, data.months_partial)}
${partialNote ? `<p class="note">${esc(partialNote)}</p>` : ""}
${operations}
</article>`;
}

/** One list of the average month: a bar per category (its sources folded below), the target beside
 *  a category that has its own, a muted « Non classé » line when there is some. */
function averageListHtml(title: string, groups: AverageGroup[], side: BreakdownSide, unclassified: number | null): string {
  if (groups.length === 0 && unclassified === null) return "";
  const max = Math.max(0, ...groups.map((g) => g.value));
  const target = (l: AverageLine) =>
    l.target === null ? "" : `<span class="detail">objectif ${esc(formatEuro(l.target))}</span>`;
  const head = (g: AverageGroup) =>
    `<div class="line"><span>${esc(g.name)}${target(g)}</span><span class="amt">${esc(cell(g.value))}</span><span class="bar ${side}"><i style="width:${share(
      g.value,
      max,
    )}%"></i></span></div>`;
  const rows = groups.map((g) =>
    g.leaves.length === 0
      ? `<div class="cat">${head(g)}</div>`
      : `<details class="cat"><summary>${head(g)}</summary><ul class="leaves">${g.leaves
          .map(
            (l) =>
              `<li><span class="nm">${esc(l.name)}${target(l)}</span><span class="amt">${esc(cell(l.value))}</span></li>`,
          )
          .join("")}</ul></details>`,
  );
  const muted =
    unclassified === null
      ? ""
      : `<div class="cat"><div class="line flat"><span class="muted">Non classé</span><span class="amt muted">${esc(cell(unclassified))}</span></div></div>`;
  return `<h3>${title}</h3>${rows.join("")}${muted}`;
}

/** « Un mois moyen »: the average of the complete months, once for the whole export (so outside the
 *  month articles); empty while no budget month is complete. */
function averageMonthHtml(avg: CategoryAverages): string {
  const m = averageMonth(avg, REPORT_AVERAGE);
  if (!m) return "";
  const savings =
    m.savings.length === 0
      ? ""
      : `<h3>Épargne</h3>${m.savings
          .map(
            (s) =>
              `<div class="cat"><div class="line flat"><span>${esc(s.name)}</span><span class="amt">${esc(cell(s.value))}</span></div></div>`,
          )
          .join("")}`;
  return `<section class="avgmonth">
<h2>Un mois moyen</h2>
<p class="note">${esc(averageNote(m.period))}</p>
<dl class="eq">${equationHtml(m.cards.map((c) => ({ ...c, average: null })))}</dl>
${averageListHtml("Où part l'argent en moyenne", m.spending, "expenses", m.spendingUnclassified)}
${averageListHtml("D'où vient l'argent en moyenne", m.income, "income", m.incomeUnclassified)}
${savings}
</section>`;
}

const HELP = [
  "Un mois va d'une paie à la suivante : il commence le jour où le salaire arrive, pas le 1er du mois.",
  "Revenus − Dépenses − Épargne = Reste : ce qui reste sur les comptes courants une fois l'épargne mise de côté. Négatif, il a fallu puiser dans les réserves ou le découvert.",
  "Les remboursements (Sécurité sociale, achat rendu...) sont déduits de la dépense au lieu de compter comme un revenu.",
  "Les virements entre nos propres comptes ne sont ni des revenus ni des dépenses.",
  `La moyenne porte sur ${REPORT_AVERAGE_TEXT}. En gras rouge : un montant bien au-dessus de la normale pour une dépense, ou de l'objectif. En gras vert : un écart aussi net mais favorable.`,
];

/** The whole page. Months are listed oldest first (the newest one opens first when the script runs). */
export function buildMobileReport(input: MobileReportInput): string {
  const { reports, months } = input;
  const title = reportRangeTitle(months);
  const today = new Intl.DateTimeFormat("fr-FR").format(input.today);
  const newestFirst = [...months].reverse();
  const picker =
    months.length > 1
      ? `<nav class="picker"><label class="small muted" for="month">Mois</label><select id="month">${newestFirst
          .map((m) => `<option value="${esc(m)}">${esc(frenchMonth(m))}</option>`)
          .join("")}</select></nav><ul class="index">${newestFirst
          .map((m) => `<li><a href="#${esc(m)}">${esc(frenchMonth(m))}</a></li>`)
          .join("")}</ul>`
      : "";
  const script =
    months.length > 1
      ? `<script>(function(){var s=document.getElementById("month"),a=[].slice.call(document.querySelectorAll("article[data-month]"));document.documentElement.className="js";function show(m){a.forEach(function(x){x.hidden=x.getAttribute("data-month")!==m});s.value=m;try{history.replaceState(null,"","#"+m)}catch(e){}}s.addEventListener("change",function(){show(s.value);window.scrollTo(0,0)});var h=location.hash.slice(1);show(a.some(function(x){return x.getAttribute("data-month")===h})?h:a[a.length-1].getAttribute("data-month"))})();</script>`
      : "";
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>${MOBILE_CSS}</style>
</head>
<body>
<main>
<header class="top"><h1>${esc(REPORT_NAME)}</h1><span class="small muted">Établi le ${esc(today)}</span></header>
${picker}
${months.map((m, i) => monthArticle(m, reports[i], input)).join("\n")}
${reports.length > 0 ? averageMonthHtml(reports[reports.length - 1].averages) : ""}
<details class="more help"><summary>Comment lire ce rapport</summary><ul>${HELP.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></details>
</main>
${script}
</body>
</html>
`;
}
