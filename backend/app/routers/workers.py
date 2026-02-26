import asyncio
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session, get_db
from app.dependencies import get_current_user
from app.models.setting import Setting
from app.models.user import User
from app.models.worker import Worker
from app.schemas.worker import WorkerCreate, WorkerCreateResponse, WorkerResponse
from app.utils.encryption import encrypt

router = APIRouter(prefix="/api/workers", tags=["workers"])

_background_tasks: set[asyncio.Task] = set()

HEARTBEAT_TIMEOUT = timedelta(minutes=2)


def _worker_response(w: Worker) -> WorkerResponse:
    return WorkerResponse(
        id=str(w.id),
        name=w.name,
        ssh_host=w.ssh_host,
        ssh_user=w.ssh_user,
        ssh_port=w.ssh_port,
        status=w.status,
        last_heartbeat=w.last_heartbeat,
        system_stats=w.system_stats or {},
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

    return [_worker_response(w) for w in workers]


@router.post("", response_model=WorkerCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_worker(
    body: WorkerCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not body.ssh_password and not body.ssh_key:
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
        ssh_password_encrypted=encrypt(body.ssh_password) if body.ssh_password else None,
        ssh_key_encrypted=encrypt(body.ssh_key) if body.ssh_key else None,
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

    # Get control server URL from settings
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

    worker.status = "provisioning"
    worker.install_log = None
    await db.commit()

    # Launch provisioning in background
    from app.services.worker_provisioner import provision_worker
    from app.utils.encryption import decrypt

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

    return {"status": "provisioning", "worker_id": str(worker.id)}
