/** The keyboard help under the title: [keys, action]; empty keys = plain typing. */
const SHORTCUTS: [string, string][] = [
  ["↑ ↓", "changer de groupe"],
  ["", "tapez pour chercher une catégorie"],
  ["Entrée", "valider (la suggestion si la recherche est vide)"],
  ["Alt+M", "règle / opérations"],
  ["→ ←", "détails"],
  ["Échap", "effacer"],
  ["Alt+Z", "annuler le dernier classement"],
];

export default function Shortcuts() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
      {SHORTCUTS.map(([keys, action]) => (
        <li key={action}>
          {keys && <kbd className="mr-1 rounded border border-zinc-300 bg-white px-1 font-sans text-zinc-700">{keys}</kbd>}
          {action}
        </li>
      ))}
    </ul>
  );
}
