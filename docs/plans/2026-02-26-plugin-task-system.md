# Plugin & Task System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a plugin-based task system where workers execute file-based plugins (starting with link scraping), with real-time progress via WebSocket, a Tasks page in the UI, and scraped link storage.

**Architecture:** Tasks are created via the API and stored in a `tasks` table with `task_type` and JSON `params`. Workers pull pending tasks during heartbeat. The worker agent downloads the plugin file from the server, executes it, and streams progress back via Redis pubsub -> WebSocket. Results (scraped links) are stored in a `scraped_links` table linked to the website. Worker provisioning is updated to pre-install all plugin dependencies.

**Tech Stack:** FastAPI, SQLAlchemy async, Alembic, Redis pubsub, WebSocket, React + TypeScript, Radix UI, Zustand, aiohttp, selectolax

---

## Task 1: Database Migration — `tasks` and `scraped_links` tables

**Files:**
- Create: `backend/alembic/versions/004_tasks_and_scraped_links.py`
- Create: `backend/app/models/task.py`
- Modify: `backend/app/models/__init__.py`

**Step 1: Create the migration file**

```python
# backend/alembic/versions/004_tasks_and_scraped_links.py
"""Add tasks and scraped_links tables

Revision ID: 004
Revises: 003
Create Date: 2026-02-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("website_id", sa.Uuid(), sa.ForeignKey("websites.id", ondelete="CASCADE"), nullable=True),
        sa.Column("worker_id", sa.Uuid(), sa.ForeignKey("workers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("task_type", sa.String(50), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("params", sa.JSON(), server_default=sa.text("'{}'")),
        sa.Column("progress", sa.JSON(), server_default=sa.text("'{}'")),
        sa.Column("result_summary", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_tasks_status", "tasks", ["status"])
    op.create_index("ix_tasks_user_id", "tasks", ["user_id"])

    op.create_table(
        "scraped_links",
        sa.Column("id", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("website_id", sa.Uuid(), sa.ForeignKey("websites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id", sa.Uuid(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.String(2048), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_scraped_links_website_id", "scraped_links", ["website_id"])
    op.create_index("ix_scraped_links_task_id", "scraped_links", ["task_id"])


def downgrade() -> None:
    op.drop_table("scraped_links")
    op.drop_table("tasks")
```

**Step 2: Create the Task model**

```python
# backend/app/models/task.py
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    website_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("websites.id", ondelete="CASCADE"), nullable=True)
    worker_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workers.id", ondelete="SET NULL"), nullable=True)
    task_type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    progress: Mapped[dict] = mapped_column(JSON, default=dict)
    result_summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class ScrapedLink(Base):
    __tablename__ = "scraped_links"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    website_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("websites.id", ondelete="CASCADE"), nullable=False)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
```

**Step 3: Update models `__init__.py`**

Add to `backend/app/models/__init__.py`:
```python
from app.models.task import Task, ScrapedLink
# Add to __all__: "Task", "ScrapedLink"
```

**Step 4: Run migration**

Run: `cd backend && alembic upgrade head`
Expected: Tables `tasks` and `scraped_links` created.

**Step 5: Commit**

```bash
git add backend/alembic/versions/004_tasks_and_scraped_links.py backend/app/models/task.py backend/app/models/__init__.py
git commit -m "feat: add tasks and scraped_links DB tables"
```

---

## Task 2: Backend — Task schemas and CRUD router

**Files:**
- Create: `backend/app/schemas/task.py`
- Create: `backend/app/routers/tasks.py`
- Modify: `backend/app/main.py` (register router)

**Step 1: Create task schemas**

```python
# backend/app/schemas/task.py
from datetime import datetime
from pydantic import BaseModel


class ScrapeLinksParams(BaseModel):
    depth: int = 0
    max_pages: int = 10000
    concurrent: int = 30
    delay: float = 0.1
    timeout: float = 5.0
    use_sitemap: bool = False


class TaskCreate(BaseModel):
    website_id: str
    task_type: str  # "scrape_links"
    params: dict = {}


class TaskResponse(BaseModel):
    id: str
    user_id: str
    website_id: str | None
    worker_id: str | None
    task_type: str
    status: str
    params: dict
    progress: dict
    result_summary: dict | None
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    website_name: str | None = None
    worker_name: str | None = None
```

**Step 2: Create tasks router**

