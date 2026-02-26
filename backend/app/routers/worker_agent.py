from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.worker import Worker
from app.schemas.worker import HeartbeatRequest, HeartbeatResponse

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
    await db.commit()
    return HeartbeatResponse(status="ok")
