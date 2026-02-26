from datetime import datetime

from pydantic import BaseModel


class WorkerCreate(BaseModel):
    name: str
    ssh_host: str
    ssh_user: str = "root"
    ssh_port: int = 22
    ssh_password: str | None = None
    ssh_key: str | None = None


class WorkerResponse(BaseModel):
    id: str
    name: str
    ssh_host: str
    ssh_user: str
    ssh_port: int
    status: str
    last_heartbeat: datetime | None
    system_stats: dict
    code_hash: str | None
    needs_update: bool
    created_at: datetime
    updated_at: datetime


class WorkerCreateResponse(WorkerResponse):
    api_key: str


class BatchUpdateRequest(BaseModel):
    worker_ids: list[str]


class HeartbeatRequest(BaseModel):
    system_stats: dict = {}
    code_hash: str | None = None


class HeartbeatResponse(BaseModel):
    status: str
