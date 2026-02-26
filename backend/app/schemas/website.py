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
    created_at: datetime
    updated_at: datetime
