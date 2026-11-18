from app.core.categorize import apply_rules
from app.core.rule_issues import rule_issues
from app.db import connect
from tests.conftest import import_rows

UNUSED = {"kind": "unused", "rule_ids": [], "count": 0, "masked": False}


def _categories(db) -> dict[str, int]:
    with connect(db) as conn:
        return {
            name: conn.execute("INSERT INTO categories (name) VALUES (?)", (name,)).lastrowid
            for name in ("energie", "courses", "bar")
        }


def _rule(db, category_id: int, pattern: str, account_id: str | None = None, anchor: int = 0) -> int:
    with connect(db) as conn:
        return conn.execute(
            "INSERT INTO label_rules (category_id, pattern, is_income_anchor, account_id) VALUES (?, ?, ?, ?)",
            (category_id, pattern, anchor, account_id),
        ).lastrowid


def _debit(libelle: str, account: str = "PERSO", day: int = 1) -> tuple:
    return (f"2026-06-{day:02d}", f"2026-06-{day:02d}", libelle, 10, 0, account)


def _issues(db, *operations: tuple) -> dict[int, list[dict]]:
    """Import `operations`, classify them with the rules in place, return the issues by rule id."""
    if operations:
        import_rows(db, *operations)
    apply_rules(db)
    return rule_issues(db)


def _kinds(issues: dict[int, list[dict]], rule_id: int) -> list[str]:
    return [i["kind"] for i in issues.get(rule_id, [])]


def _one(issues: dict[int, list[dict]], rule_id: int, kind: str) -> dict:
    return next(i for i in issues[rule_id] if i["kind"] == kind)


class TestDuplicate:
    def test_the_later_rule_is_flagged_with_the_earlier_one(self, db):
        cats = _categories(db)
        first = _rule(db, cats["energie"], "EDF")
        second = _rule(db, cats["energie"], "EDF")
        issues = _issues(db, _debit("PRLV EDF"))
        assert _kinds(issues, first) == []
        assert _one(issues, second, "duplicate")["rule_ids"] == [first]
        # It keeps no operation (the first one took it): a late duplicate is also unused.
        assert _kinds(issues, second) == ["duplicate", "unused"]

    def test_other_account_category_or_anchor_is_not_a_duplicate(self, db):
        cats = _categories(db)
        _rule(db, cats["energie"], "EDF")
        by_account = _rule(db, cats["energie"], "EDF", "PERSO")
        by_category = _rule(db, cats["bar"], "EDF")
        by_anchor = _rule(db, cats["energie"], "EDF", anchor=1)
        issues = _issues(db, _debit("PRLV EDF"))
        for rule_id in (by_account, by_category, by_anchor):
            assert "duplicate" not in _kinds(issues, rule_id)


class TestRedundant:
    def test_a_longer_pattern_of_the_same_category_is_redundant(self, db):
        cats = _categories(db)
        short = _rule(db, cats["energie"], "EDF")
        long = _rule(db, cats["energie"], "EDF CLIENTS")
        issues = _issues(db, _debit("PRLV EDF CLIENTS"))
        assert _one(issues, long, "redundant")["rule_ids"] == [short]
        assert _kinds(issues, short) == []

    def test_other_category_or_anchor_flag_is_not_redundant(self, db):
        cats = _categories(db)
        _rule(db, cats["energie"], "EDF")
        other_category = _rule(db, cats["bar"], "EDF CLIENTS")
        other_anchor = _rule(db, cats["energie"], "EDF CLIENTS", anchor=1)
        issues = _issues(db, _debit("PRLV EDF CLIENTS"))
        assert "redundant" not in _kinds(issues, other_category)
        assert "redundant" not in _kinds(issues, other_anchor)

    def test_an_account_rule_is_redundant_against_a_global_one(self, db):
        cats = _categories(db)
        glob = _rule(db, cats["energie"], "EDF")
        longer = _rule(db, cats["energie"], "EDF CLIENTS", "PERSO")
        equal = _rule(db, cats["energie"], "EDF", "JOINT")
        issues = _issues(db, _debit("PRLV EDF CLIENTS"))
        assert _one(issues, longer, "redundant")["rule_ids"] == [glob]
        assert _one(issues, equal, "redundant")["rule_ids"] == [glob]
        assert "redundant" not in _kinds(issues, glob)

    def test_a_global_rule_is_not_redundant_against_an_account_rule(self, db):
        cats = _categories(db)
        _rule(db, cats["energie"], "EDF", "PERSO")
        glob = _rule(db, cats["energie"], "EDF CLIENTS")
        assert "redundant" not in _kinds(_issues(db, _debit("PRLV EDF CLIENTS")), glob)

    def test_an_account_rule_is_not_redundant_against_another_accounts_rule(self, db):
        cats = _categories(db)
        _rule(db, cats["energie"], "EDF", "JOINT")
        scoped = _rule(db, cats["energie"], "EDF CLIENTS", "PERSO")
        assert "redundant" not in _kinds(_issues(db, _debit("PRLV EDF CLIENTS")), scoped)

    def test_equal_patterns_at_one_level_are_duplicates_not_redundant(self, db):
        cats = _categories(db)
        _rule(db, cats["energie"], "EDF")
        second = _rule(db, cats["energie"], "EDF")
        assert "redundant" not in _kinds(_issues(db, _debit("PRLV EDF")), second)