```python
# backend/app/routers/tasks.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.task import Task, ScrapedLink
from app.models.user import User
from app.models.website import Website
from app.schemas.task import TaskCreate, TaskResponse

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskResponse])
async def list_tasks(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Task).where(Task.user_id == user.id).order_by(desc(Task.created_at))
    )
    tasks = result.scalars().all()

    # Fetch website and worker names for display
    responses = []
    for task in tasks:
        website_name = None
        worker_name = None
        if task.website_id:
            w = await db.get(Website, task.website_id)
            website_name = w.name if w else None
        if task.worker_id:
            from app.models.worker import Worker
            wr = await db.get(Worker, task.worker_id)
            worker_name = wr.name if wr else None
        responses.append(TaskResponse(
            id=str(task.id),
            user_id=str(task.user_id),
            website_id=str(task.website_id) if task.website_id else None,
            worker_id=str(task.worker_id) if task.worker_id else None,
            task_type=task.task_type,
            status=task.status,
            params=task.params,
            progress=task.progress,
            result_summary=task.result_summary,
            error_message=task.error_message,
            started_at=task.started_at,
            completed_at=task.completed_at,
            created_at=task.created_at,
            website_name=website_name,
            worker_name=worker_name,
        ))
    return responses


@router.post("", response_model=TaskResponse, status_code=201)
async def create_task(
    body: TaskCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Verify website belongs to user
    website = await db.get(Website, body.website_id)
    if not website or website.user_id != user.id:
        raise HTTPException(status_code=404, detail="Website not found")

    task = Task(
        user_id=user.id,
        website_id=website.id,
        task_type=body.task_type,
        status="pending",
        params=body.params,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return TaskResponse(
        id=str(task.id),
        user_id=str(task.user_id),
        website_id=str(task.website_id),
        worker_id=None,
        task_type=task.task_type,
        status=task.status,
        params=task.params,
        progress=task.progress or {},
        result_summary=task.result_summary,
        error_message=task.error_message,
        started_at=task.started_at,
        completed_at=task.completed_at,
        created_at=task.created_at,
        website_name=website.name,
        worker_name=None,
    )


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(Task, task_id)
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="Task not found")

    website_name = None
    worker_name = None
    if task.website_id:
        w = await db.get(Website, task.website_id)
        website_name = w.name if w else None
    if task.worker_id:
        from app.models.worker import Worker
        wr = await db.get(Worker, task.worker_id)
        worker_name = wr.name if wr else None

    return TaskResponse(
        id=str(task.id),
        user_id=str(task.user_id),
        website_id=str(task.website_id) if task.website_id else None,
        worker_id=str(task.worker_id) if task.worker_id else None,
        task_type=task.task_type,
        status=task.status,
        params=task.params,
        progress=task.progress,
        result_summary=task.result_summary,
        error_message=task.error_message,
        started_at=task.started_at,
        completed_at=task.completed_at,
        created_at=task.created_at,
        website_name=website_name,
        worker_name=worker_name,
    )


@router.get("/{task_id}/links", response_model=list[str])
async def get_task_links(
    task_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(Task, task_id)
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(ScrapedLink.url).where(ScrapedLink.task_id == task.id).order_by(ScrapedLink.url)
    )
    return [row[0] for row in result.all()]
```

**Step 3: Register router in main.py**

Add to `backend/app/main.py`:
```python
from app.routers.tasks import router as tasks_router
# In create_app():
app.include_router(tasks_router)
```

**Step 4: Commit**

```bash
git add backend/app/schemas/task.py backend/app/routers/tasks.py backend/app/main.py
git commit -m "feat: add tasks API router with CRUD endpoints"
```

---

## Task 3: Backend — Heartbeat task assignment

Modify the heartbeat endpoint so it returns a pending task when the worker is idle. The worker tells the server if it's busy or idle. Server assigns the task atomically.

**Files:**
- Modify: `backend/app/schemas/worker.py` (extend HeartbeatRequest/Response)
- Modify: `backend/app/routers/worker_agent.py` (task assignment logic)

**Step 1: Update heartbeat schemas**

In `backend/app/schemas/worker.py`, replace `HeartbeatRequest` and `HeartbeatResponse`:

```python
class HeartbeatRequest(BaseModel):
    system_stats: dict = {}
    code_hash: str | None = None
    current_task_id: str | None = None  # None = idle, str = busy with this task


class HeartbeatResponse(BaseModel):
    status: str
    assigned_task: dict | None = None  # {id, task_type, params, website_url, website_sitemap_url}
```

**Step 2: Update heartbeat endpoint**

Replace `backend/app/routers/worker_agent.py` with:

```python
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.task import Task
from app.models.website import Website
from app.models.worker import Worker
from app.schemas.worker import HeartbeatRequest, HeartbeatResponse
from app.services.worker_version import EXPECTED_WORKER_HASH

router = APIRouter(prefix="/api/worker-agent", tags=["worker-agent"])


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
    worker.needs_update = (
        bool(EXPECTED_WORKER_HASH) and body.code_hash != EXPECTED_WORKER_HASH
        if body.code_hash else bool(EXPECTED_WORKER_HASH)
    )

    assigned_task = None

    # If worker is idle, try to assign a pending task
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

            # Fetch website info for the task
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
```

**Step 3: Commit**

```bash
git add backend/app/schemas/worker.py backend/app/routers/worker_agent.py
git commit -m "feat: heartbeat returns pending task assignment to idle workers"
```

---

## Task 4: Backend — Task progress and result reporting endpoints

