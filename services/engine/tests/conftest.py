import os

# Must be set before engine.config is imported by any test.
os.environ.setdefault("APP_ENV", "local")
os.environ.setdefault("ENGINE_TOKEN", "test-engine-token-at-least-16-chars")
os.environ.setdefault("STORAGE_ENDPOINT", "http://localhost:54321/storage/v1/s3")
os.environ.setdefault("STORAGE_REGION", "local")
os.environ.setdefault("STORAGE_ACCESS_KEY", "test")
os.environ.setdefault("STORAGE_SECRET_KEY", "test")

import pytest
from fastapi.testclient import TestClient

from engine.main import create_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app())


@pytest.fixture()
def auth_headers() -> dict:
    return {"X-Engine-Token": os.environ["ENGINE_TOKEN"]}
