from pathlib import Path

from fastapi import Request


def get_db_path(request: Request) -> Path:
    return request.app.state.db_path
