from datetime import datetime

from pydantic import BaseModel, HttpUrl


class WebsiteCreate(BaseModel):
    name: str
    url: str
    sitemap_url: str | None = None


class WebsiteResponse(BaseModel):
    id: str
    name: str
    url: str
    sitemap_url: str | None
    links_count: int = 0
    created_at: datetime
    updated_at: datetime
