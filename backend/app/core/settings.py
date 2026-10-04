"""Optional `settings.toml` in the config dir (see data/settings.toml for a commented example).

`start_date`: the day the books open. Statement rows valued before it are never imported, so years
of history nobody will categorise stay in the _inputs/ archive, out of the database. Moving it
takes a rebuild (reset_db.py): rows already imported are not deleted.
"""

import tomllib
from datetime import date
from pathlib import Path

SETTINGS_FILENAME = "settings.toml"


class SettingsError(ValueError):
    """settings.toml is unreadable or holds an invalid value (French message: the Import page shows it)."""


def load_start_date(config_dir: Path) -> date | None:
    """The configured start date, or None without settings.toml or without the key. Read on every
    call, like bank_profiles.toml, so edits apply without restarting the server."""
    path = config_dir / SETTINGS_FILENAME
    if not path.exists():
        return None
    try:
        settings = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise SettingsError(f"TOML illisible : {exc}") from exc
    value = settings.get("start_date")
    if value is None:
        return None
    if type(value) is not date:  # a TOML datetime is a date subclass: reject it too
        raise SettingsError(f"start_date doit être une date (ex. 2024-12-24), pas « {value} »")
    return value
