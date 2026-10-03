import { describe, expect, it } from "vitest";
import type { Category } from "./api";
import { fold, fuzzyScore, leafCategories, searchCategories } from "./categorySearch";

const cat = (id: number, path: string, parent_id: number | null = null): Category => ({
  id,
  name: path.split(" / ").at(-1) as string,
  parent_id,
  path,
  is_root: parent_id == null,
  rule_count: 0,
  budget_target: null,
});

const CATEGORIES = [
  cat(1, "Variable"),
  cat(2, "Variable / Courses", 1),
  cat(3, "Variable / Sport", 1),
  cat(4, "Épargne"),
  cat(5, "Fixe"),
  cat(6, "Fixe / Assurance", 5),
];

describe("fuzzyScore", () => {
  it("matches characters in order, ignoring case and accents", () => {
    expect(fold("Épargne")).toBe("epargne");
    expect(fuzzyScore("epa", "Épargne")).not.toBeNull();
    expect(fuzzyScore("vsp", "Variable / Sport")).not.toBeNull();
    expect(fuzzyScore("psv", "Variable / Sport")).toBeNull();
  });
  it("scores word starts and adjacent characters higher", () => {
    expect(fuzzyScore("sp", "Variable / Sport")!).toBeGreaterThan(fuzzyScore("ar", "Variable / Sport")!);
    expect(fuzzyScore("cou", "Variable / Courses")!).toBeGreaterThan(fuzzyScore("cus", "Variable / Courses")!);
  });
  it("scores the best start, not the leftmost one", () => {
    // Greedy from the « e » of « Fixe » would miss both bonuses on « électricité ».
    expect(fuzzyScore("elec", "Fixe / Électricité")).toBe(18);
    expect(fuzzyScore("elec", "Fixe / Électricité")!).toBeGreaterThan(
      fuzzyScore("elec", "Immobilier / Résidence principale / Charges")!,
    );
  });
});

describe("searchCategories", () => {
  const leaves = leafCategories(CATEGORIES);
  it("keeps leaves only, a childless top-level category included", () => {
    expect(leaves.map((c) => c.id)).toEqual([2, 3, 4, 6]);
  });
  it("ranks the best match first", () => {
    expect(searchCategories("sport", leaves).map((c) => c.id)).toEqual([3]);
    expect(searchCategories("as", leaves)[0].id).toBe(6); // « Assurance » starts with it
    expect(searchCategories("", leaves).map((c) => c.id)).toEqual([4, 6, 2, 3]); // by path, accents folded (Épargne before Fixe)
  });
});
