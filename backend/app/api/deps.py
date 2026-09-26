from pathlib import Path
from typing import Annotated

from fastapi import Depends, Request


def get_db_path(request: Request) -> Path:
    return request.app.state.db_path


def get_config_dir(request: Request) -> Path:
    return request.app.state.config_dir


def get_inputs_dir(request: Request) -> Path:
    return request.app.state.inputs_dir


# Route parameter types: `db_path: DbPath` injects the app's paths (set by create_app).
DbPath = Annotated[Path, Depends(get_db_path)]
ConfigDir = Annotated[Path, Depends(get_config_dir)]
InputsDir = Annotated[Path, Depends(get_inputs_dir)]
