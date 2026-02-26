from datetime import datetime
from pydantic import BaseModel


class ScrapeLinksParams(BaseModel):
    depth: int = 0
    max_pages: int = 10000
    concurrent: int = 30
    delay: float = 0.1
    timeout: float = 5.0
    use_sitemap: bool = False


class TaskCreate(BaseModel):
    website_id: str
    task_type: str
    params: dict = {}


class TaskResponse(BaseModel):
    id: str
    user_id: str
    website_id: str | None
    worker_id: str | None
    task_type: str
    status: str
    params: dict
    progress: dict
    result_summary: dict | None
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    website_name: str | None = None
    worker_name: str | None = None
