import sqlite3
from collections import defaultdict
from pathlib import Path
from typing import Any

from app.core.categorize import find_conflicts
from app.db import connect

# Display order of the issues of one rule.
KINDS = ("duplicate", "redundant", "conflict", "shadowed", "unused")


def _issue(
    kind: str, rule_ids: list[int] | None = None, count: int = 0, masked: bool = False
) -> dict[str, Any]:
    """One problem of a rule. `rule_ids` = the other rules involved (the earlier twin, the rules
    containing it, the other side of a conflict, the account rules overriding it); `count` =
    operations concerned (common operations of a conflict, operations a shadowed rule loses), 0 for
    the kinds that are a test on the patterns. `masked`: a shadowed rule that keeps no operation."""
    return {"kind": kind, "rule_ids": rule_ids or [], "count": count, "masked": masked}


def _rules(conn: sqlite3.Connection) -> dict[int, tuple[str, int, int, str | None]]:
    """{rule id: (pattern, category_id, is_income_anchor, account_id)}."""
    rows = conn.execute("SELECT id, pattern, category_id, is_income_anchor, account_id FROM label_rules")
    return {
        id_: (pattern, category_id, anchor, account_id)
        for id_, pattern, category_id, anchor, account_id in rows
    }


def _pattern_issues(rules: dict[int, tuple[str, int, int, str | None]]) -> dict[int, list[dict[str, Any]]]:
    """duplicate and redundant: tests on the patterns, case-sensitive like instr in apply_rules.
    A rule is redundant when another rule of the same category and anchor flag, at its level or
    global, matches everything it matches (its pattern is strictly contained in this one's, or
    equal for an account rule facing a global one: equal patterns at one level are duplicates)."""
    issues: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for rule_id, (pattern, category_id, anchor, account_id) in rules.items():
        twins = []
        containing = []
        for other_id, (other_pattern, other_category, other_anchor, other_account) in rules.items():
            if other_id == rule_id or (other_category, other_anchor) != (category_id, anchor):
                continue
            if other_pattern == pattern and other_account == account_id and other_id < rule_id:
                twins.append(other_id)
            elif other_account is None or other_account == account_id:
                if other_pattern != pattern and other_pattern in pattern:
                    containing.append(other_id)
                elif other_pattern == pattern and account_id is not None and other_account is None:
                    containing.append(other_id)
        if twins:
            issues[rule_id].append(_issue("duplicate", twins))
        if containing:
            issues[rule_id].append(_issue("redundant", containing))
    return issues


def _conflict_issues(conn: sqlite3.Connection) -> dict[int, list[dict[str, Any]]]:
    """One issue per (rule, other rule of another category) with the operations in conflict they
    share: exactly the operations categorize.find_conflicts reports (real flows, most specific level)."""
    shared: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for rules in find_conflicts(conn).values():
        for rule_id, _, category_id in rules:
            for other_id, _, other_category in rules:
                if other_category != category_id:
                    shared[rule_id][other_id] += 1
    return {
        rule_id: [_issue("conflict", [other_id], count) for other_id, count in sorted(others.items())]
        for rule_id, others in shared.items()
    }


def _shadowed(
    conn: sqlite3.Connection, rules: dict[int, tuple[str, int, int, str | None]]
) -> dict[int, tuple[set[int], int]]:
    """{global rule id: (account rules overriding it, operations it loses)}: every non-manual
    operation (transfers included, as apply_rules does) a global rule matches on an account where an
    account rule matches too goes to the account rule."""
    matches: dict[int, list[int]] = defaultdict(list)
    for transaction_id, rule_id in conn.execute(
        "SELECT t.id, r.id FROM transactions t "
        "JOIN label_rules r ON instr(t.libelle, r.pattern) > 0 "
        "AND (r.account_id IS NULL OR r.account_id = t.account_id) "
        "WHERE t.category_manual = 0"
    ):
        matches[transaction_id].append(rule_id)
    overridden: dict[int, tuple[set[int], int]] = {}
    for rule_ids in matches.values():
        scoped = {i for i in rule_ids if rules[i][3] is not None}
        if not scoped:
            continue
        for rule_id in rule_ids:
            if rules[rule_id][3] is None:
                by, lost = overridden.get(rule_id, (set(), 0))
                overridden[rule_id] = (by | scoped, lost + 1)
    return overridden


def rule_issues(db_path: Path) -> dict[int, list[dict[str, Any]]]:
    """The problems of every rule that has any, computed on demand from the rules and the current
    classification (apply_rules has run: `rule_id` on the transactions says what each rule keeps).
    A rule can carry several issues; `unused` (keeps no operation) never goes with `shadowed`."""
    with connect(db_path) as conn:
        rules = _rules(conn)
        kept = dict(
            conn.execute(
                "SELECT rule_id, COUNT(*) FROM transactions "
                "WHERE category_manual = 0 AND rule_id IS NOT NULL GROUP BY rule_id"
            ).fetchall()
        )
        found = _pattern_issues(rules)
        for rule_id, conflicts in _conflict_issues(conn).items():
            found[rule_id].extend(conflicts)
        for rule_id, (by, lost) in _shadowed(conn, rules).items():
            found[rule_id].append(_issue("shadowed", sorted(by), lost, masked=rule_id not in kept))
        shadowed = {
            rule_id for rule_id, listed in found.items() if any(i["kind"] == "shadowed" for i in listed)
        }
        for rule_id in rules:
            if rule_id not in kept and rule_id not in shadowed:
                found[rule_id].append(_issue("unused"))
    return {
        rule_id: sorted(listed, key=lambda issue: KINDS.index(issue["kind"]))
        for rule_id, listed in sorted(found.items())
        if listed
    }
