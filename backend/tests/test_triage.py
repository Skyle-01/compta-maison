from app.core.categorize import apply_rules
from app.core.triage import (
    SuggestionIndex,
    default_pattern,
    is_generic,
    label_key,
    rule_preview,
    uncategorized_groups,
)
from app.db import connect
from tests.conftest import cat_id, import_rows


def _import(db, *rows: tuple) -> None:
    import_rows(db, *rows)
    apply_rules(db)


class TestLabelKey:
    def test_dated_card_payments_share_a_key(self):
        assert label_key("CARTE 12/05 BOULANGERIE DUPONT") == label_key("CARTE 03/06 BOULANGERIE DUPONT")

    def test_months_years_and_amounts_dropped(self):
        assert label_key("VIR LOYER - Avril 2026") == label_key("VIR LOYER - Mai 2026") == "VIR LOYER"
        assert label_key("CARTE 02/07 SHOP CITY 12,50 USD") == "CARTE SHOP CITY USD"

    def test_accents_and_case_folded(self):
        assert label_key("VIR cotisation Février") == label_key("VIR COTISATION FEVRIER")

    def test_different_merchants_differ(self):
        assert label_key("CARTE 12/05 BOULANGERIE DUPONT") != label_key("CARTE 12/05 BOULANGERIE MARTIN")
        assert label_key("CARTE PRIMEUR") != label_key("PRLV PRIMEUR")

    def test_generic_labels_never_merged(self):
        assert label_key("VIR 123456") == "VIR 123456"
        assert label_key("VIR 123456") != label_key("VIR 654321")


class TestDefaultPattern:
    def test_common_merchant_without_dates(self):
        labels = ["CARTE 12/05 BOULANGERIE DUPONT", "CARTE 13/06 BOULANGERIE DUPONT"]
        assert default_pattern(labels) == "BOULANGERIE DUPONT"

    def test_shared_date_is_not_kept(self):
        labels = ["CARTE 12/05 BOULANGERIE DUPONT", "CARTE 12/05 BOULANGERIE DUPONT"]
        assert default_pattern(labels) == "BOULANGERIE DUPONT"

    def test_month_and_punctuation_trimmed(self):
        labels = ["VIR LOYER - Avril 2026", "VIR LOYER - Mai 2026"]
        assert default_pattern(labels) == "VIR LOYER"
        assert default_pattern(["VIR LOYER - Avril 2026"]) == "VIR LOYER"

    def test_cut_words_trimmed(self):
        # The raw longest common substring is "ERIE DUPONT": a cut word must go.
        labels = ["CARTE 12/05 BOULANGERIE DUPONT", "CARTE 12/05 EPICERIE DUPONT"]
        assert default_pattern(labels) == "DUPONT"

    def test_matches_every_member_case_sensitively(self):
        labels = ["PRLV SEPA Assurance Habitation 0001", "PRLV SEPA ASSURANCE HABITATION 0002"]
        pattern = default_pattern(labels)
        assert pattern == "PRLV SEPA"
        assert all(pattern in label for label in labels)

    def test_single_label(self):
        assert default_pattern(["CARTE 12/05 BOULANGERIE DUPONT"]) == "BOULANGERIE DUPONT"

    def test_nothing_in_common(self):
        assert default_pattern(["ABC 1", "XYZ 2"]) == ""


class TestIsGeneric:
    def test_bank_vocabulary_is_generic(self):
        assert is_generic("VIR")
        assert is_generic("PRLV SEPA")
        assert is_generic("CARTE")
        assert is_generic("")

    def test_merchant_is_specific(self):
        assert not is_generic("BOULANGERIE DUPONT")
        assert not is_generic("VIR LOYER")


class TestSuggestion:
    def test_same_key_wins(self):
        index = SuggestionIndex.build(
            [("CARTE 01/04 BOULANGERIE DUPONT", 7), ("CARTE 08/04 BOULANGERIE DUPONT", 7)]
        )
        suggestion = index.suggest(label_key("CARTE 12/05 BOULANGERIE DUPONT"))
        assert (suggestion.category_id, suggestion.count, suggestion.token) == (7, 2, None)

    def test_word_vote(self):
        index = SuggestionIndex.build(
            [
                ("CARTE 01/04 BOULANGERIE DUPONT", 7),
                ("CARTE 02/04 BOULANGERIE MARTIN", 7),
                ("CARTE 03/04 PHARMACIE CENTRALE", 9),
            ]
        )
        suggestion = index.suggest(label_key("CARTE 12/05 BOULANGERIE DURAND"))
        assert (suggestion.category_id, suggestion.count, suggestion.token) == (7, 2, "BOULANGERIE")

    def test_word_seen_in_several_categories_is_ignored(self):
        # LYON (a city) appears under two categories: it says nothing about a new LYON shop.
        index = SuggestionIndex.build([("CARTE BOULANGERIE LYON", 7), ("CARTE PHARMACIE LYON", 9)])
        assert index.suggest(label_key("CARTE 12/05 LIBRAIRIE LYON")) is None

    def test_first_word_must_vote(self):
        # Only the trailing CENTRE is known: the merchant (LIBRAIRIE) says nothing, so no guess.
        index = SuggestionIndex.build([("PRLV CENTRE PAJEMPLOI", 7)])
        assert index.suggest(label_key("CARTE LIBRAIRIE DU CENTRE")) is None
        assert index.suggest(label_key("PRLV CENTRE AERE")).category_id == 7

    def test_split_vote_suggests_nothing(self):
        index = SuggestionIndex.build([("CARTE BOULANGERIE", 7), ("CARTE PHARMACIE", 9)])
        assert index.suggest(label_key("CARTE BOULANGERIE PHARMACIE")) is None

    def test_unknown_words_suggest_nothing(self):
        index = SuggestionIndex.build([("CARTE BOULANGERIE", 7)])
        assert index.suggest(label_key("CARTE LIBRAIRIE")) is None
        assert SuggestionIndex.build([]).suggest("CARTE LIBRAIRIE") is None


