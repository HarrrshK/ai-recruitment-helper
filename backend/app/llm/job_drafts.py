"""Ollama-only routing for job drafts, without changing other agents' routing."""
from urllib.parse import urlparse
import httpx

from fastapi import HTTPException

from app.config import Settings
from app.llm.client import LLMClient
from app.llm.runtime import ModelConfig, RoutingConfig, provider_settings
from app.models import RuntimeConfig


def configured_draft_client(session_factory, provider="configured"):
    from app.llm.runtime import RuntimeLLM
    if provider == "configured":
        return RuntimeLLM(session_factory)
    settings = Settings()
    with session_factory() as db:
        row = db.get(RuntimeConfig, "llm")
        routing = RoutingConfig.model_validate(row.value) if row else None
    model = next((item for item in (routing.primary, routing.fallback) if item and item.provider == "groq"), None) if routing else None
    model = model or ModelConfig(provider="groq", large_model=settings.llm_model_large, small_model=settings.llm_model_small)
    selected = provider_settings(model)
    if not selected.llm_api_key:
        raise HTTPException(503, "Groq credentials are not configured. Ask a platform administrator to configure Groq.")
    return LLMClient(settings=selected, session_factory=session_factory)


def job_draft_client(session_factory) -> LLMClient:
    settings = Settings()
    with session_factory() as db:
        row = db.get(RuntimeConfig, "llm")
        routing = RoutingConfig.model_validate(row.value) if row else None
    model = next((item for item in (routing.primary, routing.fallback)
                  if item and item.provider == "ollama"), None) if routing else None
    if settings.ollama_model.strip():
        model = ModelConfig(provider="ollama", large_model=settings.ollama_model,
                            small_model=settings.ollama_model)
    if model:
        selected = provider_settings(model)
    elif urlparse(settings.llm_base_url).port == 11434:
        # Preserve the documented .env-only Ollama configuration.
        selected = settings.model_copy(update={"llm_api_key": "ollama"})
    else:
        # A single installed local model is unambiguous; never fall back to a cloud provider.
        try:
            base = settings.ollama_base_url.rstrip("/").removesuffix("/v1")
            response = httpx.get(f"{base}/api/tags", timeout=5)
            response.raise_for_status()
            models = response.json().get("models", [])
            names = [item["name"] for item in models if isinstance(item.get("name"), str) and
                     (not item.get("capabilities") or "completion" in item["capabilities"])]
        except (httpx.HTTPError, ValueError, TypeError, KeyError, AttributeError) as exc:
            raise HTTPException(503, "Ollama is unavailable. Start the local service or configure it in Platform LLM settings. Your draft inputs are preserved.") from exc
        if len(names) != 1:
            raise HTTPException(503, "Select an installed Ollama model in Platform LLM settings or OLLAMA_MODEL. Your draft inputs are preserved.")
        selected = settings.model_copy(update={"llm_base_url": f"{base}/v1", "llm_api_key": "ollama",
                                              "llm_model_small": names[0], "llm_model_large": names[0]})
    selected = selected.model_copy(update={"llm_max_attempts": 2,
                                           "llm_timeout_seconds": max(120, selected.llm_timeout_seconds)})
    client = LLMClient(settings=selected, session_factory=session_factory)
    client.provider = "ollama"
    client.cost_per_million = 0
    return client
