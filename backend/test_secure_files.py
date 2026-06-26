"""M5 — secrets-at-rest permissions. harden() is best-effort and must never raise."""

import secure_files


def test_harden_runs_without_raising():
    secure_files.harden()  # idempotent, best-effort; must never throw, on any platform


def test_restrict_missing_path_is_noop(tmp_path):
    secure_files._restrict(tmp_path / "nope.json", is_dir=False)  # no error when the path is absent