Workers need endpoints to report progress, completion, and upload scraped links.

**Files:**
- Modify: `backend/app/routers/worker_agent.py` (add progress/complete/links endpoints)

**Step 1: Add worker-agent task endpoints**

Append to `backend/app/routers/worker_agent.py`:

```python
from pydantic import BaseModel


class TaskProgressReport(BaseModel):
    task_id: str
    progress: dict  # e.g. {"pages_fetched": 50, "links_found": 234, "rate": "12.3 pg/s"}


class TaskCompleteReport(BaseModel):
    task_id: str
    status: str  # "completed" or "failed"
    result_summary: dict | None = None  # e.g. {"total_links": 500, "pages_crawled": 200}
    error_message: str | None = None


class ScrapedLinksUpload(BaseModel):
    task_id: str
    urls: list[str]


async def _get_worker_by_auth(authorization: str, db: AsyncSession) -> Worker:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    api_key = authorization[7:]
    result = await db.execute(select(Worker).where(Worker.api_key == api_key))
    worker = result.scalar_one_or_none()
    if not worker:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return worker


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

    # Publish progress to Redis for WebSocket subscribers
    import redis.asyncio as aioredis
    from app.config import settings
    r = aioredis.from_url(settings.REDIS_URL)
    import json
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

    # Publish completion to Redis
    import redis.asyncio as aioredis
    from app.config import settings
    import json
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

    from app.models.task import ScrapedLink
    for url in body.urls:
        db.add(ScrapedLink(
            website_id=task.website_id,
            task_id=task.id,
            url=url,
        ))
    await db.commit()
    return {"status": "ok", "count": len(body.urls)}
```

**Step 2: Commit**

```bash
git add backend/app/routers/worker_agent.py
git commit -m "feat: add task progress, completion, and link upload endpoints"
```

---

## Task 5: Backend — WebSocket for task progress streaming

**Files:**
- Modify: `backend/app/routers/ws.py` (add task progress WS endpoint)

**Step 1: Add task WebSocket endpoint**

Append to `backend/app/routers/ws.py`:

```python
@router.websocket("/ws/task/{task_id}")
async def ws_task_progress(
    websocket: WebSocket,
    task_id: str,
    token: str = Query(...),
):
    if not _validate_token(token):
        await websocket.close(code=4001)
        return

    await websocket.accept()

    r = aioredis.from_url(settings.REDIS_URL)
    pubsub = r.pubsub()
    await pubsub.subscribe(f"task:{task_id}")

    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                data = message["data"].decode()
                await websocket.send_text(data)
                # Close on completion
                parsed = json.loads(data)
                if parsed.get("type") == "complete":
                    break
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(f"task:{task_id}")
        await r.aclose()
```

**Step 2: Commit**

```bash
git add backend/app/routers/ws.py
git commit -m "feat: add WebSocket endpoint for task progress streaming"
```

---

## Task 6: Worker Agent — Plugin executor and task loop

The worker agent needs to: check heartbeat for assigned tasks, download/run the plugin, and report progress back.

**Files:**
- Create: `worker/agent/task_runner.py`
- Create: `worker/plugins/scrape_links.py` (adapted from ADAPT_TO_PLUGN/scrape_links.py)
- Modify: `worker/agent/heartbeat.py` (handle task assignment)
- Modify: `worker/agent/main.py` (run heartbeat + task loop)
- Modify: `worker/requirements.txt` (add aiohttp, selectolax for scrape plugin)

**Step 1: Update worker requirements.txt**

```
httpx>=0.28.0
pydantic-settings>=2.7.0
aiohttp>=3.11.0
selectolax>=0.3.21
```

**Step 2: Create the scrape_links plugin**

Copy and adapt `ADAPT_TO_PLUGN/scrape_links.py` to `worker/plugins/scrape_links.py`. Key changes:
- Remove CLI `main()` and `argparse`
- Add an async `run(params, report_progress, report_complete, upload_links)` entry point
- `report_progress` callback sends progress dicts to control server
- On completion, call `upload_links(urls)` then `report_complete(summary)`

