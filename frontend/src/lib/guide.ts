/** Anchor (the github-slugger slug of a heading in docs/guide.md) of each page's section.
 *  guide.test.ts fails when a page has none or when a heading disappears. */
export const GUIDE_ANCHORS = {
  "/": "le-mois",
  "/budget": "budget",
  "/statistiques": "statistiques",
  "/transactions": "transactions",
  "/a-classer": "à-classer",
  "/categories": "catégories",
  "/regles": "règles",
  "/import": "importer-des-relevés",
  "/export": "export",
  "/settings": "réglages",
  "/aide": "bien-démarrer",
} as const;

/** Link target of a page's « ? » help link. */
export function guideHref(page: keyof typeof GUIDE_ANCHORS): string {
  return `/aide#${encodeURIComponent(GUIDE_ANCHORS[page])}`;
}
