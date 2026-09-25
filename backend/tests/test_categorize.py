from app.core.categorize import (
    apply_rules,
    category_tree,
    income_and_expenses,
    monthly_totals,
    transfers_summary,
    uncategorized_balance,
)
from app.core.transfers import recompute_transfers
from app.db import connect, import_transactions
from tests.conftest import cat_id


def _import(db, *rows):
    columns = ["Date operation", "Date valeur", "Libelle", "Debit", "Credit", "account"]
    records = [dict(zip(columns, row, strict=True)) for row in rows]
    for record in records:
        record["budget_month"] = record["Date valeur"][:7]
    import_transactions(records, db)


def _categories(db) -> dict[str, str | None]:
    with connect(db) as conn:
        return dict(
            conn.execute(
                "SELECT t.libelle, c.name FROM transactions t LEFT JOIN categories c ON c.id = t.category_id"
            ).fetchall()
        )


def _find(node: dict, name: str) -> dict:
    if node["name"] == name:
        return node
    for child in node["children"]:
        found = _find(child, name)
        if found:
            return found
    return {}


class TestApplyRules:
    def test_substring_match(self, seeded_db):
        _import(
            seeded_db,
            ("2026-06-01", "2026-06-01", "VIR EMPLOYEUR SALAIRE", 0, 2500, "PERSO"),
            ("2026-06-02", "2026-06-02", "LOYER", 800, 0, "PERSO"),
        )
        apply_rules(seeded_db)
        cats = _categories(seeded_db)
        assert cats["VIR EMPLOYEUR SALAIRE"] == "salaire"
        assert cats["LOYER"] is None

    def test_multiple_patterns_or_logic(self, seeded_db):
        _import(
            seeded_db,
            ("2026-06-01", "2026-06-01", "SUPERMARCHE E.LECLERC", 50, 0, "JOINT"),
            ("2026-06-02", "2026-06-02", "LECLERC EXPRESS", 30, 0, "JOINT"),
            ("2026-06-03", "2026-06-03", "BOULANGERIE", 5, 0, "JOINT"),
        )
        apply_rules(seeded_db)
        cats = _categories(seeded_db)
        assert cats["SUPERMARCHE E.LECLERC"] == "courses"
        assert cats["LECLERC EXPRESS"] == "courses"
        assert cats["BOULANGERIE"] is None

    def test_pattern_is_literal_not_regex(self, seeded_db):
        with connect(seeded_db) as conn:
            conn.execute(
                "INSERT INTO label_rules (category_id, pattern) VALUES (?, 'VIR PRET (ECH)')",
                (cat_id(seeded_db, "courses"),),
            )
        _import(
            seeded_db,
            ("2026-06-01", "2026-06-01", "VIR PRET (ECH)", 500, 0, "PERSO"),
            ("2026-06-02", "2026-06-02", "VIR PRET ECH", 200, 0, "PERSO"),
        )
        apply_rules(seeded_db)
        cats = _categories(seeded_db)
        assert cats["VIR PRET (ECH)"] == "courses"
        assert cats["VIR PRET ECH"] is None

    def test_manual_assignment_survives_rerun(self, seeded_db):
        _import(seeded_db, ("2026-06-01", "2026-06-01", "SUPERMARCHE", 50, 0, "JOINT"))
        apply_rules(seeded_db)
        with connect(seeded_db) as conn:  # a manual assignment, as PATCH /api/transactions/{id} does
            conn.execute(
                "UPDATE transactions SET category_id = ?, category_manual = 1 WHERE id = 1",
                (cat_id(seeded_db, "bar"),),
            )
        apply_rules(seeded_db)
        with connect(seeded_db) as conn:
            row = conn.execute(
                "SELECT category_id, category_manual FROM transactions WHERE id = 1"
            ).fetchone()
        assert row == (cat_id(seeded_db, "bar"), 1)

    def test_lowest_priority_wins(self, seeded_db):
        # 'bar' gets priority 0, beating the 'courses' SUPERMARCHE rule (priority 2)
        with connect(seeded_db) as conn:
            conn.execute(
                "INSERT INTO label_rules (category_id, pattern, priority) VALUES (?, 'SUPERMARCHE', 0)",
                (cat_id(seeded_db, "bar"),),
            )
        _import(seeded_db, ("2026-06-01", "2026-06-01", "SUPERMARCHE", 50, 0, "JOINT"))
        apply_rules(seeded_db)
        assert _categories(seeded_db)["SUPERMARCHE"] == "bar"


