from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
import redis.asyncio as aioredis

from app.auth.service import decode_token
from app.config import settings

router = APIRouter()


@router.websocket("/ws/install/{worker_id}")
async def ws_install_log(
    websocket: WebSocket,
    worker_id: str,
    token: str = Query(...),
):
    # Validate JWT token
    try:
        payload = decode_token(token)
        if not payload.get("sub"):
            await websocket.close(code=4001)
            return
    except Exception:
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
