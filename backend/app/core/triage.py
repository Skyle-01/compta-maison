"""Fast triage of uncategorised operations (the « À classer » page): group similar labels, propose
a rule pattern per group, suggest a category learned from the already categorised rows, and
preview what a new rule would take from the existing ones."""

import re
import unicodedata
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

from app.core.categorize import find_conflicts
from app.db import DEFAULT_DB_PATH, connect, real_flow_clause

# Bank vocabulary and French glue words: they say how money moved, not to whom, so they never
# identify a merchant on their own.
GENERIC_TOKENS = frozenset(
    {
        "AU",
        "AUX",
        "CARTE",
        "CB",
        "DAB",
        "DE",
        "DES",
        "DU",
        "ECH",
        "EN",
        "ET",
        "EUR",
        "FACT",
        "FACTURE",
        "INST",
        "LA",
        "LE",
        "LES",
        "PAIEMENT",
        "PAR",
        "POUR",
        "PRELEVEMENT",
        "PRLV",
        "REF",
        "RET",
        "RETRAIT",
        "SEPA",
        "SUR",
        "VERS",
        "VIR",
        "VIREMENT",
    }
)
MONTH_TOKENS = frozenset(
    {
        "JANVIER",
        "FEVRIER",
        "MARS",
        "AVRIL",
        "MAI",
        "JUIN",
        "JUILLET",
        "AOUT",
        "SEPTEMBRE",
        "OCTOBRE",
        "NOVEMBRE",
        "DECEMBRE",
    }
)
# A pattern needs this many letters outside generic words to be specific enough for a rule.
MIN_SIGNIFICANT_LETTERS = 3
MIN_PATTERN_LENGTH = 4
# The winning category must hold this share of the vote to be suggested.
MIN_SUGGESTION_SHARE = 0.6
_EDGE_PUNCTUATION = " -*./,:;'"


