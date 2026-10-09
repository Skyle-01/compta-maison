from typing import Any

from pydantic import BaseModel, Field

from app.core.transfers import TransferMode


class ImportResult(BaseModel):
    account: str
    rows_total: int
    rows_new: int
    rows_before_start: int = Field(
        0, description="Rows valued before the configured start date, not imported"
    )
    uncategorized_count: int
    balance_warnings: dict[str, float] = Field(
        default_factory=dict,
        description="budget_month -> credit-debit difference of uncategorised rows, when above tolerance",
    )
    profile: str = Field("default", description="Name of the bank profile that parsed the file")
    archived_as: str | None = Field(
        None, description="File name the statement was copied to in _inputs/; None if it couldn't be"
    )


class InputFileResult(BaseModel):
    name: str
    account: str | None
    rows_total: int
    rows_new: int
    profile: str | None
    error: str | None = Field(None, description="Why the file was skipped (French)")
    rows_before_start: int = 0


class InputsImportResult(BaseModel):
    files: list[InputFileResult]
    rows_new: int


class ConfigExportResult(BaseModel):
    """What « Enregistrer la configuration » wrote to the config dir, and where the files it
    replaced (plus the DB) were backed up first."""

    config_dir: str
    backup_dir: str
    accounts: int
    categories: int
    rules: int
    overrides: int
    transfer_markers: int


class Transaction(BaseModel):
    id: int
    date_operation: str
    date_valeur: str
    budget_month: str
    libelle: str
    debit: float
    credit: float
    account: str
    account_id: str | None = Field(default=None, description="Canonical account code")
    kind: str = Field(description="'income' | 'expense' | 'transfer'")
    category_id: int | None
    category: str | None = Field(default=None, description="Category name, for display")
    category_manual: bool
    note: str | None = Field(default=None, description="Free-text user annotation for a manual assignment")
    rule_id: int | None = Field(default=None, description="Rule that classified this row, if any")
    rule_pattern: str | None = Field(
        default=None, description="Pattern of the matching rule, for provenance display"
    )
    transfer_group_id: int | None = Field(default=None, description="Shared by the two legs of a transfer")
    kind_manual: bool = Field(default=False, description="True when the user decided the transfer status")


class TransactionPage(BaseModel):
    items: list[Transaction]
    total: int


class TransactionPatch(BaseModel):
    # Both optional; the router uses model_fields_set to tell "omitted" from "set to null", so a
    # caller can update the category, the note, or both in one PATCH.
    category_id: int | None = None
    note: str | None = None


class TransactionsBulkPatch(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=1000)
    category_id: int | None = Field(description="Leaf category set manually on every row; null clears it")
    note: str | None = None


class CategorySuggestion(BaseModel):
    category_id: int
    count: int = Field(description="Categorised operations backing the suggestion")
    token: str | None = Field(
        description="The deciding word; null when those operations share the whole label"
    )


class TransferCandidate(BaseModel):
    transaction_id: int = Field(description="The group's operation")
    partner: Transaction = Field(description="An operation that could be its other transfer leg")


class UncategorizedGroup(BaseModel):
    key: str = Field(description="Normalised label shared by the group")
    pattern: str = Field(description="Default rule pattern, a substring of every member's label")
    pattern_generic: bool = Field(description="True when the pattern is too generic for a rule")
    count: int
    debit: float
    credit: float
    first_date: str
    last_date: str
    accounts: list[str]
    transactions: list[Transaction] = Field(description="The group's operations, newest first")
    suggestion: CategorySuggestion | None
    transfer_candidates: list[TransferCandidate] = Field(
        description="Possible other legs of the group's operations, likeliest first per operation"
    )


class TransferPairIn(BaseModel):
    transaction_ids: list[int] = Field(min_length=2, max_length=2, description="One debit and one credit")


class TransferModeIn(BaseModel):
    mode: TransferMode = Field(
        description="'transfer' = this row alone is a transfer, 'none' = not a transfer (unpair), "
        "'auto' = back to automatic detection"
    )


class TransferMarkers(BaseModel):
    markers: list[str] = Field(description="Label prefixes of a virement; empty = built-in default")


class TransferMarkersOut(TransferMarkers):
    is_default: bool = Field(description="True when no marker is configured and the default applies")


class CategoryIn(BaseModel):
    name: str = Field(min_length=1)
    parent_id: int | None = Field(default=None, description="null creates a top-level group")


class CategoryOut(BaseModel):
    id: int
    name: str
    parent_id: int | None
    path: str = Field(description="Full path for display, e.g. 'variable / sortie / bar'")
    is_root: bool = Field(description="True for top-level groups (parent_id is null)")
    rule_count: int = 0
    budget_target: float | None = Field(
        default=None,
        description="Monthly spending cap in euros (a group's covers its subtree; one per branch); null = none",
    )