class TestCategoryTree:
    def test_parent_sums_children(self, seeded_db):
        _import(
            seeded_db,
            ("2026-06-01", "2026-06-01", "VIR EMPLOYEUR", 0, 2500, "PERSO"),
            ("2026-06-02", "2026-06-02", "SUPERMARCHE", 60, 0, "JOINT"),
            ("2026-06-03", "2026-06-03", "BAR ANGELUS", 20, 0, "PERSO"),
        )
        apply_rules(seeded_db)
        tree = category_tree(seeded_db, "2026-06")

        assert tree["name"] == "total"
        assert tree["balance"] == 2500 - 60 - 20

        income, expenses = income_and_expenses(seeded_db, "2026-06")
        assert income == 2500
        assert expenses == 80

        sortie = _find(tree, "sortie")
        assert _find(sortie, "bar")["debit"] == 20
        assert sortie["debit"] == 20  # parent sums its children
        assert _find(tree, "variable")["debit"] == 80

    def test_exact_cents_arithmetic(self, seeded_db):
        # 0.1 + 0.2 style float traps must not leak into totals
        _import(
            seeded_db,
            ("2026-06-01", "2026-06-01", "SUPERMARCHE A", 0.10, 0, "JOINT"),
            ("2026-06-02", "2026-06-02", "SUPERMARCHE B", 0.20, 0, "JOINT"),
        )
        apply_rules(seeded_db)
        tree = category_tree(seeded_db, "2026-06")
        assert _find(tree, "courses")["debit"] == 0.3

    def test_month_filter(self, seeded_db):
        _import(
            seeded_db,
            ("2026-05-10", "2026-05-10", "SUPERMARCHE", 100, 0, "JOINT"),
            ("2026-06-10", "2026-06-10", "SUPERMARCHE", 60, 0, "JOINT"),
        )
        apply_rules(seeded_db)
        tree = category_tree(seeded_db, "2026-06")
        assert tree["debit"] == 60


class TestUncategorizedBalance:
    def test_balanced_transfers(self, seeded_db):
        _import(
            seeded_db,
            ("2026-06-01", "2026-06-01", "VIR INTERNE", 100, 0, "PERSO"),
            ("2026-06-01", "2026-06-01", "VIR INTERNE RECU", 0, 100, "JOINT"),
        )
        apply_rules(seeded_db)
        stats = uncategorized_balance(seeded_db, "2026-06")
        assert stats["count"] == 2
        assert stats["balanced"] is True

    def test_unbalanced_flags_warning(self, seeded_db):
        _import(seeded_db, ("2026-06-01", "2026-06-01", "MYSTERY", 42, 0, "PERSO"))
        apply_rules(seeded_db)
        stats = uncategorized_balance(seeded_db, "2026-06")
        assert stats["balanced"] is False
        assert stats["difference"] == -42


class TestUncategorizedTreeNode:
    def test_uncategorised_node_matches_balance(self, seeded_db):
        _import(seeded_db, ("2026-06-01", "2026-06-01", "MYSTERY SHOP", 42, 0, "PERSO"))
        apply_rules(seeded_db)
        tree = category_tree(seeded_db, "2026-06")
        node = _find(tree, "uncategorised")
        assert node["balance"] == uncategorized_balance(seeded_db, "2026-06")["difference"]
        assert node["balance"] == -42


