import { formatEuro, frenchDate, type Recurrence, type RecurrenceStatus } from "./api";

/** Pure helpers of the « Récurrents » page: the filters, the summary and the badge texts. The API
 *  already sorts the flows (expenses then income, largest first) and filtering keeps that order. */

/** "" = every flow, "gap" = a flow with an amber flag, else one kind of flag. */
export type StatusFilter = "" | "gap" | RecurrenceStatus["kind"];

export type RecurrenceFilters = {
  status: StatusFilter;
  /** Show the variable amounts (bills, shops visited about monthly) too. */
  withVariable: boolean;
};

export const emptyFilters = (): RecurrenceFilters => ({ status: "", withVariable: false });

export const STATUS_LABELS: Record<RecurrenceStatus["kind"], string> = {
  missing: "Manquant",
  ended: "Terminé",
  price_change: "Changement de prix",
  doubled: "Doublé",
};

/** A flag that asks for a look: every one but `ended`, which only records what is over. */
const isGap = (status: RecurrenceStatus) => status.kind !== "ended";

const hasKind = (item: Recurrence, kind: RecurrenceStatus["kind"]) => item.status.some((s) => s.kind === kind);

export function filterRecurrences(items: Recurrence[], filters: RecurrenceFilters): Recurrence[] {
  return items.filter((item) => {
    if (item.amount_kind === "variable" && !filters.withVariable) return false;
    if (filters.status === "") return true;
    if (filters.status === "gap") return item.status.some(isGap);
    return hasKind(item, filters.status);
  });
}

/** The flows the monthly totals count: fixed and not ended. */
export const counted = (items: Recurrence[]): Recurrence[] =>
  items.filter((item) => item.amount_kind === "fixed" && item.next_expected !== null);

/** The fixed flows with a flag to look at (what the default list shows with a gap): the « Le mois » line. */
export const gapCount = (items: Recurrence[]): number =>
  items.filter((item) => item.amount_kind === "fixed" && item.status.some(isGap)).length;

/** « 12 flux récurrents : 1 200,00 € de dépenses et 2 650,00 € de revenus par mois ». */
export function summaryText(items: Recurrence[], expenses: number, income: number): string {
  const n = counted(items).length;
  return `${n} flux récurrent${n > 1 ? "s" : ""} : ${formatEuro(expenses)} de dépenses et ${formatEuro(income)} de revenus par mois`;
}

/** The badge text: the flag's name, or the two amounts of a price change. */
export function badgeText(status: RecurrenceStatus): string {
  if (status.kind === "price_change" && status.old_amount != null && status.new_amount != null) {
    return `${formatEuro(status.old_amount)} → ${formatEuro(status.new_amount)}`;
  }
  return STATUS_LABELS[status.kind];
}

export function badgeTooltip(status: RecurrenceStatus): string {
  switch (status.kind) {
    case "missing":
      return "Le prélèvement ou le virement habituel n'est pas arrivé à la date attendue (l'état du compte est à jour, ou le montant n'a pas été reçu).";
    case "ended":
      return "Plus d'opération depuis deux mois ou plus : abonnement résilié, ou la banque a changé le libellé (il apparaît alors comme un nouveau flux).";
    case "price_change":
      return `Le montant a changé${status.since ? ` le ${frenchDate(status.since)}` : ""}. Un seul paiement au nouveau prix reste à confirmer par le suivant.`;
    case "doubled":
      return "Deux opérations ce mois-ci pour un flux habituellement payé une fois.";
  }
}

/** Amber for a flag that asks for a look, grey for an ended flow. */
export const badgeTone = (status: RecurrenceStatus): string =>
  isGap(status) ? "bg-amber-50 text-amber-800" : "bg-zinc-100 text-zinc-600";
