"""Provider-agnostic LLM client (spec §0.4, §11.2): MODEL_PROVIDER = anthropic | openai | none.
Not an HTTP router — an internal interface the rules package calls into (Phase 2). If the provider
is "none" or no key is configured, callers must fall back to the manual rule builder and show
"AI interpretation unavailable" (spec §11.2) rather than failing or fabricating a result."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from engine.config import settings


@dataclass(frozen=True)
class LlmCompletion:
    text: str
    provider: str
    model: str
    latency_ms: int


class LlmProvider(ABC):
    @abstractmethod
    async def complete(self, *, system: str, prompt: str) -> LlmCompletion: ...


class NullLlmProvider(LlmProvider):
    """Used when MODEL_PROVIDER=none or no key is configured — never fabricates a completion.
    Callers (engine.rules.compiler) must treat this as "AI interpretation unavailable" (spec
    §11.2) and route to the manual rule builder, not as an error to retry."""

    async def complete(self, *, system: str, prompt: str) -> LlmCompletion:
        raise RuntimeError("No LLM provider is configured (MODEL_PROVIDER=none or missing key).")


class AnthropicProvider(LlmProvider):
    def __init__(self, api_key: str, model: str):
        import anthropic

        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._model = model

    async def complete(self, *, system: str, prompt: str) -> LlmCompletion:
        import time

        start = time.monotonic()
        response = await self._client.messages.create(
            model=self._model,
            max_tokens=2048,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        latency_ms = int((time.monotonic() - start) * 1000)
        text = "".join(block.text for block in response.content if block.type == "text")
        return LlmCompletion(text=text, provider="anthropic", model=self._model, latency_ms=latency_ms)


def get_llm_provider() -> LlmProvider:
    if settings.model_provider == "none" or not settings.model_provider_key:
        return NullLlmProvider()
    if settings.model_provider == "anthropic":
        model = settings.model_name or "claude-sonnet-5"
        return AnthropicProvider(api_key=settings.model_provider_key, model=model)
    raise NotImplementedError(f"LLM provider '{settings.model_provider}' client is not wired yet.")