```python
# worker/plugins/scrape_links.py
"""
Scrape Links plugin — adapted for worker execution.
Entry point: run(params, callbacks)
"""
import asyncio
import random
import re
import time
from urllib.parse import urljoin, urlparse, urlunparse, parse_qs, urlencode

import aiohttp
from selectolax.lexbor import LexborHTMLParser

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
]

TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "ref", "fbclid", "gclid", "mc_cid", "mc_eid", "msclkid", "_ga",
}

LOC_RE = re.compile(r"<loc>\s*(.*?)\s*</loc>", re.IGNORECASE)

SKIP_EXTENSIONS = frozenset((
    ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico",
    ".css", ".js", ".woff", ".woff2", ".ttf", ".eot",
    ".mp3", ".mp4", ".avi", ".mov", ".wmv", ".flv",
    ".zip", ".tar", ".gz", ".rar", ".7z",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".rss", ".atom",
))


def random_headers():
    return {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
    }


def normalize_url(url, base_url):
    url = urljoin(base_url, url)
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return None
    scheme = parsed.scheme.lower()
    host = (parsed.hostname or "").lower()
    if not host:
        return None
    port = parsed.port
    if (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
        port = None
    netloc = host + (f":{port}" if port else "")
    path = parsed.path.rstrip("/") or "/"
    params = parse_qs(parsed.query, keep_blank_values=False)
    filtered = {k: v for k, v in sorted(params.items()) if k not in TRACKING_PARAMS}
    query = urlencode(filtered, doseq=True)
    return urlunparse((scheme, netloc, path, "", query, ""))


def is_sitemap_content(text):
    start = text[:4000]
    return "<urlset" in start or "<sitemapindex" in start


def extract_sitemap_urls(text):
    return [url.strip() for url in LOC_RE.findall(text) if url.strip()]


def extract_html_links(html, page_url):
    tree = LexborHTMLParser(html)
    links = set()
    for node in tree.css("a[href]"):
        href = node.attrs.get("href", "")
        if href:
            norm = normalize_url(href, page_url)
            if norm:
                links.add(norm)
    return links


class PluginCrawler:
    def __init__(self, start_url, max_depth=0, max_pages=10000,
                 max_concurrent=30, delay=0.1, timeout=5.0):
        parsed = urlparse(start_url)
        self.domain = (parsed.hostname or "").lower()
        self.start_url = normalize_url(start_url, start_url) or start_url
        self.max_depth = max_depth
        self.max_pages = max_pages
        self.max_concurrent = max_concurrent
        self.delay = delay
        self.timeout = timeout
        self.queued = set()
        self.all_internal_links = set()
        self.pages_crawled = 0
        self.sitemaps_processed = 0
        self.fetched_count = 0
        self.error_count = 0
        self.t0 = 0.0
        self._done = False

    def _is_internal(self, url):
        host = (urlparse(url).hostname or "").lower()
        return host == self.domain or host.endswith(f".{self.domain}")

    def _skip_extension(self, url):
        path = urlparse(url).path.lower()
        return any(path.endswith(ext) for ext in SKIP_EXTENSIONS)

    async def _fetch(self, session, url):
        try:
            async with session.get(
                url, headers=random_headers(),
                timeout=aiohttp.ClientTimeout(total=self.timeout),
                allow_redirects=True, ssl=False,
            ) as resp:
                if resp.status == 200:
                    ct = resp.headers.get("Content-Type", "")
                    if "text/html" in ct or "xml" in ct or "text/plain" in ct:
                        raw = await resp.read()
                        return raw.decode("utf-8", errors="replace")
                    return None
                self.error_count += 1
                return None
        except (asyncio.TimeoutError, aiohttp.ClientError, UnicodeDecodeError):
            self.error_count += 1
            return None

    def _enqueue(self, queue, url, depth):
        if url not in self.queued:
            self.queued.add(url)
            queue.put_nowait((url, depth))
            return True
        return False

    async def _worker(self, queue, session):
        while not self._done:
            try:
                url, depth = await asyncio.wait_for(queue.get(), timeout=3.0)
            except asyncio.TimeoutError:
                if queue.empty():
                    break
                continue
            try:
                if self.fetched_count >= self.max_pages:
                    queue.task_done()
                    break
                if self.delay > 0:
                    await asyncio.sleep(random.uniform(0, self.delay))
                text = await self._fetch(session, url)
                self.fetched_count += 1
                if text is None:
                    queue.task_done()
                    continue
                if is_sitemap_content(text):
                    self._process_sitemap(queue, url, text, depth)
                else:
                    self._process_html(queue, url, text, depth)
            except Exception:
                self.error_count += 1
            finally:
                queue.task_done()

    def _process_sitemap(self, queue, url, text, depth):
        raw_urls = extract_sitemap_urls(text)
        for link in raw_urls:
            norm = normalize_url(link, url)
            if not norm:
                continue
            if self._is_internal(norm):
                self.all_internal_links.add(norm)
                if not self._skip_extension(norm):
                    self._enqueue(queue, norm, depth + 1)
        self.sitemaps_processed += 1

    def _process_html(self, queue, url, text, depth):
        html_links = extract_html_links(text, url)
        self.all_internal_links.add(url)
        for link in html_links:
            if not self._is_internal(link):
                continue
            self.all_internal_links.add(link)
            if not self._skip_extension(link):
                if self.max_depth == 0 or depth < self.max_depth:
                    self._enqueue(queue, link, depth + 1)
        self.pages_crawled += 1

    async def crawl(self, progress_callback=None):
        connector = aiohttp.TCPConnector(
            limit=self.max_concurrent * 2,
            limit_per_host=self.max_concurrent,
            ttl_dns_cache=300, use_dns_cache=True,
            enable_cleanup_closed=True, force_close=False,
        )
        queue = asyncio.Queue()
        self._enqueue(queue, self.start_url, 0)
        self.t0 = time.monotonic()

        async with aiohttp.ClientSession(connector=connector) as session:
            workers = [
                asyncio.create_task(self._worker(queue, session))
                for _ in range(self.max_concurrent)
            ]

            # Progress reporting loop
            if progress_callback:
                async def report_loop():
                    while not self._done:
                        await asyncio.sleep(3)
                        elapsed = time.monotonic() - self.t0
                        rate = self.fetched_count / elapsed if elapsed > 0 else 0
                        await progress_callback({
                            "pages_fetched": self.fetched_count,
                            "links_found": len(self.all_internal_links),
                            "pages_crawled": self.pages_crawled,
                            "sitemaps_processed": self.sitemaps_processed,
                            "errors": self.error_count,
                            "rate": f"{rate:.1f} pg/s",
                        })
                report_task = asyncio.create_task(report_loop())

            await queue.join()
            self._done = True

            if progress_callback:
                report_task.cancel()

            for w in workers:
                w.cancel()
            await asyncio.gather(*workers, return_exceptions=True)

        return self.all_internal_links


async def run(params, report_progress, report_complete, upload_links):
    """Plugin entry point called by task_runner."""
    website_url = params.get("website_url", "")
    website_sitemap_url = params.get("website_sitemap_url")
    depth = params.get("depth", 0)
    max_pages = params.get("max_pages", 10000)
    concurrent = params.get("concurrent", 30)
    delay = params.get("delay", 0.1)
    timeout = params.get("timeout", 5.0)
    use_sitemap = params.get("use_sitemap", False)

    start_url = website_sitemap_url if (use_sitemap and website_sitemap_url) else website_url
    if not start_url:
        await report_complete("failed", error_message="No URL provided")
        return

    crawler = PluginCrawler(
        start_url=start_url,
        max_depth=depth,
        max_pages=max_pages,
        max_concurrent=concurrent,
        delay=delay,
        timeout=timeout,
    )

    try:
        links = await crawler.crawl(progress_callback=report_progress)

        # Upload links in batches of 500
        link_list = sorted(links)
        for i in range(0, len(link_list), 500):
            batch = link_list[i:i+500]
            await upload_links(batch)

        elapsed = time.monotonic() - crawler.t0
        await report_complete("completed", result_summary={
            "total_links": len(links),
            "pages_crawled": crawler.pages_crawled,
            "sitemaps_processed": crawler.sitemaps_processed,
            "pages_fetched": crawler.fetched_count,
            "errors": crawler.error_count,
            "duration_seconds": round(elapsed, 2),
        })
    except Exception as e:
        await report_complete("failed", error_message=str(e))
```

