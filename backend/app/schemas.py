from typing import Any, Literal

from pydantic import BaseModel, Field


class ImportResult(BaseModel):
    import_id: int
    account: str
    rows_total: int
    rows_new: int
    uncategorized_count: int
    balance_warnings: dict[str, float] = Field(
        default_factory=dict,
        description="budget_month -> credit-debit difference of uncategorised rows, when above tolerance",
    )
    profile: str = Field("default", description="Name of the bank profile that parsed the file")
    archived_as: str | None = Field(
        None, description="File name the statement was copied to in _inputs/; None if it couldn't be"
    )


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


class TransferPairIn(BaseModel):
    transaction_ids: list[int] = Field(min_length=2, max_length=2, description="One debit and one credit")


class TransferModeIn(BaseModel):
    mode: Literal["transfer", "none", "auto"] = Field(
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


class Account(BaseModel):
    code: str
    label: str
    type: str = Field(description="'checking' or 'savings'")
    include_in_full_view: bool
    sort_order: int


class RuleIn(BaseModel):
    category_id: int
    pattern: str = Field(min_length=1)
    priority: int = 100
    is_income_anchor: bool = False
    description: str | None = None


class RuleOut(RuleIn):
    id: int


class Dashboard(BaseModel):
    month: str | None
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
