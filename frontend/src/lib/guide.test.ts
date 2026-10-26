import { readFileSync } from "node:fs";
import { join } from "node:path";
import GithubSlugger from "github-slugger";
import { describe, expect, it } from "vitest";
import { GUIDE_ANCHORS, guideHref } from "./guide";
import { NAV } from "./nav";

// vitest runs from frontend/; the guide lives at the repo root.
const guide = readFileSync(join(process.cwd(), "..", "docs", "guide.md"), "utf8");

/** The slugs rehype-slug gives the guide's headings (lines in fenced blocks are not headings). */
function headingSlugs(markdown: string): Set<string> {
  const slugger = new GithubSlugger();
  const slugs = new Set<string>();
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    const m = !fenced && /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (m) slugs.add(slugger.slug(m[1]));
  }
  return slugs;
}

describe("docs/guide.md coverage", () => {
  const slugs = headingSlugs(guide);

  it("has an anchor for every navigation page", () => {
    for (const { href } of NAV) expect(GUIDE_ANCHORS, href).toHaveProperty([href]);
  });

  it("has a heading for every anchor", () => {
    for (const [page, anchor] of Object.entries(GUIDE_ANCHORS)) {
      expect(slugs.has(anchor), `${page} -> #${anchor}`).toBe(true);
    }
  });

  it("builds the help link of a page", () => {
    expect(guideHref("/a-classer")).toBe("/aide#%C3%A0-classer");
  });
});
