import asyncio
import json
import secrets
from datetime import datetime, timedelta, timezone

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session, get_db
from app.dependencies import get_current_user
from app.models.setting import Setting
from app.models.user import User
from app.models.task import Task
from app.models.website import Website
from app.models.worker import Worker
from app.schemas.worker import BatchUpdateRequest, WorkerCreate, WorkerCreateResponse, WorkerCurrentTask, WorkerResponse
from app.utils.encryption import encrypt

router = APIRouter(prefix="/api/workers", tags=["workers"])

_background_tasks: set[asyncio.Task] = set()

HEARTBEAT_TIMEOUT = timedelta(minutes=2)


def _worker_response(
    w: Worker,
    current_task: WorkerCurrentTask | None = None,
    stats_history: list[dict] | None = None,
) -> WorkerResponse:
    return WorkerResponse(
        id=str(w.id),
        name=w.name,
        ssh_host=w.ssh_host,
        ssh_user=w.ssh_user,
        ssh_port=w.ssh_port,
        status=w.status,
        last_heartbeat=w.last_heartbeat,
        system_stats=w.system_stats or {},
        code_hash=w.code_hash,
        needs_update=w.needs_update,
        current_task=current_task,
        stats_history=stats_history or [],
        created_at=w.created_at,
        updated_at=w.updated_at,
    )


@router.get("", response_model=list[WorkerResponse])
async def list_workers(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Worker).order_by(Worker.created_at.desc()))
    workers = result.scalars().all()

    now = datetime.now(timezone.utc)
    for w in workers:
        if w.status == "online" and (
            w.last_heartbeat is None or now - w.last_heartbeat > HEARTBEAT_TIMEOUT
        ):
            w.status = "offline"
    await db.commit()

    # Fetch running tasks for all workers in one query
    worker_ids = [w.id for w in workers]
    task_result = await db.execute(
        select(Task).where(Task.worker_id.in_(worker_ids), Task.status == "running")
    )
    running_tasks = {t.worker_id: t for t in task_result.scalars().all()}

    # Fetch stats history from Redis for all workers
    stats_by_worker: dict[str, list[dict]] = {}
    try:
        r = aioredis.from_url(settings.REDIS_URL)
        pipe = r.pipeline()
        for w in workers:
            pipe.lrange(f"worker-stats:{w.id}", 0, -1)
        results = await pipe.execute()
        await r.aclose()
        for w, raw_list in zip(workers, results):
            stats_by_worker[str(w.id)] = [json.loads(item) for item in raw_list]
    except Exception:
        pass  # Gracefully degrade if Redis unavailable

    responses = []
    for w in workers:
        ct = None
        task = running_tasks.get(w.id)
        if task:
            website_name = None
            if task.website_id:
                website = await db.get(Website, task.website_id)
                website_name = website.name if website else None
            ct = WorkerCurrentTask(
                id=str(task.id),
                task_type=task.task_type,
                status=task.status,
                website_name=website_name,
                progress=task.progress or {},
                started_at=task.started_at,
            )
        history = stats_by_worker.get(str(w.id), [])
        responses.append(_worker_response(w, current_task=ct, stats_history=history))

    return responses


@router.post("", response_model=WorkerCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_worker(
    body: WorkerCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ssh_key_value = body.ssh_key
    ssh_password_value = body.ssh_password

    if body.use_saved_key:
        # Fetch global SSH key from settings
        result = await db.execute(
            select(Setting).where(Setting.key == "upcloud_ssh_key")
        )
        setting = result.scalar_one_or_none()
        if not setting or not setting.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="SSH key not configured in Settings.",
            )
        ssh_key_value = setting.value
        ssh_password_value = None
    elif not body.ssh_password and not body.ssh_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either ssh_password or ssh_key is required",
        )

    api_key = "wk_" + secrets.token_hex(32)

    worker = Worker(
        name=body.name,
        ssh_host=body.ssh_host,
        ssh_user=body.ssh_user,
        ssh_port=body.ssh_port,
        ssh_password_encrypted=encrypt(ssh_password_value) if ssh_password_value else None,
        ssh_key_encrypted=encrypt(ssh_key_value) if ssh_key_value else None,
        api_key=api_key,
    )
    db.add(worker)
    await db.commit()
    await db.refresh(worker)

    resp = _worker_response(worker)
    return WorkerCreateResponse(**resp.model_dump(), api_key=api_key)


