"""French messages for request-validation errors: the pages show an error's `msg` as it is, and
Pydantic writes it in English. Keyed by the error `type` (stable), never by the English text."""

from typing import Any

from fastapi import Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

# Request fields as the UI names them; any other field is shown by its API name.
FIELD_LABELS = {
    "account": "Compte",
    "budget_target": "Objectif",
    "category_id": "Catégorie",
    "description": "Description",
    "file": "Fichier",
    "is_income_anchor": "Ancre de revenu",
    "markers": "Marqueurs",
    "mode": "Mode",
    "month": "Mois",
    "name": "Nom",
    "note": "Note",
    "parent_id": "Catégorie parente",
    "pattern": "Motif",
    "priority": "Priorité",
    "transaction_ids": "Opérations",
}

_MESSAGES = {
    "missing": "champ obligatoire",
    "greater_than": "la valeur doit être supérieure à {gt}",
    "greater_than_equal": "la valeur doit être supérieure ou égale à {ge}",
    "less_than": "la valeur doit être inférieure à {lt}",
    "less_than_equal": "la valeur doit être inférieure ou égale à {le}",
    "int_type": "un nombre entier est attendu",
    "int_parsing": "un nombre entier est attendu",
    "int_from_float": "un nombre entier est attendu",
    "float_type": "un nombre est attendu",
    "float_parsing": "un nombre est attendu",
    "finite_number": "un nombre est attendu",
    "bool_type": "vrai ou faux est attendu",
    "bool_parsing": "vrai ou faux est attendu",
    "string_type": "un texte est attendu",
    "string_too_short": "{min_length} caractère(s) au minimum",
    "string_too_long": "{max_length} caractère(s) au maximum",
    "too_short": "{min_length} élément(s) au minimum",
    "too_long": "{max_length} élément(s) au maximum",
    "list_type": "une liste est attendue",
    "literal_error": "valeur attendue : {expected}",
    "enum": "valeur attendue : {expected}",
    "dict_type": "un objet JSON est attendu",
    "model_attributes_type": "un objet JSON est attendu",
    "json_invalid": "requête illisible (JSON invalide)",
}


def _format(value: Any) -> str:
    """A constraint as the UI writes it: 0.0 -> '0', 0.5 -> '0,5'; "'a', 'b' or 'c'" -> '… ou …'."""
    if isinstance(value, float):
        return f"{value:g}".replace(".", ",")
    return str(value).replace(" or ", " ou ")


def french_message(error: dict[str, Any]) -> str:
    """'<Field> : <message>' for one Pydantic error, or the bare message when no field is named."""
    ctx = {key: _format(value) for key, value in (error.get("ctx") or {}).items()}
    if error["type"] == "string_too_short" and ctx.get("min_length") == "1":
        message = "ne peut pas être vide"
    else:
        try:
            message = _MESSAGES.get(error["type"], "valeur invalide").format_map(ctx)
        except KeyError:  # a constraint missing from ctx
            message = "valeur invalide"
    # loc = (where, field, …): the last name in it, e.g. ('body', 'markers', 0) -> 'markers'.
    names = [part for part in error.get("loc", ())[1:] if isinstance(part, str)]
    if not names:
        return message[0].upper() + message[1:]
    return f"{FIELD_LABELS.get(names[-1], names[-1])} : {message}"


async def french_validation_errors(request: Request, exc: RequestValidationError) -> JSONResponse:
    """FastAPI's 422 response, same shape, with each error's `msg` in French."""
    errors = [{**error, "msg": french_message(error)} for error in exc.errors()]
    translated = RequestValidationError(errors, body=exc.body, endpoint_ctx=exc.endpoint_ctx)
    return await request_validation_exception_handler(request, translated)