**Step 3: Create task_runner.py**

```python
# worker/agent/task_runner.py
"""
Task runner — loads and executes plugins, reports progress to control server.
"""
import importlib
import sys
import os

import httpx


PLUGIN_DIR = os.path.join(os.path.dirname(__file__), "..", "plugins")


async def execute_task(config, task_info):
    """
    Execute a task using the appropriate plugin.
    task_info: {"id", "task_type", "params", "website_url", "website_sitemap_url"}
    """
    task_id = task_info["id"]
    task_type = task_info["task_type"]
    params = task_info.get("params", {})
    params["website_url"] = task_info.get("website_url", "")
    params["website_sitemap_url"] = task_info.get("website_sitemap_url")

    base = config.CONTROL_SERVER_URL.rstrip("/")
    headers = {"Authorization": f"Bearer {config.WORKER_API_KEY}"}

    async with httpx.AsyncClient(timeout=30) as client:

        async def report_progress(progress_dict):
            try:
                await client.post(f"{base}/api/worker-agent/task-progress", json={
                    "task_id": task_id,
                    "progress": progress_dict,
                }, headers=headers)
            except Exception as e:
                print(f"Progress report error: {e}")

        async def report_complete(status, result_summary=None, error_message=None):
            try:
                await client.post(f"{base}/api/worker-agent/task-complete", json={
                    "task_id": task_id,
                    "status": status,
                    "result_summary": result_summary,
                    "error_message": error_message,
                }, headers=headers)
            except Exception as e:
                print(f"Complete report error: {e}")

        async def upload_links(urls):
            try:
                await client.post(f"{base}/api/worker-agent/task-links", json={
                    "task_id": task_id,
                    "urls": urls,
                }, headers=headers, timeout=60)
            except Exception as e:
                print(f"Link upload error: {e}")

        # Load the plugin module
        try:
            plugin_path = os.path.join(PLUGIN_DIR, f"{task_type}.py")
            if not os.path.exists(plugin_path):
                await report_complete("failed", error_message=f"Plugin not found: {task_type}")
                return

            spec = importlib.util.spec_from_file_location(f"plugins.{task_type}", plugin_path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

            print(f"Running plugin: {task_type} for task {task_id}")
            await module.run(params, report_progress, report_complete, upload_links)
            print(f"Plugin {task_type} completed for task {task_id}")

        except Exception as e:
            print(f"Plugin execution error: {e}")
            await report_complete("failed", error_message=f"Plugin error: {str(e)}")
```