class TestConflict:
    def test_rules_of_two_categories_on_a_common_operation(self, db):
        cats = _categories(db)
        leclerc = _rule(db, cats["courses"], "LECLERC")
        drive = _rule(db, cats["bar"], "DRIVE")
        issues = _issues(
            db,
            _debit("CARTE LECLERC DRIVE", day=1),
            _debit("CARTE LECLERC DRIVE", day=2),
            _debit("CARTE LECLERC", day=3),  # leclerc alone: no conflict
        )
        assert (
            _one(issues, leclerc, "conflict")["rule_ids"],
            _one(issues, leclerc, "conflict")["count"],
        ) == (
            [drive],
            2,
        )
        assert (_one(issues, drive, "conflict")["rule_ids"], _one(issues, drive, "conflict")["count"]) == (
            [leclerc],
            2,
        )

    def test_same_category_is_no_conflict(self, db):
        cats = _categories(db)
        first = _rule(db, cats["courses"], "LECLERC")
        second = _rule(db, cats["courses"], "DRIVE")
        issues = _issues(db, _debit("CARTE LECLERC DRIVE"))
        assert "conflict" not in _kinds(issues, first) + _kinds(issues, second)

    def test_an_account_rule_overriding_a_global_one_is_no_conflict(self, db):
        cats = _categories(db)
        glob = _rule(db, cats["courses"], "LECLERC")
        scoped = _rule(db, cats["bar"], "LECLERC", "PERSO")
        issues = _issues(db, _debit("CARTE LECLERC", "PERSO"))
        assert "conflict" not in _kinds(issues, glob) + _kinds(issues, scoped)

    def test_a_conflict_among_an_accounts_own_rules(self, db):
        cats = _categories(db)
        glob = _rule(db, cats["energie"], "LECLERC")
        first = _rule(db, cats["courses"], "LECLERC", "PERSO")
        second = _rule(db, cats["bar"], "DRIVE", "PERSO")
        issues = _issues(db, _debit("CARTE LECLERC DRIVE", "PERSO"))
        assert _one(issues, first, "conflict")["rule_ids"] == [second]
        assert "conflict" not in _kinds(issues, glob)

    def test_manual_operations_and_transfers_are_left_out(self, db):
        cats = _categories(db)
        first = _rule(db, cats["courses"], "LECLERC")
        second = _rule(db, cats["bar"], "DRIVE")
        import_rows(db, _debit("CARTE LECLERC DRIVE", day=1), _debit("CARTE LECLERC DRIVE", day=2))
        with connect(db) as conn:
            ids = [i for (i,) in conn.execute("SELECT id FROM transactions ORDER BY id")]
            conn.execute("UPDATE transactions SET category_manual = 1 WHERE id = ?", (ids[0],))
            conn.execute("UPDATE transactions SET kind = 'transfer' WHERE id = ?", (ids[1],))
        issues = _issues(db)
        assert "conflict" not in _kinds(issues, first) + _kinds(issues, second)


