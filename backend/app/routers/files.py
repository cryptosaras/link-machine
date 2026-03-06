import stat
from io import BytesIO
from datetime import datetime, timezone

import asyncssh
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.worker import Worker
from app.utils.encryption import decrypt

router = APIRouter(prefix="/api/workers", tags=["files"])


# --------------- Pydantic models ---------------

class MkdirRequest(BaseModel):
    path: str


class RenameRequest(BaseModel):
    old_path: str
    new_path: str


class DeleteRequest(BaseModel):
    path: str


class FileEntry(BaseModel):
    name: str
    is_dir: bool
    size: int
    modified: str
    permissions: str


# --------------- Helpers ---------------

async def _get_worker(db: AsyncSession, worker_id: str) -> Worker:
    """Fetch a worker by ID or raise 404."""
    result = await db.execute(select(Worker).where(Worker.id == worker_id))
    worker = result.scalar_one_or_none()
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Worker not found")
    return worker


def _build_ssh_kwargs(worker: Worker) -> dict:
    """Build asyncssh connect kwargs from a Worker model."""
    kwargs: dict = {
        "host": worker.ssh_host,
        "port": worker.ssh_port,
        "username": worker.ssh_user,
        "known_hosts": None,
    }
    if worker.ssh_password_encrypted:
        kwargs["password"] = decrypt(worker.ssh_password_encrypted)
    if worker.ssh_key_encrypted:
        kwargs["client_keys"] = [asyncssh.import_private_key(decrypt(worker.ssh_key_encrypted))]
    return kwargs


def _format_permissions(mode: int) -> str:
    """Convert numeric permission bits to rwx string like 'rwxr-xr-x'."""
    result = ""
    for shift in (6, 3, 0):
        bits = (mode >> shift) & 0o7
        result += "r" if bits & 4 else "-"
        result += "w" if bits & 2 else "-"
        result += "x" if bits & 1 else "-"
    return result


# --------------- Endpoints ---------------

@router.get("/{worker_id}/files", response_model=list[FileEntry])
async def list_directory(
    worker_id: str,
    path: str = Query("/"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List directory contents on a remote worker via SFTP."""
    worker = await _get_worker(db, worker_id)
    connect_kwargs = _build_ssh_kwargs(worker)

    try:
        async with asyncssh.connect(**connect_kwargs) as conn:
            async with conn.start_sftp_client() as sftp:
                entries = await sftp.readdir(path)
    except asyncssh.SFTPNoSuchFile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Path not found: {path}")
    except asyncssh.Error as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"SSH error: {exc}")

    results: list[FileEntry] = []
    for entry in entries:
        name = entry.filename
        if name in (".", ".."):
            continue
        attrs = entry.attrs
        is_dir = bool(attrs.permissions is not None and stat.S_ISDIR(attrs.permissions))
        size = attrs.size if attrs.size is not None else 0
        mtime = attrs.mtime
        modified = (
            datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
            if mtime is not None
            else ""
        )
        permissions = _format_permissions(attrs.permissions & 0o777) if attrs.permissions is not None else ""
        results.append(FileEntry(
            name=name,
            is_dir=is_dir,
            size=size,
            modified=modified,
            permissions=permissions,
        ))

    # Sort: directories first, then alphabetical by name
    results.sort(key=lambda e: (not e.is_dir, e.name.lower()))
    return results


@router.get("/{worker_id}/files/download")
async def download_file(
    worker_id: str,
    path: str = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download a file from a remote worker via SFTP."""
    worker = await _get_worker(db, worker_id)
    connect_kwargs = _build_ssh_kwargs(worker)

    try:
        async with asyncssh.connect(**connect_kwargs) as conn:
            async with conn.start_sftp_client() as sftp:
                # Check if path is a directory
                attrs = await sftp.stat(path)
                if attrs.permissions is not None and stat.S_ISDIR(attrs.permissions):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Cannot download a directory",
                    )
                async with sftp.open(path, "rb") as f:
                    data = await f.read()
    except HTTPException:
        raise
    except asyncssh.SFTPNoSuchFile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"File not found: {path}")
    except asyncssh.Error as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"SSH error: {exc}")

    filename = path.rsplit("/", 1)[-1] or "download"
    return StreamingResponse(
        BytesIO(data),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{worker_id}/files/upload")
async def upload_file(
    worker_id: str,
    path: str = Form("/"),
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a file to a remote worker via SFTP."""
    worker = await _get_worker(db, worker_id)
    connect_kwargs = _build_ssh_kwargs(worker)

    content = await file.read()
    target_dir = path.rstrip("/")
    remote_path = f"{target_dir}/{file.filename}"

    try:
        async with asyncssh.connect(**connect_kwargs) as conn:
            async with conn.start_sftp_client() as sftp:
                async with sftp.open(remote_path, "wb") as f:
                    await f.write(content)
    except asyncssh.SFTPNoSuchFile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Target directory not found: {target_dir}",
        )
    except asyncssh.Error as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"SSH error: {exc}")

    return {"status": "ok", "path": remote_path, "size": len(content)}


@router.post("/{worker_id}/files/mkdir")
async def make_directory(
    worker_id: str,
    body: MkdirRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a directory on a remote worker via SFTP."""
    worker = await _get_worker(db, worker_id)
    connect_kwargs = _build_ssh_kwargs(worker)

    try:
        async with asyncssh.connect(**connect_kwargs) as conn:
            async with conn.start_sftp_client() as sftp:
                await sftp.mkdir(body.path)
    except asyncssh.Error as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"SSH error: {exc}")

    return {"status": "ok", "path": body.path}


@router.post("/{worker_id}/files/rename")
async def rename_file(
    worker_id: str,
    body: RenameRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Rename or move a file/directory on a remote worker via SFTP."""
    worker = await _get_worker(db, worker_id)
    connect_kwargs = _build_ssh_kwargs(worker)

    try:
        async with asyncssh.connect(**connect_kwargs) as conn:
            async with conn.start_sftp_client() as sftp:
                await sftp.rename(body.old_path, body.new_path)
    except asyncssh.SFTPNoSuchFile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Path not found: {body.old_path}",
        )
    except asyncssh.Error as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"SSH error: {exc}")

    return {"status": "ok", "old_path": body.old_path, "new_path": body.new_path}


@router.post("/{worker_id}/files/delete")
async def delete_file(
    worker_id: str,
    body: DeleteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a file or empty directory on a remote worker via SFTP."""
    worker = await _get_worker(db, worker_id)
    connect_kwargs = _build_ssh_kwargs(worker)

    try:
        async with asyncssh.connect(**connect_kwargs) as conn:
            async with conn.start_sftp_client() as sftp:
                attrs = await sftp.stat(body.path)
                if attrs.permissions is not None and stat.S_ISDIR(attrs.permissions):
                    await sftp.rmdir(body.path)
                else:
                    await sftp.remove(body.path)
    except asyncssh.SFTPNoSuchFile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Path not found: {body.path}",
        )
    except asyncssh.Error as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"SSH error: {exc}")

    return {"status": "ok", "path": body.path}
