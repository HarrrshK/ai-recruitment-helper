"""Ollama-only routing for job drafts, without changing other agents' routing."""
from urllib.parse import urlparse

from fastapi import HTTPException

from app.config import Settings
from app.llm.client import LLMClient
from app.llm.runtime import ModelConfig, RoutingConfig, provider_settings
from app.models import RuntimeConfig


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
        raise HTTPException(503, "Job drafting needs Ollama. Ask an administrator to configure an Ollama model; manual creation is still available.")
    selected = selected.model_copy(update={"llm_max_attempts": 2})
    client = LLMClient(settings=selected, session_factory=session_factory)
    client.provider = "ollama"
    client.cost_per_million = 0
    return client
