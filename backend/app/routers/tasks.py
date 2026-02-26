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
