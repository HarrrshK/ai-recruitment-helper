from pydantic import BaseModel, Field
from typing import Literal
import hashlib
import threading
from app.config import Settings
from app.models import RuntimeConfig

PROVIDERS = {"groq": ("https://api.groq.com/openai/v1", "GROQ_API_KEY"), "openai": ("https://api.openai.com/v1", "OPENAI_API_KEY"), "anthropic": ("https://api.anthropic.com/v1", "ANTHROPIC_API_KEY"), "ollama": ("http://127.0.0.1:11434/v1", "")}


class ModelConfig(BaseModel):
    provider: Literal["groq", "openai", "anthropic", "ollama"]
    large_model: str = Field(min_length=1, max_length=150)
    small_model: str = Field(min_length=1, max_length=150)
    cost_per_million: float | None = Field(default=None, ge=0, le=10000)


class RoutingConfig(BaseModel):
    primary: ModelConfig
    fallback: ModelConfig | None = None
    revision: int = Field(default=0, ge=0)


def provider_settings(config: ModelConfig):
    import os
    from dotenv import dotenv_values
    from app.config import ROOT_DIR
    env = {**dotenv_values(ROOT_DIR / ".env"), **os.environ}
    base, key_name = PROVIDERS[config.provider]
    key = env.get(key_name) or (env.get("LLM_API_KEY") if config.provider == "groq" else "")
    if config.provider == "ollama":
        base, key = env.get("OLLAMA_BASE_URL", base), "ollama"
    return Settings(llm_api_key=key or "", llm_base_url=base, llm_model_large=config.large_model, llm_model_small=config.small_model)


class RuntimeLLM:
    """Read routing on each operation; never change a client's provider mid-call."""
    def __init__(self, session_factory):
        self.session_factory = session_factory
        self._pool = {}
        self._lock = threading.Lock()

    def _clients(self):
        from app.llm.client import LLMClient
        with self.session_factory() as db:
            row = db.get(RuntimeConfig, "llm")
            config = RoutingConfig(**row.value) if row else None
        if not config:
            with self._lock:
                if "default" not in self._pool:
                    self._pool["default"] = LLMClient(session_factory=self.session_factory)
                return [self._pool["default"]]
        clients = []
        for model in [config.primary, config.fallback]:
            if model:
                settings = provider_settings(model)
                key = hashlib.sha256((model.model_dump_json() + settings.llm_api_key + settings.llm_base_url).encode()).hexdigest()
                with self._lock:
                    client = self._pool.get(key)
                    if client is None:
                        client = LLMClient(settings=settings, session_factory=self.session_factory)
                        client.provider = model.provider
                        client.cost_per_million = model.cost_per_million
                        if len(self._pool) > 8:
                            self._pool.clear()
                        self._pool[key] = client
                clients.append(client)
        return clients

    def _call(self, method, *args, **kwargs):
        from app.llm.client import LLMError
        error = None
        for index, client in enumerate(self._clients()):
            try:
                options = {k: v for k, v in kwargs.items() if index == 0 or k != "model"}
                return getattr(client, method)(*args, **options)
            except LLMError as exc:
                error = exc
        raise error

    def chat(self, *args, **kwargs):
        return self._call("chat", *args, **kwargs)

    def chat_json(self, *args, **kwargs):
        return self._call("chat_json", *args, **kwargs)

    def stream(self, *args, **kwargs):
        from app.llm.client import LLMError
        error = None
        for index, client in enumerate(self._clients()):
            emitted = False
            try:
                options = {k: v for k, v in kwargs.items() if index == 0 or k != "model"}
                for part in client.stream(*args, **options):
                    emitted = True
                    yield part
                return
            except LLMError as exc:
                if emitted:
                    raise
                error = exc
        raise error
