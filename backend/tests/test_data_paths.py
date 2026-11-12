from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
from app.db import NOT_CONFIGURED, DataPaths, locate_paths, set_data_dir
from app.main import create_app
from tests.conftest import make_db


class TestLocatePaths:
    def test_nothing_configured(self):
        assert locate_paths({}) == (None, None)

    def test_env_variable_sets_the_three_paths(self, tmp_path):
        paths, problem = locate_paths({"COMPTA_DATA_DIR": str(tmp_path)})
        assert problem is None
        assert paths == DataPaths(tmp_path / "compta.db", tmp_path / "config", tmp_path / "inputs")

    def test_folder_chosen_in_the_ui_is_used(self, tmp_path):
        set_data_dir(str(tmp_path / "chosen"))
        paths, _ = locate_paths({})
        assert paths == DataPaths(
            tmp_path / "chosen" / "compta.db", tmp_path / "chosen" / "config", tmp_path / "chosen" / "inputs"
        )

    def test_env_variable_wins_over_the_folder_chosen_in_the_ui(self, tmp_path):
        set_data_dir(str(tmp_path / "chosen"))
        paths, _ = locate_paths({"COMPTA_DATA_DIR": str(tmp_path)})
        assert paths is not None and paths.db == tmp_path / "compta.db"

    def test_specific_variable_overrides_one_path(self, tmp_path):
        env = {"COMPTA_DATA_DIR": str(tmp_path), "COMPTA_DB": "elsewhere/demo.db"}
        paths, _ = locate_paths(env)
        assert paths is not None
        assert paths.db == Path("elsewhere/demo.db")
        assert paths.config == tmp_path / "config"

    def test_the_three_variables_work_without_a_data_folder(self, tmp_path):
        env = {"COMPTA_DB": "a.db", "COMPTA_CONFIG_DIR": "c", "COMPTA_INPUTS_DIR": "i"}
        assert locate_paths(env) == (DataPaths(Path("a.db"), Path("c"), Path("i")), None)

    def test_one_variable_alone_is_not_enough(self):
        assert locate_paths({"COMPTA_DB": "a.db"}) == (None, None)

    def test_missing_data_folder_is_reported_in_french(self, tmp_path):
        paths, problem = locate_paths({"COMPTA_DATA_DIR": str(tmp_path / "absent")})
        assert paths is None
        assert problem is not None and "n'existe pas" in problem


class TestSetDataDir:
    def test_creates_the_folder_and_remembers_it(self, tmp_path):
        target = tmp_path / "new" / "data"
        assert set_data_dir(f' "{target}" ') == target
        assert target.is_dir()
        assert db.pointer_file().read_text(encoding="utf-8") == str(target)

    def test_relative_path_is_refused(self):
        with pytest.raises(ValueError, match="absolu"):
            set_data_dir("data")

    def test_a_file_is_refused(self, tmp_path):
        (tmp_path / "file.txt").write_text("x")
        with pytest.raises(ValueError, match="n'est pas un dossier"):
            set_data_dir(str(tmp_path / "file.txt"))


class TestDataDirApi:
    def test_unconfigured_app_answers_409_except_for_the_data_dir_route(self):
        with TestClient(create_app()) as client:
            status = client.get("/api/data-dir").json()
            assert status == {"configured": False, "path": None, "locked": False, "problem": None}
            response = client.get("/api/accounts")
            assert response.status_code == 409
            assert response.json()["detail"] == NOT_CONFIGURED

    def test_choosing_a_folder_configures_the_running_app(self, tmp_path):
        target = tmp_path / "chosen"
        with TestClient(create_app()) as client:
            response = client.put("/api/data-dir", json={"path": str(target)})
            assert response.status_code == 200
            assert response.json()["configured"] is True
            assert response.json()["path"] == str(target)
            assert (target / "compta.db").exists()
            assert client.get("/api/accounts").status_code == 200
            assert client.app.state.config_dir == target / "config"

    def test_a_bad_path_is_a_422_in_french(self):
        with TestClient(create_app()) as client:
            response = client.put("/api/data-dir", json={"path": "relative/dir"})
            assert response.status_code == 422
            assert "absolu" in response.json()["detail"]
            assert client.get("/api/data-dir").json()["configured"] is False

    def test_the_variable_locks_the_folder(self, tmp_path, monkeypatch):
        monkeypatch.setenv("COMPTA_DATA_DIR", str(tmp_path))
        with TestClient(create_app(make_db(tmp_path / "compta.db"))) as client:
            assert client.get("/api/data-dir").json()["locked"] is True
            response = client.put("/api/data-dir", json={"path": str(tmp_path / "other")})
            assert response.status_code == 409
            assert "COMPTA_DATA_DIR" in response.json()["detail"]