class TestSavingsTreeNodes:
    """Savings movements surface as derived leaves: money saved under 'Épargne', money dipped
    into under 'Déficit'. Nets are bucketed per account-month."""

    def test_deposit_is_epargne_leaf(self, db):
        # LIVRET is the seeded type='savings' account (label "Livret A").
        _import(db, ("2026-06-10", "2026-06-10", "VIR de COMPTE", 0, 500, "LIVRET"))
        tree = category_tree(db, "2026-06")
        epargne = _find(tree, "Épargne")
        leaf = _find(epargne, "Livret A")
        assert epargne and leaf["balance"] == -500  # outflow (debit)
        assert leaf["account_id"] == "LIVRET"  # so the UI can list that account's operations
        assert _find(tree, "Déficit") == {}  # net positive -> no désépargne

    def test_nests_under_existing_epargne_category(self, db):
        # The derived leaf joins the real 'Épargne' group instead of spawning a 2nd top node.
        with connect(db) as conn:
            conn.execute("INSERT INTO categories (name, parent_id) VALUES ('Épargne', NULL)")
        _import(db, ("2026-06-10", "2026-06-10", "VIR de COMPTE", 0, 500, "LIVRET"))
        tree = category_tree(db, "2026-06")
        tops = [c["name"] for c in tree["children"]]
        assert tops.count("Épargne") == 1  # single épargne group
        assert _find(_find(tree, "Épargne"), "Livret A")["balance"] == -500

    def test_withdrawal_is_desepargne_leaf(self, db):
        _import(db, ("2026-06-10", "2026-06-10", "RETRAIT LIVRET", 200, 0, "LIVRET"))
        tree = category_tree(db, "2026-06")
        leaf = _find(_find(tree, "Déficit"), "Livret A")
        assert leaf["balance"] == 200  # inflow (credit)
        assert leaf["account_id"] == "LIVRET"
        assert _find(tree, "Épargne") == {}

    def test_nets_per_month_to_one_sign(self, db):
        # A deposit and a withdrawal in the same month cancel; only the net épargne shows.
        _import(
            db,
            ("2026-06-05", "2026-06-05", "VIR de COMPTE", 0, 500, "LIVRET"),
            ("2026-06-20", "2026-06-20", "RETRAIT LIVRET", 200, 0, "LIVRET"),
        )
        tree = category_tree(db, "2026-06")
        assert _find(_find(tree, "Épargne"), "Livret A")["balance"] == -300
        assert _find(tree, "Déficit") == {}

    def test_aggregate_view_shows_both_sides(self, db):
        # Saved in May, dipped in June: the all-months view surfaces both, instead of netting
        # them to one number (the bug where désépargne "disappeared").
        _import(
            db,
            ("2026-05-10", "2026-05-10", "VIR de COMPTE", 0, 500, "LIVRET"),
            ("2026-06-20", "2026-06-20", "RETRAIT LIVRET", 200, 0, "LIVRET"),
        )
        tree = category_tree(db)  # all months
        assert _find(_find(tree, "Épargne"), "Livret A")["balance"] == -500
        assert _find(_find(tree, "Déficit"), "Livret A")["balance"] == 200

    def test_external_savings_deposit(self, db):
        # ENFANT is an external savings account: no statement of its own, deposits detected by
        # the 'VERS LIVRET ENFANT' libellé on a checking account.
        _import(db, ("2026-06-10", "2026-06-10", "VERS LIVRET ENFANT", 25, 0, "JOINT"))
        recompute_transfers(db)
        # The deposit drops out of expenses, exactly like a Livret A transfer.
        _income, expenses = income_and_expenses(db, "2026-06")
        assert expenses == 0
        with connect(db) as conn:
            assert conn.execute("SELECT kind FROM transactions").fetchone()[0] == "transfer"
        tree = category_tree(db, "2026-06")
        leaf = _find(_find(tree, "Épargne"), "Livret enfant")
        assert leaf["balance"] == -25  # outflow to savings
        assert leaf["libelle_match"] == "VERS LIVRET ENFANT"  # external -> drill down by libellé
        assert "account_id" not in leaf

    def test_single_legged_savings_excluded_from_transfers_summary(self, db):
        # A paired internal transfer (PERSO -> LIVRET) plus a single-legged external-savings
        # deposit. Only the paired one is an "internal transfer"; both stay out of real flows.
        _import(
            db,
            ("2026-06-10", "2026-06-10", "VIR vers LIVRET", 500, 0, "PERSO"),
            ("2026-06-11", "2026-06-11", "VIR de COMPTE", 0, 500, "LIVRET"),
            ("2026-06-12", "2026-06-12", "VERS LIVRET ENFANT", 25, 0, "JOINT"),
        )
        recompute_transfers(db)
        assert transfers_summary(db, "2026-06") == {"count": 1, "total": 500.0}  # paired only
        assert income_and_expenses(db, "2026-06") == (0.0, 0.0)  # both excluded from real flows

    def test_external_savings_withdrawal_is_desepargne(self, db):
        # Contrived but locks the external Σdebit−Σcredit sign: a credit matching the pattern
        # nets negative, so the account surfaces under Déficit (money came back out of savings).
        _import(db, ("2026-06-10", "2026-06-10", "VERS LIVRET ENFANT retour", 0, 25, "JOINT"))
        recompute_transfers(db)
        tree = category_tree(db, "2026-06")
        leaf = _find(_find(tree, "Déficit"), "Livret enfant")
        assert leaf["balance"] == 25  # inflow (credit)
        assert leaf["libelle_match"] == "VERS LIVRET ENFANT"
        assert _find(tree, "Épargne") == {}

    def test_checking_movements_are_not_savings(self, db):
        _import(db, ("2026-06-10", "2026-06-10", "SALAIRE", 0, 500, "PERSO"))
        tree = category_tree(db, "2026-06")
        assert _find(tree, "Épargne") == {} and _find(tree, "Déficit") == {}


