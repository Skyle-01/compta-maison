import shutil
from pathlib import Path

from app.core.config_export import export_config

SAMPLE_CSV = (
    b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
    b'"05/06/2026";"05/06/2026";"VIR EMPLOYEUR SALAIRE";"";"2500,00"\n'
    b'"06/06/2026";"06/06/2026";"CARTE SUPERMARCHE";"63,82";""\n'
    b'"07/06/2026";"07/06/2026";"BAR ANGELUS";"12,00";""\n'
    b'"08/06/2026";"08/06/2026";"MYSTERY SHOP";"10,00";""\n'
)


# A statement in the format of the example profile (data/bank_profiles.toml).
EXAMPLE_PROFILES = Path(__file__).resolve().parents[2] / "data" / "bank_profiles.toml"


PROFILE_FILENAME = "export_COMPTE_PERSO_20260601.csv"


PROFILE_CSV = (
    'Date,Libellé,Montant\n2026-06-01,CARTE BOULANGERIE,-4.20\n2026-06-02,VIR EMPLOYEUR SALAIRE,"2,500.00"\n'
).encode()


def _export(db_path, tmp_path) -> Path:
    """The config CSVs of `db_path` (core.config_export, as the Réglages save writes them)."""
    out = tmp_path / "cfg"
    export_config(db_path, out)
    return out


def _upload(client, filename="RELEVE_COMPTE_JOINT_2026_06_08.csv", account="", content=SAMPLE_CSV):
    return client.post(
        "/api/imports",
        files={"file": (filename, content, "text/csv")},
        data={"account": account},
    )


def _write_profiles(tmp_path) -> Path:
    """Install the example bank profiles in the test's config dir (tmp_path/_config)."""
    config = tmp_path / "_config"
    config.mkdir(exist_ok=True)
    shutil.copy(EXAMPLE_PROFILES, config / "bank_profiles.toml")
    return config


def _write_start_date(tmp_path, start_date: str) -> None:
    """Open the books at `start_date` in the test's config dir (tmp_path/_config)."""
    config = tmp_path / "_config"
    config.mkdir(exist_ok=True)
    (config / "settings.toml").write_text(f"start_date = {start_date}\n", encoding="utf-8")


def _category_id(client, name: str) -> int:
    return next(c["id"] for c in client.get("/api/categories").json() if c["name"] == name)


TRANSFER_PERSO = (
    b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
    b'"10/06/2026";"10/06/2026";"VIR vers COMPTE JOINT";"100,00";""\n'
    b'"12/06/2026";"12/06/2026";"CARTE 12/06 SUPERMARCHE";"50,00";""\n'
)


TRANSFER_JOINT = (
    b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
    b'"10/06/2026";"10/06/2026";"VIR de COMPTE PERSO";"";"100,00"\n'
    b'"13/06/2026";"13/06/2026";"VIR SEPA RECU /DE AMI";"";"50,00"\n'
)


def _upload_transfers(client) -> dict[str, dict]:
    client.post("/api/imports", files={"file": ("RELEVE_COMPTE_PERSO_2026.csv", TRANSFER_PERSO, "text/csv")})
    client.post("/api/imports", files={"file": ("RELEVE_COMPTE_JOINT_2026.csv", TRANSFER_JOINT, "text/csv")})
    return {t["libelle"]: t for t in client.get("/api/transactions").json()["items"]}