**Step 4: Update heartbeat.py to handle task assignment**

Replace `worker/agent/heartbeat.py`:

```python
import asyncio
import platform

import httpx

from agent.version import AGENT_CODE_HASH
from agent.task_runner import execute_task


async def heartbeat_loop(config):
    current_task_id = None

    async with httpx.AsyncClient() as client:
        while True:
            try:
                stats = {"hostname": platform.node()}
                base = config.CONTROL_SERVER_URL.rstrip("/")
                resp = await client.post(
                    f"{base}/api/worker-agent/heartbeat",
                    json={
                        "system_stats": stats,
                        "code_hash": AGENT_CODE_HASH,
                        "current_task_id": current_task_id,
                    },
                    headers={"Authorization": f"Bearer {config.WORKER_API_KEY}"},
                    timeout=10,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    print(f"Heartbeat OK (hash: {AGENT_CODE_HASH})")

                    # If idle and server assigned a task, run it
                    if current_task_id is None and data.get("assigned_task"):
                        task_info = data["assigned_task"]
                        current_task_id = task_info["id"]
                        print(f"Received task: {task_info['task_type']} ({current_task_id})")

                        try:
                            await execute_task(config, task_info)
                        except Exception as e:
                            print(f"Task execution failed: {e}")
                        finally:
                            current_task_id = None
                            print("Task finished, worker idle")
                else:
                    print(f"Heartbeat failed: {resp.status_code}")
            except Exception as e:
                print(f"Heartbeat error: {e}")

            await asyncio.sleep(config.HEARTBEAT_INTERVAL)
```

**Step 5: Create plugins directory with __init__.py**

```bash
mkdir -p worker/plugins
touch worker/plugins/__init__.py
```

**Step 6: Update worker Dockerfile to include plugins**

Replace `worker/Dockerfile`:

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY agent/ ./agent/
COPY plugins/ ./plugins/
COPY .env .
CMD ["python", "-m", "agent.main"]
```

**Step 7: Commit**

```bash
git add worker/
git commit -m "feat: add plugin task runner and scrape_links plugin for workers"
```

---

## Task 7: Backend — Update worker provisioner to deploy plugins

The provisioner must ship the `plugins/` directory and install all plugin dependencies.

**Files:**
- Modify: `backend/app/services/worker_provisioner.py`

**Step 1: Update build_provision_script**

Add to the `build_provision_script` function in `worker_provisioner.py`:

1. Read all files from `worker/plugins/` directory alongside agent files
2. Add `mkdir -p /opt/link-machine-worker/plugins` to the script
3. Base64-encode and write each plugin file
4. The updated requirements.txt already includes aiohttp + selectolax

The key change is in the file reading section — iterate over `WORKER_SOURCE_DIR / "plugins"` directory and include all `.py` files:

```python
# After agent_files dict, add:
plugin_files = {}
plugins_dir = WORKER_SOURCE_DIR / "plugins"
if plugins_dir.exists():
    for f in plugins_dir.iterdir():
        if f.suffix == ".py":
            plugin_files[f"plugins/{f.name}"] = f.read_text(encoding="utf-8")

# In the bash script, after mkdir agent:
# mkdir -p /opt/link-machine-worker/plugins

# Then write plugin files same way as agent files
```

Update `build_provision_script` to include these plugin file writes and add the `plugins` mkdir.

**Step 2: Update docker-compose.yml volume mount**

The worker source dir mount in `docker-compose.yml` already includes the whole `worker/` directory, so plugins/ will be available.

**Step 3: Commit**

```bash
git add backend/app/services/worker_provisioner.py
git commit -m "feat: provisioner deploys plugins directory to workers"
```

---

## Task 8: Frontend — Tasks page with progress table

**Files:**
- Create: `frontend/src/pages/tasks/TaskList.tsx`
- Modify: `frontend/src/App.tsx` (add route)
- Modify: `frontend/src/components/layout/Sidebar.tsx` (add nav item)

**Step 1: Create TaskList page**

```tsx
// frontend/src/pages/tasks/TaskList.tsx
import { useEffect, useState, useRef } from "react";
import { ListTodo } from "lucide-react";
import api from "@/api/client";

interface Task {
  id: string;
  task_type: string;
  status: string;
  params: Record<string, unknown>;
  progress: Record<string, unknown>;
  result_summary: Record<string, unknown> | null;
  error_message: string | null;
  website_name: string | null;
  worker_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  running: "bg-blue-500/20 text-blue-400",
  completed: "bg-green-500/20 text-green-400",
  failed: "bg-red-500/20 text-red-400",
};

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "-";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

