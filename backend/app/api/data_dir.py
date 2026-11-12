import os

from fastapi import APIRouter, HTTPException, Request

from app.db import DATA_DIR_VAR, data_dir_from, init_db, paths_in, set_data_dir
from app.schemas import DataDirSet, DataDirStatus

router = APIRouter(prefix="/api/data-dir", tags=["data-dir"])


def _status(request: Request) -> DataDirStatus:
    data_dir = data_dir_from(os.environ)
    return DataDirStatus(
        configured=request.app.state.db_path is not None,
        path=str(data_dir) if data_dir is not None else None,
        locked=DATA_DIR_VAR in os.environ,
        problem=request.app.state.data_dir_problem,
    )


@router.get("")
def get_data_dir(request: Request) -> DataDirStatus:
    """Whether the data folder is configured; the only route usable before it is."""
    return _status(request)


@router.put("")
def put_data_dir(body: DataDirSet, request: Request) -> DataDirStatus:
    """Choose the data folder (created if missing, remembered for the next launches) and switch the
    running app to it, no restart needed."""
    if DATA_DIR_VAR in os.environ:
        raise HTTPException(
            409, detail=f"Le dossier est fixé par la variable d'environnement {DATA_DIR_VAR} : modifiez-la."
        )
    try:
        data_dir = set_data_dir(body.path)
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc)) from exc
    paths = paths_in(data_dir, os.environ)
    init_db(paths.db)
    state = request.app.state
    state.db_path, state.config_dir, state.inputs_dir = paths.db, paths.config, paths.inputs
    state.data_dir_problem = None
    return _status(request)
