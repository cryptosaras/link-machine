from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.router import router as auth_router
from app.routers.websites import router as websites_router
from app.routers.workers import router as workers_router
from app.routers.worker_agent import router as worker_agent_router
from app.routers.settings import router as settings_router
from app.routers.ws import router as ws_router
from app.routers.tasks import router as tasks_router


def create_app() -> FastAPI:
    app = FastAPI(title="Link Machine", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth_router)
    app.include_router(websites_router)
    app.include_router(workers_router)
    app.include_router(worker_agent_router)
    app.include_router(settings_router)
    app.include_router(ws_router)
    app.include_router(tasks_router)

    @app.get("/api/health")
    async def health():
        return {"status": "ok"}

    return app


app = create_app()
