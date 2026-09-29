"""Boot-time configuration for the engine (spec §5). Mirrors the subset of apps/api/src/config.ts
that the engine itself needs; the API is the source of truth for everything else."""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    app_env: str = Field(default="local", alias="APP_ENV")
    engine_token: str = Field(alias="ENGINE_TOKEN")

    # Storage (Supabase Storage via its S3-compatible endpoint — spec §4.2, ADR-001). The engine
    # never talks to Postgres directly (ADR-004); it only reads/writes files.
    storage_endpoint: str = Field(alias="STORAGE_ENDPOINT")
    storage_region: str = Field(alias="STORAGE_REGION")
    storage_access_key: str = Field(alias="STORAGE_ACCESS_KEY")
    storage_secret_key: str = Field(alias="STORAGE_SECRET_KEY")

    model_provider: str = Field(default="anthropic", alias="MODEL_PROVIDER")  # anthropic | openai | none
    model_name: str = Field(default="", alias="MODEL_NAME")
    model_provider_key: str = Field(default="", alias="MODEL_PROVIDER_KEY")
    llm_allow_bidder_docs: bool = Field(default=False, alias="LLM_ALLOW_BIDDER_DOCS")

    simulated_adapter_enabled: bool = Field(default=False, alias="SIMULATED_ADAPTER_ENABLED")

    def validate_production(self) -> None:
        """Boot-time guard (spec §2 rule 2, §25.2): never allow simulated results in production."""
        if self.app_env == "production" and self.simulated_adapter_enabled:
            raise RuntimeError("SIMULATED_ADAPTER_ENABLED must be false when APP_ENV=production")


settings = Settings()  # type: ignore[call-arg]  # values come from the environment, not kwargs
settings.validate_production()
