"use client";

import { useEffect, useRef, useState } from "react";
import { type Category, shortPath } from "@/lib/api";

interface CategoryPickerProps {
  categories: Category[];
  value: number | null;
  onChange: (categoryId: number | null) => void;
  /** Visually flag the picker (amber) when no category is set yet. */
  highlight?: boolean;
  placeholder?: string;
}

/**
 * Typeahead category selector — filters the (non-root) category tree by typing,
 * replacing a long flat <select>. Dependency-free; plain React state.
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
  const rootRef = useRef<HTMLDivElement>(null);

  // Leaf-only assignment: a category is selectable when no other category is parented to it,
  // top-level or not (mirrors the backend's reject_group_target guard).
  const parentIds = new Set(
    categories.map((c) => c.parent_id).filter((id): id is number => id != null),
  );
  const selectable = categories.filter((c) => !parentIds.has(c.id));
  const selected = value != null ? selectable.find((c) => c.id === value) ?? null : null;
  const matches = query
    ? selectable.filter((c) => shortPath(c).toLowerCase().includes(query.toLowerCase()))
    : selectable;

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function choose(categoryId: number | null) {
    onChange(categoryId);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative inline-block w-52 align-top">
      <input
        value={open ? query : selected ? shortPath(selected) : ""}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className={`w-full rounded border px-1 py-0.5 ${
          highlight && !selected ? "border-amber-400 bg-amber-50" : "border-zinc-200"
        }`}
      />
      {open && (
        <ul className="absolute z-10 mt-0.5 max-h-60 w-72 overflow-auto rounded border border-zinc-200 bg-white py-0.5 shadow-lg">
          <li>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(null)}
              className="block w-full px-2 py-1 text-left text-zinc-400 hover:bg-zinc-50"
            >
              — sans catégorie —
            </button>
          </li>
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(c.id)}
                className={`block w-full px-2 py-1 text-left hover:bg-zinc-50 ${
                  c.id === value ? "font-medium text-zinc-900" : "text-zinc-700"
                }`}
              >
                {shortPath(c)}
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="px-2 py-1 text-zinc-400">Aucun résultat</li>}
        </ul>
      )}
    </div>
  );
}