@router.delete("/{worker_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_worker(
    worker_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Worker).where(Worker.id == worker_id))
    worker = result.scalar_one_or_none()
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")
    await db.delete(worker)
    await db.commit()


async def _get_control_url(db: AsyncSession) -> str:
    setting_result = await db.execute(
        select(Setting).where(Setting.key == "control_server_url")
    )
    setting = setting_result.scalar_one_or_none()
    control_url = setting.value if setting else ""
    if not control_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Control server URL not configured. Go to Settings first.",
        )
    return control_url


async def _start_install(worker: Worker, control_url: str, db: AsyncSession):
    from app.services.worker_provisioner import provision_worker
    from app.utils.encryption import decrypt

    worker.status = "provisioning"
    worker.install_log = None
    await db.commit()

    ssh_password = decrypt(worker.ssh_password_encrypted) if worker.ssh_password_encrypted else None
    ssh_key = decrypt(worker.ssh_key_encrypted) if worker.ssh_key_encrypted else None

    task = asyncio.create_task(
        provision_worker(
            ssh_host=worker.ssh_host,
            ssh_user=worker.ssh_user,
            ssh_port=worker.ssh_port,
            ssh_password=ssh_password,
            ssh_key=ssh_key,
            worker_api_key=worker.api_key,
            control_server_url=control_url,
            worker_id=str(worker.id),
            db_session_factory=async_session,
        )
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


@router.post("/{worker_id}/install")
async def install_worker(
    worker_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Worker).where(Worker.id == worker_id))
    worker = result.scalar_one_or_none()
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")

    if worker.status == "provisioning":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Worker is already being provisioned",
        )

    control_url = await _get_control_url(db)
    await _start_install(worker, control_url, db)

    return {"status": "provisioning", "worker_id": str(worker.id)}


@router.post("/{worker_id}/reset")
async def reset_worker(
    worker_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Worker).where(Worker.id == worker_id))
    worker = result.scalar_one_or_none()
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")

    if worker.status == "provisioning":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Worker is currently being provisioned",
        )

    from app.services.worker_provisioner import reset_worker_container
    from app.utils.encryption import decrypt

    ssh_password = decrypt(worker.ssh_password_encrypted) if worker.ssh_password_encrypted else None
    ssh_key = decrypt(worker.ssh_key_encrypted) if worker.ssh_key_encrypted else None

    worker.status = "provisioning"
    await db.commit()

    task = asyncio.create_task(
        reset_worker_container(
            ssh_host=worker.ssh_host,
            ssh_user=worker.ssh_user,
            ssh_port=worker.ssh_port,
            ssh_password=ssh_password,
            ssh_key=ssh_key,
            worker_id=str(worker.id),
            db_session_factory=async_session,
        )
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return {"status": "resetting", "worker_id": str(worker.id)}


@router.post("/batch-update")
async def batch_update_workers(
    body: BatchUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    control_url = await _get_control_url(db)

    results = []
    for worker_id in body.worker_ids:
        result = await db.execute(select(Worker).where(Worker.id == worker_id))
        worker = result.scalar_one_or_none()
        if not worker:
            results.append({"worker_id": worker_id, "status": "not_found"})
            continue
        if worker.status == "provisioning":
            results.append({"worker_id": worker_id, "status": "already_provisioning"})
            continue
        await _start_install(worker, control_url, db)
        results.append({"worker_id": worker_id, "status": "provisioning"})

    return {"workers": results}