function formatProgress(task: Task): string {
  const p = task.progress;
  if (!p || Object.keys(p).length === 0) {
    if (task.status === "pending") return "Waiting for worker...";
    if (task.status === "completed" && task.result_summary) {
      const r = task.result_summary;
      return `${r.total_links ?? 0} links found`;
    }
    return "-";
  }
  return `${p.pages_fetched ?? 0} pages | ${p.links_found ?? 0} links | ${p.rate ?? ""}`;
}

function taskTypeLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export default function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [links, setLinks] = useState<string[]>([]);
  const wsRefs = useRef<Map<string, WebSocket>>(new Map());

  const fetchTasks = async () => {
    const res = await api.get("/tasks");
    setTasks(res.data);
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 10000);
    return () => clearInterval(interval);
  }, []);

  // Connect WebSocket for running tasks
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    tasks.forEach((task) => {
      if (task.status === "running" && !wsRefs.current.has(task.id)) {
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(
          `${proto}//${window.location.host}/ws/task/${task.id}?token=${token}`
        );
        wsRefs.current.set(task.id, ws);

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.type === "progress") {
            setTasks((prev) =>
              prev.map((t) => (t.id === task.id ? { ...t, progress: data.progress } : t))
            );
          } else if (data.type === "complete") {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === task.id
                  ? { ...t, status: data.status, result_summary: data.result_summary, error_message: data.error_message }
                  : t
              )
            );
            ws.close();
            wsRefs.current.delete(task.id);
          }
        };

        ws.onclose = () => {
          wsRefs.current.delete(task.id);
        };
      }
    });

    // Cleanup WS for tasks no longer running
    wsRefs.current.forEach((ws, id) => {
      const task = tasks.find((t) => t.id === id);
      if (!task || task.status !== "running") {
        ws.close();
        wsRefs.current.delete(id);
      }
    });
  }, [tasks]);

  const handleRowClick = async (task: Task) => {
    setSelectedTask(task);
    if (task.status === "completed") {
      const res = await api.get(`/tasks/${task.id}/links`);
      setLinks(res.data);
    } else {
      setLinks([]);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Tasks</h1>
      </div>

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--border)] bg-surface-secondary py-16">
          <ListTodo className="mb-4 h-12 w-12 text-foreground-muted" />
          <p className="text-foreground-secondary">
            No tasks yet. Start a scrape from the Websites page.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)] bg-surface-secondary">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Type</th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Website</th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Status</th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Progress</th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Worker</th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Duration</th>
                <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {tasks.map((task) => (
                <tr
                  key={task.id}
                  onClick={() => handleRowClick(task)}
                  className="cursor-pointer bg-surface hover:bg-surface-tertiary"
                >
                  <td className="px-4 py-3 font-medium text-foreground">
                    {taskTypeLabel(task.task_type)}
                  </td>
                  <td className="px-4 py-3 text-foreground-secondary">
                    {task.website_name || "-"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[task.status] || ""}`}>
                      {task.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground-secondary text-xs">
                    {formatProgress(task)}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted text-xs">
                    {task.worker_name || "-"}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted text-xs">
                    {formatDuration(task.started_at, task.completed_at)}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted text-xs">
                    {new Date(task.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Task detail panel */}
      {selectedTask && (
        <div className="rounded-lg border border-[var(--border)] bg-surface-secondary p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              {taskTypeLabel(selectedTask.task_type)} — {selectedTask.website_name}
            </h2>
            <button
              onClick={() => setSelectedTask(null)}
              className="text-foreground-muted hover:text-foreground text-sm"
            >
              Close
            </button>
          </div>

          {selectedTask.result_summary && (
            <div className="grid grid-cols-3 gap-4 text-sm">
              {Object.entries(selectedTask.result_summary).map(([k, v]) => (
                <div key={k}>
                  <span className="text-foreground-muted">{k.replace(/_/g, " ")}:</span>{" "}
                  <span className="text-foreground font-medium">{String(v)}</span>
                </div>
              ))}
            </div>
          )}

          {selectedTask.error_message && (
            <div className="rounded bg-red-500/10 p-3 text-sm text-red-400">
              {selectedTask.error_message}
            </div>
          )}

          {links.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm text-foreground-secondary font-medium">
                Scraped Links ({links.length})
              </p>
              <div className="max-h-64 overflow-y-auto rounded bg-surface p-2 text-xs font-mono">
                {links.map((url, i) => (
                  <div key={i} className="text-foreground-secondary py-0.5 truncate">
                    {url}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Add route to App.tsx**

In `frontend/src/App.tsx`, add:
```tsx
import TaskList from "@/pages/tasks/TaskList";
// In Routes, after workers route:
<Route path="/tasks" element={<TaskList />} />
```

**Step 3: Add nav item to Sidebar.tsx**

In `frontend/src/components/layout/Sidebar.tsx`, add to navItems:
```tsx
import { Globe, LayoutDashboard, ListTodo, Moon, Server, Settings, Sun } from "lucide-react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/websites", icon: Globe, label: "Websites" },
  { to: "/tasks", icon: ListTodo, label: "Tasks" },
  { to: "/workers", icon: Server, label: "Workers" },
  { to: "/settings", icon: Settings, label: "Settings" },
];
```

**Step 4: Commit**

```bash
git add frontend/src/pages/tasks/TaskList.tsx frontend/src/App.tsx frontend/src/components/layout/Sidebar.tsx
git commit -m "feat: add Tasks page with live progress via WebSocket"
```

---

## Task 9: Frontend — Scrape Links button + config dialog on Websites page

**Files:**
- Modify: `frontend/src/pages/websites/WebsiteList.tsx`

**Step 1: Add Scrape Links dialog and button**

Add to `WebsiteList.tsx`:
- A new `ScrapeDialog` state + component
- "Scrape Links" button in the Actions column for each website
- Dialog with config fields: depth, max_pages, concurrent, use_sitemap checkbox
- On submit: POST to `/api/tasks` with `{website_id, task_type: "scrape_links", params: {...}}`
- On success: redirect to `/tasks`

Key additions to the component:

```tsx
import { useNavigate } from "react-router-dom";
import { Globe, Plus, Trash2, Search } from "lucide-react";

// Add state:
const navigate = useNavigate();
const [scrapeOpen, setScrapeOpen] = useState(false);
const [scrapeWebsite, setScrapeWebsite] = useState<Website | null>(null);
const [scrapeDepth, setScrapeDepth] = useState("0");
const [scrapeMaxPages, setScrapeMaxPages] = useState("10000");
const [scrapeConcurrent, setScrapeConcurrent] = useState("30");
const [scrapeUseSitemap, setScrapeUseSitemap] = useState(false);
const [scrapeLoading, setScrapeLoading] = useState(false);

const handleScrape = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!scrapeWebsite) return;
  setScrapeLoading(true);
  try {
    await api.post("/tasks", {
      website_id: scrapeWebsite.id,
      task_type: "scrape_links",
      params: {
        depth: parseInt(scrapeDepth),
        max_pages: parseInt(scrapeMaxPages),
        concurrent: parseInt(scrapeConcurrent),
        use_sitemap: scrapeUseSitemap,
      },
    });
    setScrapeOpen(false);
    navigate("/tasks");
  } finally {
    setScrapeLoading(false);
  }
};

