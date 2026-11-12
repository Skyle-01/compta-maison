from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import (
    accounts,
    categories,
    config,
    dashboard,
    data_dir,
    imports,
    rules,
    transactions,
    transfer_markers,
)
from app.api.errors import french_http_errors, french_validation_errors
from app.db import init_db, locate_paths


def create_app(
    db_path: Path | None = None, config_dir: Path | None = None, inputs_dir: Path | None = None
) -> FastAPI:
    """The app on a data folder. `db_path` None = the data folder is not configured yet: only the
    data-dir routes answer until the UI sets it. config_dir and inputs_dir default to the DB's
    neighbours (the layout of a data folder), which is where tests put theirs."""

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if app.state.db_path is not None:
            init_db(app.state.db_path)
        yield

    app = FastAPI(title="compta", version="1.0.0", lifespan=lifespan)
    app.state.db_path = db_path
    app.state.config_dir = (
        config_dir if config_dir is not None or db_path is None else db_path.parent / "config"
    )
    app.state.inputs_dir = (
        inputs_dir if inputs_dir is not None or db_path is None else db_path.parent / "inputs"
    )
    # Why a configured data folder cannot be used (missing folder), shown by the data-dir routes.
    app.state.data_dir_problem = None
    app.add_exception_handler(RequestValidationError, french_validation_errors)
    app.add_exception_handler(StarletteHTTPException, french_http_errors)

    app.include_router(data_dir.router)
    app.include_router(imports.router)
    app.include_router(transactions.router)
    app.include_router(categories.router)
    app.include_router(rules.router)
    app.include_router(dashboard.router)
    app.include_router(accounts.router)
    app.include_router(transfer_markers.router)
    app.include_router(config.router)
    return app


def create_default_app() -> FastAPI:
    """The server's app: paths from COMPTA_DATA_DIR / the folder chosen in the UI / the override variables."""
    paths, problem = locate_paths()
    app = create_app(paths.db, paths.config, paths.inputs) if paths else create_app()
    app.state.data_dir_problem = problem
    return app


app = create_default_app()
