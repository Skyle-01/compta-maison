from pathlib import Path

from fastapi import APIRouter, Depends

from app.api.deps import get_db_path
from app.core.transfers import effective_markers, recompute_transfers
from app.db import connect, get_transfer_markers, replace_transfer_markers
from app.schemas import TransferMarkers, TransferMarkersOut

router = APIRouter(prefix="/api/transfer-markers", tags=["transfers"])


def _current(db_path: Path) -> TransferMarkersOut:
    with connect(db_path) as conn:
        return TransferMarkersOut(markers=effective_markers(conn), is_default=not get_transfer_markers(conn))


@router.get("", response_model=TransferMarkersOut)
def list_markers(db_path: Path = Depends(get_db_path)) -> TransferMarkersOut:
    return _current(db_path)


@router.put("", response_model=TransferMarkersOut)
def update_markers(body: TransferMarkers, db_path: Path = Depends(get_db_path)) -> TransferMarkersOut:
    """Replace the markers (an empty list restores the built-in default) and re-pair transfers."""
    with connect(db_path) as conn:
        replace_transfer_markers(conn, body.markers)
    recompute_transfers(db_path)
    return _current(db_path)
