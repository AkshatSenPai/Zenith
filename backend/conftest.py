"""Shared pytest fixtures for the backend suite.

The API-token gate (``auth.require_token``) reads ``ZENITH_API_TOKEN`` from the environment on every
request. A real ``backend/.env`` (loaded via ``load_dotenv`` at import) may set it, which would make
the existing header-less route tests fail with 401. Keep the suite hermetic by unsetting it for every
test; tests that exercise the *enforced* path opt back in with ``monkeypatch.setenv``.
"""

import pytest


@pytest.fixture(autouse=True)
def _no_ambient_api_token(monkeypatch):
    monkeypatch.delenv("ZENITH_API_TOKEN", raising=False)
