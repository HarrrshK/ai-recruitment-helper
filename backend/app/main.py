from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.auth import require_legacy_recruiter
from app.db import get_db, init_db
from app.llm.client import LLMError
from app.routers import (
    agents, auth, ask, candidates, coach, dashboard, dev, evaluation, interviews, jobs, outreach, panel, portal, qa, recruiter, reports, screening,
)
from app.routers import dev_admin
from app.services import admin_operations


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    from app.db import SessionLocal
    from app.services.dev_tasks import recover_interrupted_tasks
    recover_interrupted_tasks(SessionLocal)
    from app.models import RuntimeConfig
    with SessionLocal() as db:
        setting = db.get(RuntimeConfig, "maintenance")
        admin_operations.maintenance = bool(setting and setting.value.get("enabled"))
    yield


app = FastAPI(title="AI HR Recruitment System", lifespan=lifespan)


@app.middleware("http")
async def private_api_responses(request: Request, call_next):
    admitted = admin_operations.enter(request.url.path)
    if admitted is None:
        return JSONResponse(status_code=503, content={"detail": "Workspace maintenance is in progress. Please try again shortly."}, headers={"Retry-After": "30", "Cache-Control": "no-store"})
    try:
        response = await call_next(request)
    finally:
        if admitted:
            admin_operations.leave()
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response

@app.exception_handler(LLMError)
async def llm_error_handler(_: Request, exc: LLMError) -> JSONResponse:
    return JSONResponse(status_code=502, content={"detail": str(exc)})


app.include_router(auth.router)
app.include_router(portal.router)
app.include_router(recruiter.router)
app.include_router(dev.router)
app.include_router(dev_admin.router)
for hr_router in (jobs.router, candidates.router, screening.router, panel.router,
                  interviews.router, qa.router, outreach.router, ask.router, coach.router,
                  agents.router, dashboard.router, evaluation.router, reports.router):
    app.include_router(hr_router, dependencies=[Depends(require_legacy_recruiter)])

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    """Reports config and DB status. Does not call the LLM (that would spend quota)."""
    settings = get_settings()
    db.execute(text("SELECT 1"))
    return {
        "status": "ok",
        "database": "ok",
        "llm": {
            "base_url": settings.llm_base_url,
            "model_large": settings.llm_model_large,
            "model_small": settings.llm_model_small,
            "api_key_configured": bool(settings.llm_api_key),
        },
    }