// In the table Actions column, add before Delete button:
<Button
  variant="ghost"
  size="icon"
  onClick={() => {
    setScrapeWebsite(site);
    setScrapeOpen(true);
  }}
  title="Scrape Links"
>
  <Search className="h-4 w-4 text-foreground-muted hover:text-emerald-400" />
</Button>
```

Add a second `<Dialog>` for scrape config with fields for depth, max_pages, concurrent, and a checkbox for use_sitemap.

**Step 2: Commit**

```bash
git add frontend/src/pages/websites/WebsiteList.tsx
git commit -m "feat: add Scrape Links button with config dialog on Websites page"
```

---

## Task 10: Integration testing and polish

**Files:**
- All files from previous tasks

**Step 1: Verify migration runs**

Run: `cd backend && alembic upgrade head`

**Step 2: Verify API endpoints work**

Test manually or with curl:
- `POST /api/tasks` — create a scrape_links task
- `GET /api/tasks` — list tasks (should show pending task)
- Simulate heartbeat with `current_task_id: null` — should get task assigned

**Step 3: Verify frontend builds**

Run: `cd frontend && npm run build`

**Step 4: Verify worker builds**

Run: `cd worker && docker build -t lm-worker-test .`

**Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "chore: integration fixes for plugin task system"
```

---

## Summary of all files changed/created

### Created:
- `backend/alembic/versions/004_tasks_and_scraped_links.py`
- `backend/app/models/task.py`
- `backend/app/schemas/task.py`
- `backend/app/routers/tasks.py`
- `worker/agent/task_runner.py`
- `worker/plugins/__init__.py`
- `worker/plugins/scrape_links.py`
- `frontend/src/pages/tasks/TaskList.tsx`

### Modified:
- `backend/app/models/__init__.py` — add Task, ScrapedLink
- `backend/app/main.py` — register tasks router
- `backend/app/schemas/worker.py` — extend heartbeat req/res
- `backend/app/routers/worker_agent.py` — task assignment + progress/complete/links endpoints
- `backend/app/routers/ws.py` — task WebSocket endpoint
- `backend/app/services/worker_provisioner.py` — deploy plugins dir
- `worker/agent/heartbeat.py` — handle task assignment
- `worker/requirements.txt` — add aiohttp, selectolax
- `worker/Dockerfile` — copy plugins dir
- `frontend/src/App.tsx` — add /tasks route
- `frontend/src/components/layout/Sidebar.tsx` — add Tasks nav item
- `frontend/src/pages/websites/WebsiteList.tsx` — add Scrape Links button + dialog
