import type { Dashboard } from "@/lib/api";

/** What « Le mois », Budget and Statistiques show instead of their body: the error, the loading
 *  line, or (a loaded payload without a month) the empty-database message. Render it when
 *  `error || !data?.month`, so the body only runs with a loaded month. */
export default function MonthNotice({ data, error }: { data: Dashboard | null; error: string | null }) {
  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p className="text-zinc-500">Chargement…</p>;
  return (
    <p className="text-zinc-500">
      Aucune transaction pour l&apos;instant : commencez par importer un relevé bancaire depuis la page
      Importer.
    </p>
  );
}
