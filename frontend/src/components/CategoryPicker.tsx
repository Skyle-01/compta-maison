"use client";

import { useEffect, useRef, useState } from "react";
import { type Category, shortPath } from "@/lib/api";
import { leafCategories, searchCategories } from "@/lib/categorySearch";

interface CategoryPickerProps {
  categories: Category[];
  value: number | null;
  onChange: (categoryId: number | null) => void;
  /** Visually flag the picker (amber) when no category is set yet. */
  highlight?: boolean;
  placeholder?: string;
}

/**
 * Typeahead category selector: fuzzy-searches the leaf categories on their full path (accents
 * ignored), ↑/↓ + Enter on the highlighted entry. Dependency-free; plain React state.
 */
export default function CategoryPicker({
  categories,
  value,
  onChange,
  highlight = false,
  placeholder = "— sans catégorie —",
}: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Highlighted entry: 0 is « sans catégorie », i > 0 is matches[i - 1].
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Leaf-only assignment, like the backend's reject_group_target.
  const leaves = leafCategories(categories);
  const selected = value != null ? leaves.find((c) => c.id === value) ?? null : null;
  const matches = query ? searchCategories(query, leaves) : leaves;

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Keep the highlighted entry in view while moving with the arrow keys.
  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function openList() {
    setOpen(true);
    setActive(selected ? leaves.indexOf(selected) + 1 : 0);
  }

  function choose(categoryId: number | null) {
    onChange(categoryId);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setQuery("");
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        openList();
        return;
      }
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => Math.min(Math.max(a + delta, 0), matches.length));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      // Nothing to pick when the query matches nothing (active then points past the list).
      const match = matches[active - 1];
      if (active === 0) choose(null);
      else if (match) choose(match.id);
    }
  }

  const entryClass = (i: number, idle: string) =>
    `block w-full px-2 py-1 text-left ${i === active ? "bg-zinc-100 text-zinc-900" : idle}`;

  return (
    <div ref={rootRef} className="relative inline-block w-52 align-top">
      <input
        value={open ? query : selected ? shortPath(selected) : ""}
        placeholder={placeholder}
        onFocus={openList}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(e.target.value ? 1 : 0);
        }}
        onKeyDown={onKeyDown}
        className={`w-full rounded border px-1 py-0.5 ${
          highlight && !selected ? "border-amber-400 bg-amber-50" : "border-zinc-200"
        }`}
      />
      {open && (
        <ul
          ref={listRef}
          className="absolute z-10 mt-0.5 max-h-60 w-72 overflow-auto rounded border border-zinc-200 bg-white py-0.5 shadow-lg"
        >
          <li>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setActive(0)}
              onClick={() => choose(null)}
              className={entryClass(0, "text-zinc-600")}
            >
              — sans catégorie —
            </button>
          </li>
          {matches.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => setActive(i + 1)}
                onClick={() => choose(c.id)}
                className={`${entryClass(i + 1, "text-zinc-700")} ${c.id === value ? "font-medium" : ""}`}
              >
                {shortPath(c)}
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="px-2 py-1 text-zinc-500">Aucun résultat</li>}
        </ul>
      )}
    </div>
  );
}
