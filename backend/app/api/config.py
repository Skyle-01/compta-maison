from fastapi import APIRouter, HTTPException

from app.api.deps import ConfigDir, DbPath
from app.core.config_export import save_config
from app.schemas import ConfigExportResult

router = APIRouter(prefix="/api/config", tags=["config"])


@router.post("/export")
def export_config_dir(db_path: DbPath, config_dir: ConfigDir) -> ConfigExportResult:
    """Regenerate the config dir's CSVs from the DB (for reset_db.py --source defaults), after
    backing up the files it replaces and the DB to _backups/<ts>/."""
    try:
        saved = save_config(db_path, config_dir)
    except OSError as exc:  # e.g. a CSV open in Excel on Windows (os.replace names it filename2)
        raise HTTPException(
            500,
            detail=[
                f"Impossible d’écrire {exc.filename2 or exc.filename or config_dir} : {exc.strerror or exc}"
            ],
        ) from exc
    counts = saved.counts
    return ConfigExportResult(
        config_dir=str(config_dir),
        backup_dir=str(saved.backup_dir),
        accounts=counts.accounts,
        categories=counts.categories,
        rules=counts.rules,
        overrides=counts.overrides,
        transfer_markers=counts.transfer_markers,
    )
