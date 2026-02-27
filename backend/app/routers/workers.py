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
from app.schemas.worker import BatchUpdateRequest, WorkerCreate, WorkerCreateResponse, WorkerResponse
from app.utils.encryption import encrypt

router = APIRouter(prefix="/api/workers", tags=["workers"])

_background_tasks: set[asyncio.Task] = set()

HEARTBEAT_TIMEOUT = timedelta(minutes=2)


def _worker_response(w: Worker) -> WorkerResponse:
    return WorkerResponse(
        id=str(w.id),
        name=w.name,
        worker_type=w.worker_type,
        ssh_host=w.ssh_host,
        ssh_user=w.ssh_user,
        ssh_port=w.ssh_port,
        status=w.status,
        last_heartbeat=w.last_heartbeat,
        system_stats=w.system_stats or {},
        code_hash=w.code_hash,
        needs_update=w.needs_update,
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
    ssh_key_value = body.ssh_key
    ssh_password_value = body.ssh_password

    if body.worker_type == "upcloud":
        # Fetch global SSH key from settings
        result = await db.execute(
            select(Setting).where(Setting.key == "upcloud_ssh_key")
        )
        setting = result.scalar_one_or_none()
        if not setting or not setting.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="UpCloud SSH key not configured. Go to Settings first.",
            )
        ssh_key_value = setting.value
        ssh_password_value = None
    elif not body.ssh_password and not body.ssh_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either ssh_password or ssh_key is required",
        )

    worker_name = body.name or f"upcloud-{body.ssh_host}"
    api_key = "wk_" + secrets.token_hex(32)

    worker = Worker(
        name=worker_name,
        worker_type=body.worker_type,
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
