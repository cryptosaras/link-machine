import json
from datetime import datetime, timedelta, timezone

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel as PydanticBaseModel
from sqlalchemy import select, and_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.task import ScrapedLink, Task
from app.models.website import Website
from app.models.worker import Worker
from app.schemas.worker import HeartbeatRequest, HeartbeatResponse
from app.services.worker_version import get_expected_worker_hash

router = APIRouter(prefix="/api/worker-agent", tags=["worker-agent"])

STALE_TASK_TIMEOUT = timedelta(minutes=3)


@router.post("/heartbeat", response_model=HeartbeatResponse)
async def heartbeat(
    body: HeartbeatRequest,
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    api_key = authorization[7:]
    result = await db.execute(select(Worker).where(Worker.api_key == api_key))
    worker = result.scalar_one_or_none()
    if not worker:
        raise HTTPException(status_code=401, detail="Invalid API key")

    worker.last_heartbeat = datetime.now(timezone.utc)
    worker.status = "online"
    worker.system_stats = body.system_stats
    worker.code_hash = body.code_hash
    expected_hash = get_expected_worker_hash()
    worker.needs_update = (
        bool(expected_hash) and body.code_hash != expected_hash
        if body.code_hash else bool(expected_hash)
    )

    assigned_task = None

    # --- Recover stuck tasks from dead workers ---
    try:
        cutoff = datetime.now(timezone.utc) - STALE_TASK_TIMEOUT
        stale_result = await db.execute(
            select(Task)
            .where(
                and_(
                    Task.status == "running",
                    Task.worker_id.isnot(None),
                    Task.started_at < cutoff,
                )
            )
            .with_for_update(skip_locked=True)
        )
        for stale_task in stale_result.scalars().all():
            # Check if the assigned worker is actually dead
            stale_worker = await db.get(Worker, stale_task.worker_id)
            if stale_worker and stale_worker.last_heartbeat and stale_worker.last_heartbeat < cutoff:
                stale_task.status = "pending"
                stale_task.worker_id = None
                stale_task.started_at = None
                stale_task.progress = {}
    except Exception:
        pass  # Don't let recovery crash the heartbeat

    if body.current_task_id is None:
        task_result = await db.execute(
            select(Task)
            .where(Task.status == "pending")
            .order_by(Task.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        task = task_result.scalar_one_or_none()
        if task:
            task.status = "running"
            task.worker_id = worker.id
            task.started_at = datetime.now(timezone.utc)

            website_url = None
            website_sitemap_url = None
            if task.website_id:
                website = await db.get(Website, task.website_id)
                if website:
                    website_url = website.url
                    website_sitemap_url = website.sitemap_url

            assigned_task = {
                "id": str(task.id),
                "task_type": task.task_type,
                "params": task.params,
                "website_url": website_url,
                "website_sitemap_url": website_sitemap_url,
            }

    await db.commit()
    return HeartbeatResponse(status="ok", assigned_task=assigned_task)


# --------------- Pydantic models for new endpoints ---------------

class TaskProgressReport(PydanticBaseModel):
    task_id: str
    progress: dict


class TaskCompleteReport(PydanticBaseModel):
    task_id: str
    status: str
    result_summary: dict | None = None
    error_message: str | None = None


class ScrapedLinksUpload(PydanticBaseModel):
    task_id: str
    urls: list[str]


class WorkerLogsUpload(PydanticBaseModel):
    lines: list[str]


# --------------- Helper ---------------

async def _get_worker_by_auth(authorization: str, db: AsyncSession) -> Worker:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    api_key = authorization[7:]
    result = await db.execute(select(Worker).where(Worker.api_key == api_key))
    worker = result.scalar_one_or_none()
    if not worker:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return worker


# --------------- New endpoints ---------------

@router.post("/task-progress")
async def report_task_progress(
    body: TaskProgressReport,
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    worker = await _get_worker_by_auth(authorization, db)
    task = await db.get(Task, body.task_id)
    if not task or task.worker_id != worker.id:
        raise HTTPException(status_code=404, detail="Task not found")
    task.progress = body.progress
    await db.commit()

    r = aioredis.from_url(settings.REDIS_URL)
    await r.publish(f"task:{task.id}", json.dumps({"type": "progress", "progress": body.progress}))
    await r.aclose()

    return {"status": "ok"}


@router.post("/task-complete")
async def report_task_complete(
    body: TaskCompleteReport,
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    worker = await _get_worker_by_auth(authorization, db)
    task = await db.get(Task, body.task_id)
    if not task or task.worker_id != worker.id:
        raise HTTPException(status_code=404, detail="Task not found")

    task.status = body.status
    task.result_summary = body.result_summary
    task.error_message = body.error_message
    task.completed_at = datetime.now(timezone.utc)
    await db.commit()

    r = aioredis.from_url(settings.REDIS_URL)
    await r.publish(f"task:{task.id}", json.dumps({
        "type": "complete",
        "status": body.status,
        "result_summary": body.result_summary,
        "error_message": body.error_message,
    }))
    await r.aclose()

    return {"status": "ok"}


@router.post("/task-links")
async def upload_scraped_links(
    body: ScrapedLinksUpload,
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    worker = await _get_worker_by_auth(authorization, db)
    task = await db.get(Task, body.task_id)
    if not task or task.worker_id != worker.id:
        raise HTTPException(status_code=404, detail="Task not found")

    if body.urls:
        stmt = pg_insert(ScrapedLink).values([
            {"website_id": task.website_id, "task_id": task.id, "url": url}
            for url in body.urls
        ]).on_conflict_do_nothing(
            constraint="uq_scraped_links_website_url"
        )
        result = await db.execute(stmt)
        await db.commit()
        return {"status": "ok", "inserted": result.rowcount, "skipped": len(body.urls) - result.rowcount}
    return {"status": "ok", "inserted": 0, "skipped": 0}


WORKER_LOG_MAX = 500  # max lines kept in Redis per worker


@router.post("/logs")
async def upload_worker_logs(
    body: WorkerLogsUpload,
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    worker = await _get_worker_by_auth(authorization, db)
    if not body.lines:
        return {"status": "ok"}

    r = aioredis.from_url(settings.REDIS_URL)
    key = f"worker-logs:{worker.id}"

    pipe = r.pipeline()
    for line in body.lines:
        pipe.rpush(key, line)
    pipe.ltrim(key, -WORKER_LOG_MAX, -1)
    pipe.expire(key, 86400)  # 24h TTL
    await pipe.execute()

    # Publish for live WebSocket subscribers
    for line in body.lines:
        await r.publish(f"worker-logs:{worker.id}", line)
    await r.aclose()

    return {"status": "ok"}
