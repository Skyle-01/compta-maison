from pathlib import Path

from fastapi import Request


def get_db_path(request: Request) -> Path:
    return request.app.state.db_path


def get_config_dir(request: Request) -> Path:
    return request.app.state.config_dir


def get_inputs_dir(request: Request) -> Path:
    return request.app.state.inputs_dir