def _fold(text: str) -> str:
    """Upper case without accents, so `Février` and `FEVRIER` compare equal."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).upper()


def _tokens(libelle: str) -> list[str]:
    return re.findall(r"[A-Z0-9]+", _fold(libelle))


def _is_significant(token: str) -> bool:
    return token.isalpha() and len(token) >= 3 and token not in GENERIC_TOKENS and token not in MONTH_TOKENS


def significant_tokens(libelle: str) -> list[str]:
    """The words that can identify a merchant or a person: no digits, months or bank vocabulary."""
    return [t for t in _tokens(libelle) if _is_significant(t)]


def label_key(libelle: str) -> str:
    """Grouping key: the label's words without dates, amounts, references or month names (two
    card payments to the same shop on different days share a key). A label left with no
    significant word keeps its raw text, so generic labels (`VIR 1234`) are never merged."""
    words = [t for t in _tokens(libelle) if not any(c.isdigit() for c in t) and t not in MONTH_TOKENS]
    if not any(_is_significant(w) for w in words):
        return libelle
    return " ".join(words)


def _bounded(sub: str, label: str, left: bool) -> bool:
    """True when some occurrence of `sub` in `label` starts (left) or ends (right) on a word edge."""
    i = label.find(sub)
    while i != -1:
        edge = i - 1 if left else i + len(sub)
        if edge < 0 or edge >= len(label) or not label[edge].isalnum():
            return True
        i = label.find(sub, i + 1)
    return False


def _edge_word_ok(word: str) -> bool:
    return any(c.isalpha() for c in word) and _fold(word) not in MONTH_TOKENS


def _trim(sub: str, labels: list[str]) -> str:
    """Drop edge words that are cut mid-word in some label, carry no letter or name a month;
    whatever remains is still a substring of every label."""
    while True:
        sub = sub.strip(_EDGE_PUNCTUATION)
        if not sub:
            return ""
        words = sub.split(" ")
        if not all(_bounded(sub, label, left=True) for label in labels) or not _edge_word_ok(words[0]):
            sub = " ".join(words[1:])
        elif not all(_bounded(sub, label, left=False) for label in labels) or not _edge_word_ok(words[-1]):
            sub = " ".join(words[:-1])
        else:
            return sub


def default_pattern(labels: list[str]) -> str:
    """The longest substring shared by every label (case-sensitive, like the rule engine's
    instr), without digits and trimmed to whole words, so the rule matches every member of the
    group but no date or amount. Empty when the labels share nothing usable."""
    if not labels:
        return ""
    shortest = min(labels, key=len)
    best = ""
    for length in range(len(shortest), 0, -1):
        if length <= len(best):
            break  # trimming only shortens, so no shorter candidate can win
        for start in range(len(shortest) - length + 1):
            sub = shortest[start : start + length]
            if any(c.isdigit() for c in sub) or not all(sub in label for label in labels):
                continue
            trimmed = _trim(sub, labels)
            if len(trimmed) > len(best):
                best = trimmed
    return best


def is_generic(pattern: str) -> bool:
    """Too short or made of bank vocabulary only (`VIR`, `CARTE`): a rule on it would swallow
    unrelated operations."""
    letters = sum(len(t) for t in significant_tokens(pattern))
    return len(pattern.strip()) < MIN_PATTERN_LENGTH or letters < MIN_SIGNIFICANT_LETTERS


@dataclass(frozen=True)
class Suggestion:
    category_id: int
    count: int  # categorised rows backing it
    token: str | None  # the deciding word; None when they share the group's whole key


@dataclass
class SuggestionIndex:
    """What the already categorised rows say about labels: categories per grouping key and per
    significant word (rows counted once per word)."""

    by_key: dict[str, Counter[int]] = field(default_factory=lambda: defaultdict(Counter))
    by_token: dict[str, Counter[int]] = field(default_factory=lambda: defaultdict(Counter))

    @classmethod
    def build(cls, categorised: Iterable[tuple[str, int]]) -> "SuggestionIndex":
        index = cls()
        for libelle, category_id in categorised:
            index.by_key[label_key(libelle)][category_id] += 1
            for token in set(significant_tokens(libelle)):
                index.by_token[token][category_id] += 1
        return index

    def suggest(self, key: str) -> Suggestion | None:
        """Best category for a group key: the majority category of rows with the same key, else
        a vote of the key's words, each word seen in a single category voting for it (a word
        spread over several categories, a city name say, says nothing). The label's first
        significant word, usually the merchant or payee, must vote for the winner: a lone
        trailing word (`LIBRAIRIE DU CENTRE` vs a categorised `CENTRE PAJEMPLOI`) misleads more
        often than it helps. None when no category wins a clear majority."""
        same = self.by_key.get(key)
        if same:
            category_id, count = same.most_common(1)[0]
            if count / same.total() >= MIN_SUGGESTION_SHARE:
                return Suggestion(category_id, count, None)
        tokens = list(dict.fromkeys(significant_tokens(key)))
        votes: Counter[int] = Counter()
        for token in tokens:
            per_category = self.by_token.get(token)
            if per_category and len(per_category) == 1:
                votes[next(iter(per_category))] += 1
        first = self.by_token.get(tokens[0]) if tokens else None
        if not first or len(first) > 1:
            return None
        ((category_id, rows),) = first.items()
        if votes[category_id] / votes.total() < MIN_SUGGESTION_SHARE:
            return None
        return Suggestion(category_id, rows, tokens[0])


@dataclass
class UncategorizedGroup:
    key: str
    pattern: str
    pattern_generic: bool
    transaction_ids: list[int]  # newest first
    debit_cents: int
    credit_cents: int
    first_date: str
    last_date: str
    accounts: list[str]
    suggestion: Suggestion | None


def _scope(month: str | None, account: str | None) -> tuple[str, tuple]:
    """The ` AND ...` SQL clause and params limiting `transactions` to a budget month and/or an
    account (empty when neither is set)."""
    clause, params = "", []
    if month:
        clause += " AND budget_month = ?"
        params.append(month)
    if account:
        clause += " AND account_id = ?"
        params.append(account)
    return clause, tuple(params)


def uncategorized_groups(
    db_path: Path = DEFAULT_DB_PATH, month: str | None = None, account: str | None = None
) -> list[UncategorizedGroup]:
    """Uncategorised non-transfer operations (optionally of one budget month and/or one account)
    grouped by label key, largest gross total (debits + credits) first. Suggestions learn from every
    categorised real flow, whatever the month and the account."""
    scope, params = _scope(month, account)
    query = (
        "SELECT id, libelle, date_valeur, debit_cents, credit_cents, account_id FROM transactions "
        f"WHERE category_id IS NULL AND {real_flow_clause()}{scope}"
    )
    with connect(db_path) as conn:
        conflicted = find_conflicts(conn)  # listed apart, see conflicted_operations
        rows = [
            row
            for row in conn.execute(query + " ORDER BY date_valeur DESC, id DESC", params)
            if row[0] not in conflicted
        ]
        categorised = conn.execute(
            f"SELECT libelle, category_id FROM transactions WHERE category_id IS NOT NULL AND {real_flow_clause()}"
        ).fetchall()
    index = SuggestionIndex.build(categorised)
    members: dict[str, list[tuple]] = defaultdict(list)
    for row in rows:
        members[label_key(row[1])].append(row)
    groups = []
    for key, group_rows in members.items():
        pattern = default_pattern(sorted({row[1] for row in group_rows}))
        dates = [row[2] for row in group_rows]
        groups.append(
            UncategorizedGroup(
                key=key,
                pattern=pattern,
                pattern_generic=is_generic(pattern),
                transaction_ids=[row[0] for row in group_rows],
                debit_cents=sum(row[3] for row in group_rows),
                credit_cents=sum(row[4] for row in group_rows),
                first_date=min(dates),
                last_date=max(dates),
                accounts=sorted({row[5] for row in group_rows if row[5]}),
                suggestion=index.suggest(key),
            )
        )
    groups.sort(key=lambda g: (-(g.debit_cents + g.credit_cents), g.key))
    return groups


@dataclass(frozen=True)
class RuleOverlap:
    rule_id: int
    pattern: str
    category_id: int
    count: int


def rule_preview(
    db_path: Path,
    pattern: str,
    category_id: int | None = None,
    rule_id: int | None = None,
    account_id: str | None = None,
) -> tuple[int, list[RuleOverlap]]:
    """What a rule `pattern` on `category_id` would do: the uncategorised non-transfer rows it
    would classify (rows already in conflict stay out), and per other rule of another category
    the non-manual real-flow operations both match, which would become a conflict. `rule_id` is
    the rule being edited, left out of the comparison. `account_id` scopes the rule (None = all
    accounts): it only sees that account's operations and only conflicts with rules of the same
    level; a global rule leaves out the operations an account rule already takes over."""
    with connect(db_path) as conn:
        conflicted = find_conflicts(conn)
        uncategorized = [
            row[0]
            for row in conn.execute(
                f"SELECT id FROM transactions WHERE category_id IS NULL AND {real_flow_clause()} "
                "AND instr(libelle, ?) > 0 AND (? IS NULL OR account_id = ?)",
                (pattern, account_id, account_id),
            )
            if row[0] not in conflicted
        ]
        overlaps = conn.execute(
            "SELECT lr.id, lr.pattern, lr.category_id, COUNT(*) FROM transactions t "
            "JOIN label_rules lr ON instr(t.libelle, lr.pattern) > 0 "
            "AND (lr.account_id IS NULL OR lr.account_id = t.account_id) "
            f"WHERE t.category_manual = 0 AND {real_flow_clause('t.kind')} AND instr(t.libelle, ?) > 0 "
            "AND lr.id IS NOT ? AND lr.category_id IS NOT ? "
            "AND lr.account_id IS ? AND (? IS NULL OR t.account_id = ?) "
            "AND (? IS NOT NULL OR NOT EXISTS ("
            "  SELECT 1 FROM label_rules sr WHERE sr.account_id = t.account_id AND instr(t.libelle, sr.pattern) > 0"
            ")) "
            "GROUP BY lr.id ORDER BY COUNT(*) DESC, lr.id",
            (pattern, rule_id, category_id, account_id, account_id, account_id, account_id),
        ).fetchall()
    return len(uncategorized), [RuleOverlap(*row) for row in overlaps]


def conflicted_operations(
    db_path: Path = DEFAULT_DB_PATH, month: str | None = None, account: str | None = None
) -> list[tuple[int, list[tuple[int, str, int]]]]:
    """(transaction id, rules in cause) of the operations in conflict (optionally of one budget
    month and/or one account), newest first."""
    with connect(db_path) as conn:
        conflicts = find_conflicts(conn)
        if not conflicts:
            return []
        ids = ",".join(str(i) for i in conflicts)
        scope, params = _scope(month, account)
        ordered = conn.execute(
            f"SELECT id FROM transactions WHERE id IN ({ids}){scope} ORDER BY date_valeur DESC, id DESC",
            params,
        ).fetchall()
    return [(row[0], conflicts[row[0]]) for row in ordered]
