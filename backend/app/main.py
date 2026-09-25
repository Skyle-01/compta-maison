from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from app.api import accounts, categories, dashboard, imports, rules, transactions, transfer_markers
from app.db import DEFAULT_CONFIG_DIR, DEFAULT_DB_PATH, DEFAULT_INPUTS_DIR, init_db


def create_app(
    db_path: Path = DEFAULT_DB_PATH, config_dir: Path | None = None, inputs_dir: Path | None = None
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        init_db(db_path)
        yield

    app = FastAPI(title="compta", version="1.0.0", lifespan=lifespan)
    app.state.db_path = db_path
    # Resolved here, not as a default argument, so tests can point it at a temp dir.
    app.state.config_dir = config_dir if config_dir is not None else DEFAULT_CONFIG_DIR
    app.state.inputs_dir = inputs_dir if inputs_dir is not None else DEFAULT_INPUTS_DIR

    app.include_router(imports.router)
    app.include_router(transactions.router)
    app.include_router(categories.router)
    app.include_router(rules.router)
    app.include_router(dashboard.router)
    app.include_router(accounts.router)
    app.include_router(transfer_markers.router)
    return app


app = create_app()