class CategoryMoveIn(BaseModel):
    rule_ids: list[int] = Field(default=[], max_length=1000)
    transaction_ids: list[int] = Field(default=[], max_length=1000, description="Manual assignments only")


class CategoryTargetIn(BaseModel):
    budget_target: float | None = Field(gt=0, description="Monthly spending cap in euros; null clears it")


class Account(BaseModel):
    code: str
    label: str
    type: str = Field(description="'checking' or 'savings'")
    sort_order: int


class RuleIn(BaseModel):
    category_id: int
    pattern: str = Field(min_length=1)
    priority: int = 100
    is_income_anchor: bool = False
    description: str | None = None


class RuleOut(RuleIn):
    id: int
    operation_count: int = Field(
        default=0, description="Operations this rule classifies (manual ones excluded)"
    )
    debit: float = Field(default=0, description="Sum of those operations' debits, in euros")
    credit: float = Field(default=0, description="Sum of those operations' credits, in euros")


class RuleLoss(BaseModel):
    rule_id: int
    pattern: str
    category_id: int
    count: int = Field(description="Operations this existing rule would lose to the new one")


class RulePreview(BaseModel):
    uncategorized: int = Field(description="Uncategorised operations the new rule would classify")
    reclassified: list[RuleLoss]


class BudgetLeaf(BaseModel):
    id: int
    name: str = Field(description="A targeted category's path below the top-level group, e.g. 'Sortie / Bar'")
    target: float = Field(description="Monthly target × the number of budget months shown")
    actual: float = Field(
        description="Net spending of the category and its subtree (debits − credits, transfers excluded)"
    )


class BudgetGroup(BudgetLeaf):
    name: str = Field(description="Top-level category name")
    leaves: list[BudgetLeaf]


class BudgetSummary(BaseModel):
    months: int = Field(description="Budget months covered (targets are multiplied by it)")
    target: float
    actual: float
    untargeted: float = Field(description="Expenses (kind='expense' debits) outside any targeted category")
    groups: list[BudgetGroup] = Field(description="Top-level groups with a target, overruns first")
    savings_target: float | None = Field(
        default=None, description="Savings goal (the Épargne group's target) × the months shown"
    )
    income_reference: float = Field(
        default=0, description="Average monthly income over the last 12 complete months, net of refunds"
    )
    savings_actual: float = Field(default=0, description="Net savings of the period (épargne − désépargne)")


class AverageNode(BaseModel):
    id: int
    name: str
    expenses: float = Field(description="Average monthly spending of its net-debit leaves")
    income: float = Field(description="Average monthly income of its net-credit leaves")
    month_expenses: float | None = Field(description="The displayed month's spending (None: all months)")
    month_income: float | None
    target: float | None = Field(description="Own monthly target, else a group's Σ of its children's")
    children: list["AverageNode"]


class AverageUncategorized(BaseModel):
    expenses: float = Field(description="Average monthly uncategorised debits (gross)")
    income: float = Field(description="Average monthly uncategorised credits (gross)")
    month_expenses: float | None
    month_income: float | None


class AverageOffset(BaseModel):
    value: float = Field(description="Average refunds on spending leaves + debits on income leaves")
    month_value: float | None


class AverageSavings(BaseModel):
    account_id: str
    name: str
    epargne: float
    desepargne: float
    month_epargne: float | None
    month_desepargne: float | None


class AverageTotals(BaseModel):
    income: float
    expenses: float
    epargne: float
    desepargne: float
    reste: float


class CategoryAverages(BaseModel):
    months: int = Field(description="Complete budget months averaged (the latest one is excluded)")
    first_month: str | None
    last_month: str | None
    current_month: str | None = Field(description="The latest budget month, still filling, excluded")
    month: str | None = Field(description="The month the month_* values belong to, None for all months")
    totals: AverageTotals = Field(description="The four cards' averages (mean of the history entries)")
    groups: list[AverageNode] = Field(description="Top-level categories, largest first")
    uncategorized: AverageUncategorized
    offset: AverageOffset
    savings: list[AverageSavings]


class Dashboard(BaseModel):
    month: str | None = Field(description="The budget month shown, 'all' for every month, None if no data")
    months_available: list[str]
    income: float
    expenses: float
    epargne: float = Field(default=0.0, description="Net money set aside to savings this month")
    desepargne: float = Field(default=0.0, description="Net money pulled from savings this month")
    reste: float = Field(description="income - expenses - epargne + desepargne; == by_category total")
    by_category: dict[str, Any]
    uncategorized: dict[str, Any]
    transfers: dict[str, Any]
    history: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Per-month {month, income, expenses, epargne, desepargne, reste} oldest-first, for trend/comparison",
    )
    budget: BudgetSummary = Field(description="Spending vs the categories' budget targets")
