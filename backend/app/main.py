from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import accounts, categories, dashboard, imports, rules, transactions
from app.db import DEFAULT_DB_PATH, init_db


def create_app(db_path: Path = DEFAULT_DB_PATH) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        init_db(db_path)
        yield

    app = FastAPI(title="compta", version="1.0.0", lifespan=lifespan)
    app.state.db_path = db_path

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(imports.router)
    app.include_router(transactions.router)
    app.include_router(categories.router)
    app.include_router(rules.router)
    app.include_router(dashboard.router)
    app.include_router(accounts.router)
    return app


app = create_app()
