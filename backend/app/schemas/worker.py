from datetime import datetime

from pydantic import BaseModel


class WorkerCreate(BaseModel):
    name: str
    ssh_host: str
    ssh_user: str = "root"
    ssh_port: int = 22
    ssh_password: str | None = None
    ssh_key: str | None = None
    use_saved_key: bool = False


class WorkerCurrentTask(BaseModel):
    id: str
    task_type: str
    status: str
    website_name: str | None = None
    progress: dict = {}
    started_at: datetime | None = None


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
    current_task: WorkerCurrentTask | None = None
    stats_history: list[dict] = []
    created_at: datetime
    updated_at: datetime


class WorkerCreateResponse(WorkerResponse):
    api_key: str


class BatchUpdateRequest(BaseModel):
    worker_ids: list[str]


class HeartbeatRequest(BaseModel):
    system_stats: dict = {}
    code_hash: str | None = None
    current_task_id: str | None = None


class HeartbeatResponse(BaseModel):
    status: str
    assigned_task: dict | None = None
