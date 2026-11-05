/** The navigation, in display order: pages to look at, to work on, to configure. */
export const NAV_GROUPS = [
  {
    label: "Analyser",
    items: [
      { href: "/", label: "Le mois" },
      { href: "/budget", label: "Budget" },
      { href: "/statistiques", label: "Statistiques" },
    ],
  },
  {
    label: "Traiter",
    items: [
      { href: "/transactions", label: "Transactions" },
      { href: "/a-classer", label: "À classer" },
      { href: "/categories", label: "Catégories" },
      { href: "/import", label: "Importer" },
    ],
  },
  {
    label: "Configurer",
    items: [
      { href: "/settings", label: "Réglages" },
      { href: "/aide", label: "Aide" },
    ],
  },
] as const;

/** Every page, flat (shared with the guide's coverage test). */
export const NAV: { href: string; label: string }[] = NAV_GROUPS.flatMap((g) => [...g.items]);
