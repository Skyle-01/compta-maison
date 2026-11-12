from pathlib import Path
from typing import Annotated

from fastapi import Depends, HTTPException, Query, Request

from app.db import NOT_CONFIGURED


def _configured(path: Path | None) -> Path:
    """A path of the data folder; 409 while the folder is not configured (see api/data_dir.py)."""
    if path is None:
        raise HTTPException(status_code=409, detail=NOT_CONFIGURED)
    return path


def get_db_path(request: Request) -> Path:
    return _configured(request.app.state.db_path)


def get_config_dir(request: Request) -> Path:
    return _configured(request.app.state.config_dir)


def get_inputs_dir(request: Request) -> Path:
    return _configured(request.app.state.inputs_dir)


# Route parameter types: `db_path: DbPath` injects the app's paths (set by create_app).
DbPath = Annotated[Path, Depends(get_db_path)]
ConfigDir = Annotated[Path, Depends(get_config_dir)]
InputsDir = Annotated[Path, Depends(get_inputs_dir)]
# The `?account=` filter of the transaction lists and triage: a canonical account code, none = every account.
AccountFilter = Annotated[str | None, Query(description="Canonical account code; none = every account")]