class TestUncategorizedGroups:
    def test_groups_sorted_by_gross_total(self, seeded_db):
        _import(
            seeded_db,
            ("2026-06-01", "2026-06-01", "CARTE 01/06 BOULANGERIE DUPONT", 4.2, 0, "PERSO"),
            ("2026-06-08", "2026-06-08", "CARTE 08/06 BOULANGERIE DUPONT", 5.8, 0, "PERSO"),
            ("2026-06-09", "2026-06-09", "CARTE 09/06 LIBRAIRIE", 30, 0, "JOINT"),
            ("2026-06-10", "2026-06-10", "CARTE SUPERMARCHE", 50, 0, "PERSO"),  # rule-classified
        )
        groups = uncategorized_groups(seeded_db)
        assert [(g.key, len(g.transaction_ids)) for g in groups] == [
            ("CARTE LIBRAIRIE", 1),
            ("CARTE BOULANGERIE DUPONT", 2),
        ]
        bakery = groups[1]
        assert bakery.pattern == "BOULANGERIE DUPONT" and not bakery.pattern_generic
        assert (bakery.debit_cents, bakery.credit_cents) == (1000, 0)
        assert (bakery.first_date, bakery.last_date, bakery.accounts) == (
            "2026-06-01",
            "2026-06-08",
            ["PERSO"],
        )

    def test_month_filter_and_suggestion_from_any_month(self, seeded_db):
        _import(
            seeded_db,
            ("2026-05-01", "2026-05-01", "CARTE 01/05 BOULANGERIE DUPONT", 4, 0, "PERSO"),
            ("2026-06-02", "2026-06-02", "CARTE 02/06 BOULANGERIE DUPONT", 5, 0, "PERSO"),
            ("2026-06-03", "2026-06-03", "CARTE 03/06 LIBRAIRIE", 30, 0, "PERSO"),
        )
        courses = cat_id(seeded_db, "courses")
        with connect(seeded_db) as conn:
            conn.execute(
                "UPDATE transactions SET category_id = ?, category_manual = 1 WHERE date_operation = '2026-05-01'",
                (courses,),
            )
        groups = uncategorized_groups(seeded_db, month="2026-06")
        assert [g.key for g in groups] == ["CARTE LIBRAIRIE", "CARTE BOULANGERIE DUPONT"]
        assert groups[0].suggestion is None
        assert groups[1].suggestion.category_id == courses

    def test_transfers_left_out(self, seeded_db):
        _import(seeded_db, ("2026-06-01", "2026-06-01", "VIR vers COMPTE JOINT", 100, 0, "PERSO"))
        with connect(seeded_db) as conn:
            conn.execute("UPDATE transactions SET kind = 'transfer'")
        assert uncategorized_groups(seeded_db) == []


class TestRulePreview:
    def test_counts_uncategorized_and_rows_taken_from_weaker_rules(self, seeded_db):
        _import(
            seeded_db,
            ("2026-06-01", "2026-06-01", "CARTE LECLERC DRIVE", 40, 0, "PERSO"),  # LECLERC, priority 3
            ("2026-06-02", "2026-06-02", "CARTE LECLERC DRIVE", 20, 0, "PERSO"),
            ("2026-06-03", "2026-06-03", "CARTE DRIVE PIZZA", 15, 0, "PERSO"),  # uncategorised
        )
        uncategorized, lost = rule_preview(seeded_db, "DRIVE", 1)
        assert uncategorized == 1
        assert [(r.pattern, r.count) for r in lost] == [("LECLERC", 2)]

    def test_tie_or_lower_number_keeps_the_existing_rule(self, seeded_db):
        _import(seeded_db, ("2026-06-01", "2026-06-01", "CARTE LECLERC DRIVE", 40, 0, "PERSO"))
        assert rule_preview(seeded_db, "DRIVE", 3) == (0, [])
        assert rule_preview(seeded_db, "DRIVE", 100) == (0, [])

    def test_same_category_and_manual_rows_not_reported(self, seeded_db):
        _import(
            seeded_db,
            ("2026-06-01", "2026-06-01", "CARTE LECLERC DRIVE", 40, 0, "PERSO"),
            ("2026-06-02", "2026-06-02", "CARTE LECLERC DRIVE", 20, 0, "PERSO"),
        )
        courses = cat_id(seeded_db, "courses")
        assert rule_preview(seeded_db, "DRIVE", 1, category_id=courses) == (0, [])
        with connect(seeded_db) as conn:
            conn.execute(
                "UPDATE transactions SET category_manual = 1, rule_id = NULL WHERE debit_cents = 4000"
            )
        _, lost = rule_preview(seeded_db, "DRIVE", 1)
        assert [(r.pattern, r.count) for r in lost] == [("LECLERC", 1)]
