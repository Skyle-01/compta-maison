/** Anchor (the github-slugger slug of a heading in docs/guide.md) of each page's section.
 *  guide.test.ts fails when a page has none or when a heading disappears. */
export const GUIDE_ANCHORS = {
  "/": "tableau-de-bord",
  "/transactions": "transactions",
  "/a-classer": "à-classer",
  "/categories": "catégories",
  "/import": "importer-des-relevés",
  "/settings": "réglages",
  "/aide": "bien-démarrer",
} as const;

/** Link target of a page's « ? » help link. */
export function guideHref(page: keyof typeof GUIDE_ANCHORS): string {
  return `/aide#${encodeURIComponent(GUIDE_ANCHORS[page])}`;
}
