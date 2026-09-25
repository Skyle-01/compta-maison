# Category picker hides top-level leaves

## Context

`frontend/src/components/CategoryPicker.tsx` only offers `!c.is_root && !parentIds.has(c.id)`: a
top-level category with no children is never selectable. The backend accepts it as a leaf
(`api/categories.py::reject_group_target` only rejects categories that have children), and rules
imported from CSV can target one. So such a category can be assigned by an imported rule but not
from the Transactions page or the Settings rule editor.

## To do / to investigate

- Check whether hiding top-level leaves is intended (top-level nodes meant as groups only). If so,
  make the backend reject them too; if not, drop the `!c.is_root` filter.

## Progress

- 2026-09-25: noted by the consolidation review; not reproduced in the UI yet.
