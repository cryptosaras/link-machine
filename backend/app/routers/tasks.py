from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.task import Task, ScrapedLink
from app.models.user import User
from app.models.website import Website
from app.schemas.task import TaskCreate, TaskResponse

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


async def _task_to_response(task: Task, db: AsyncSession) -> TaskResponse:
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
        progress=task.progress or {},
        result_summary=task.result_summary,
        error_message=task.error_message,
        started_at=task.started_at,
        completed_at=task.completed_at,
        created_at=task.created_at,
        website_name=website_name,
        worker_name=worker_name,
    )


@router.get("", response_model=list[TaskResponse])
async def list_tasks(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Task).where(Task.user_id == user.id).order_by(desc(Task.created_at))
    )
    tasks = result.scalars().all()
    return [await _task_to_response(t, db) for t in tasks]


@router.post("", response_model=TaskResponse, status_code=201)
async def create_task(
    body: TaskCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    website = await db.get(Website, body.website_id)
    if not website or website.user_id != user.id:
        raise HTTPException(status_code=404, detail="Website not found")

    params = dict(body.params)

    # Text-only mode: load existing scraped link URLs for the website
    if params.get("extract_text_only"):
        result = await db.execute(
            select(ScrapedLink.url).where(ScrapedLink.website_id == website.id)
        )
        urls = [row[0] for row in result.all()]
        if not urls:
            raise HTTPException(status_code=400, detail="No scraped links found for this website. Run a link scrape first.")
        params["urls_to_scrape"] = urls

    task = Task(
        user_id=user.id,
        website_id=website.id,
        task_type=body.task_type,
        status="pending",
        params=params,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return await _task_to_response(task, db)


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(Task, task_id)
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="Task not found")
    return await _task_to_response(task, db)


@router.post("/{task_id}/retry", response_model=TaskResponse)
async def retry_task(
    task_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(Task, task_id)
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status not in ("failed", "running"):
        raise HTTPException(status_code=400, detail="Only failed or stuck tasks can be retried")
    task.status = "pending"
    task.worker_id = None
    task.started_at = None
    task.completed_at = None
    task.progress = {}
    task.result_summary = None
    task.error_message = None
    await db.commit()
    await db.refresh(task)
    return await _task_to_response(task, db)


@router.delete("/{task_id}", status_code=204)
async def delete_task(
    task_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(Task, task_id)
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="Task not found")
    await db.delete(task)
    await db.commit()


class BulkDeleteRequest(BaseModel):
    task_ids: list[str]


@router.post("/bulk-delete", status_code=204)
async def bulk_delete_tasks(
    body: BulkDeleteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Task).where(Task.user_id == user.id, Task.id.in_(body.task_ids))
    )
    tasks = result.scalars().all()
    if not tasks:
        raise HTTPException(status_code=404, detail="No tasks found")
    task_ids = [t.id for t in tasks]
    for t in tasks:
        await db.delete(t)
    await db.commit()


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
