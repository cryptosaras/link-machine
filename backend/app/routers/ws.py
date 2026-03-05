import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
import asyncssh
import redis.asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import decode_token
from app.config import settings
from app.database import async_session
from app.models.worker import Worker
from app.utils.encryption import decrypt

router = APIRouter()


def _validate_token(token: str) -> bool:
    try:
        payload = decode_token(token)
        return bool(payload.get("sub"))
    except Exception:
        return False


@router.websocket("/ws/install/{worker_id}")
async def ws_install_log(
    websocket: WebSocket,
    worker_id: str,
    token: str = Query(...),
):
    if not _validate_token(token):
        await websocket.close(code=4001)
        return

    await websocket.accept()

    r = aioredis.from_url(settings.REDIS_URL)
    pubsub = r.pubsub()
    await pubsub.subscribe(f"install:{worker_id}")

    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                line = message["data"].decode()
                await websocket.send_text(line)
                if line.startswith("__DONE__") or line.startswith("__ERROR__"):
                    break
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(f"install:{worker_id}")
        await r.aclose()


@router.websocket("/ws/terminal/{worker_id}")
async def ws_terminal(
    websocket: WebSocket,
    worker_id: str,
    token: str = Query(...),
):
    if not _validate_token(token):
        await websocket.close(code=4001)
        return

    # Fetch worker and decrypt SSH credentials
    async with async_session() as db:
        result = await db.execute(select(Worker).where(Worker.id == worker_id))
        worker = result.scalar_one_or_none()
        if not worker:
            await websocket.close(code=4004)
            return

        ssh_host = worker.ssh_host
        ssh_user = worker.ssh_user
        ssh_port = worker.ssh_port
        ssh_password = decrypt(worker.ssh_password_encrypted) if worker.ssh_password_encrypted else None
        ssh_key = decrypt(worker.ssh_key_encrypted) if worker.ssh_key_encrypted else None

    await websocket.accept()

    try:
        # Build SSH connection
        connect_kwargs: dict = {
            "host": ssh_host,
            "port": ssh_port,
            "username": ssh_user,
            "known_hosts": None,
        }
        if ssh_password:
            connect_kwargs["password"] = ssh_password
        if ssh_key:
            connect_kwargs["client_keys"] = [asyncssh.import_private_key(ssh_key)]

        async with asyncssh.connect(**connect_kwargs) as conn:
            process = await conn.create_process(
                term_type="xterm-256color",
                term_size=(80, 24),
                encoding=None,
            )

            async def ssh_to_ws():
                """Read SSH stdout and send to WebSocket."""
                try:
                    while not process.stdout.at_eof():
                        data = await process.stdout.read(65536)
                        if data:
                            if isinstance(data, bytes):
                                await websocket.send_text(data.decode("utf-8", errors="replace"))
                            else:
                                await websocket.send_text(data)
                except (asyncssh.BreakReceived, asyncssh.SignalReceived):
                    pass
                except Exception:
                    pass

            async def ws_to_ssh():
                """Read WebSocket messages and write to SSH stdin."""
                try:
                    while True:
                        data = await websocket.receive_text()
                        # Check for control messages (resize)
                        if data.startswith("{"):
                            try:
                                msg = json.loads(data)
                                if msg.get("type") == "resize":
                                    process.change_terminal_size(
                                        msg.get("cols", 80),
                                        msg.get("rows", 24),
                                    )
                                    continue
                            except json.JSONDecodeError:
                                pass
                        process.stdin.write(data.encode("utf-8"))
                        await process.stdin.drain()
                except WebSocketDisconnect:
                    pass
                except Exception:
                    pass

            # Run both directions concurrently
            done, pending = await asyncio.wait(
                [asyncio.create_task(ssh_to_ws()), asyncio.create_task(ws_to_ssh())],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for t in pending:
                t.cancel()

    except asyncssh.Error as e:
        try:
            await websocket.send_text(f"\r\nSSH Error: {e}\r\n")
        except Exception:
            pass
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_text(f"\r\nError: {e}\r\n")
        except Exception:
            pass


@router.websocket("/ws/worker-logs/{worker_id}")
async def ws_worker_logs(
    websocket: WebSocket,
    worker_id: str,
    token: str = Query(...),
):
    if not _validate_token(token):
        await websocket.close(code=4001)
        return

    await websocket.accept()

    r = aioredis.from_url(settings.REDIS_URL)

    # Send recent history first
    key = f"worker-logs:{worker_id}"
    history = await r.lrange(key, 0, -1)
    for line in history:
        await websocket.send_text(line.decode())

    # Then subscribe for live updates
    pubsub = r.pubsub()
    await pubsub.subscribe(f"worker-logs:{worker_id}")

    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                await websocket.send_text(message["data"].decode())
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(f"worker-logs:{worker_id}")
        await r.aclose()


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
                parsed = json.loads(data)
                if parsed.get("type") == "complete":
                    break
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(f"task:{task_id}")
        await r.aclose()
