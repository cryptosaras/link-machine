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
    pages_count: int = 0
    created_at: datetime
    updated_at: datetime


class LinkItem(BaseModel):
    id: str
    url: str
    created_at: datetime


class PageItem(BaseModel):
    id: str
    url: str
    title: str | None
    meta_description: str | None
    body_text: str | None
    created_at: datetime


class PaginatedLinks(BaseModel):
    items: list[LinkItem]
    total: int
    page: int
    page_size: int


class PaginatedPages(BaseModel):
    items: list[PageItem]
    total: int
    page: int
    page_size: int


class BulkDeleteRequest(BaseModel):
    ids: list[str]