class TestShadowed:
    def test_a_global_rule_loses_the_operations_of_an_account_rule(self, db):
        cats = _categories(db)
        glob = _rule(db, cats["courses"], "LECLERC")
        scoped = _rule(db, cats["bar"], "LECLERC", "JOINT")
        issues = _issues(
            db,
            _debit("CARTE LECLERC", "JOINT", 1),
            _debit("CARTE LECLERC", "JOINT", 2),
            _debit("CARTE LECLERC", "PERSO", 3),  # still the global rule's
        )
        shadowed = _one(issues, glob, "shadowed")
        assert (shadowed["rule_ids"], shadowed["count"], shadowed["masked"]) == ([scoped], 2, False)
        assert _kinds(issues, glob) == ["shadowed"]
        assert _kinds(issues, scoped) == []

    def test_masked_when_no_operation_is_left(self, db):
        cats = _categories(db)
        glob = _rule(db, cats["courses"], "LECLERC")
        scoped = _rule(db, cats["bar"], "LECLERC", "JOINT")
        issues = _issues(db, _debit("CARTE LECLERC", "JOINT"))
        shadowed = _one(issues, glob, "shadowed")
        assert (shadowed["rule_ids"], shadowed["count"], shadowed["masked"]) == ([scoped], 1, True)
        assert "unused" not in _kinds(issues, glob)

    def test_an_account_rule_of_the_same_category_still_takes_the_operations(self, db):
        cats = _categories(db)
        glob = _rule(db, cats["courses"], "LECLERC")
        _rule(db, cats["courses"], "LECLERC", "JOINT")
        assert _one(_issues(db, _debit("CARTE LECLERC", "JOINT")), glob, "shadowed")["count"] == 1

    def test_several_overriding_rules_are_listed_and_transfers_count(self, db):
        cats = _categories(db)
        glob = _rule(db, cats["courses"], "LECLERC DRIVE")
        by_leclerc = _rule(db, cats["bar"], "LECLERC", "JOINT")
        by_drive = _rule(db, cats["energie"], "DRIVE", "JOINT")
        import_rows(db, _debit("CARTE LECLERC DRIVE", "JOINT"))
        with connect(db) as conn:
            conn.execute("UPDATE transactions SET kind = 'transfer'")
        shadowed = _one(_issues(db), glob, "shadowed")
        assert (shadowed["rule_ids"], shadowed["count"]) == ([by_leclerc, by_drive], 1)

    def test_manual_operations_are_not_lost(self, db):
        cats = _categories(db)
        glob = _rule(db, cats["courses"], "LECLERC")
        _rule(db, cats["bar"], "LECLERC", "JOINT")
        import_rows(db, _debit("CARTE LECLERC", "JOINT"))
        with connect(db) as conn:
            conn.execute("UPDATE transactions SET category_manual = 1")
        assert _kinds(_issues(db), glob) == ["unused"]

    def test_an_account_rule_is_never_shadowed(self, db):
        cats = _categories(db)
        _rule(db, cats["courses"], "LECLERC")
        scoped = _rule(db, cats["bar"], "LECLERC", "JOINT")
        assert "shadowed" not in _kinds(_issues(db, _debit("CARTE LECLERC", "JOINT")), scoped)


class TestUnused:
    def test_a_rule_that_classifies_nothing(self, db):
        cats = _categories(db)
        used = _rule(db, cats["courses"], "LECLERC")
        unused = _rule(db, cats["bar"], "ANGELUS")
        issues = _issues(db, _debit("CARTE LECLERC"))
        assert issues == {unused: [UNUSED]}
        assert used not in issues

    def test_no_operation_at_all(self, db):
        cats = _categories(db)
        rule = _rule(db, cats["courses"], "LECLERC")
        assert _issues(db) == {rule: [UNUSED]}

    def test_a_rule_of_an_account_without_matching_operations(self, db):
        cats = _categories(db)
        rule = _rule(db, cats["courses"], "LECLERC", "JOINT")
        assert _kinds(_issues(db, _debit("CARTE LECLERC", "PERSO")), rule) == ["unused"]

    def test_conflicting_rules_keep_nothing_and_are_also_unused(self, db):
        cats = _categories(db)
        first = _rule(db, cats["courses"], "LECLERC")
        second = _rule(db, cats["bar"], "DRIVE")
        issues = _issues(db, _debit("CARTE LECLERC DRIVE"))
        assert _kinds(issues, first) == ["conflict", "unused"]
        assert _kinds(issues, second) == ["conflict", "unused"]


class TestCaseSensitivity:
    def test_patterns_differing_by_case_are_distinct_rules(self, db):
        cats = _categories(db)
        upper = _rule(db, cats["energie"], "EDF")
        lower = _rule(db, cats["energie"], "Edf CLIENTS")
        issues = _issues(db, _debit("PRLV EDF CLIENTS"))
        assert _kinds(issues, upper) == []
        assert _kinds(issues, lower) == ["unused"]  # no duplicate, no redundant, matches nothing

    def test_operations_are_matched_case_sensitively(self, db):
        cats = _categories(db)
        glob = _rule(db, cats["courses"], "leclerc")
        _rule(db, cats["bar"], "LECLERC", "JOINT")
        issues = _issues(db, _debit("CARTE LECLERC", "JOINT"))
        assert _kinds(issues, glob) == ["unused"]  # not shadowed: it never matched