class TestMonthlyTotals:
    """The per-month trend series feeding the dashboard sparkline and card deltas."""

    def test_per_month_oldest_first_matches_single_month(self, seeded_db):
        _import(
            seeded_db,
            ("2026-05-10", "2026-05-10", "VIR EMPLOYEUR", 0, 2000, "PERSO"),
            ("2026-05-12", "2026-05-12", "SUPERMARCHE", 100, 0, "JOINT"),
            ("2026-06-10", "2026-06-10", "VIR EMPLOYEUR", 0, 2500, "PERSO"),
            ("2026-06-12", "2026-06-12", "BAR ANGELUS", 20, 0, "PERSO"),
        )
        apply_rules(seeded_db)
        rows = monthly_totals(seeded_db)
        assert [r["month"] for r in rows] == ["2026-05", "2026-06"]  # oldest first
        may = rows[0]
        assert (may["income"], may["expenses"]) == (2000, 100)
        assert (may["income"], may["expenses"]) == income_and_expenses(seeded_db, "2026-05")

    def test_reste_includes_savings_and_matches_tree_total(self, seeded_db):
        _import(
            seeded_db,
            ("2026-06-10", "2026-06-10", "VIR EMPLOYEUR", 0, 2500, "PERSO"),
            ("2026-06-11", "2026-06-11", "VIR vers LIVRET", 500, 0, "PERSO"),
            ("2026-06-12", "2026-06-12", "VIR de COMPTE", 0, 500, "LIVRET"),
            ("2026-06-13", "2026-06-13", "BAR ANGELUS", 20, 0, "PERSO"),
        )
        apply_rules(seeded_db)
        recompute_transfers(seeded_db)  # pairs the LIVRET leg out of income/expenses
        row = next(r for r in monthly_totals(seeded_db) if r["month"] == "2026-06")
        assert (row["epargne"], row["desepargne"]) == (500, 0)
        assert row["reste"] == round(row["income"] - row["expenses"] - row["epargne"] + row["desepargne"], 2)
        assert row["reste"] == category_tree(seeded_db, "2026-06")["balance"]
