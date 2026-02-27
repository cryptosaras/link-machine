from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.task import ScrapedLink, ScrapedPage
from app.models.user import User
from app.models.website import Website
from app.schemas.website import (
    BulkDeleteRequest,
    LinkItem,
    PageItem,
    PaginatedLinks,
    PaginatedPages,
    WebsiteCreate,
    WebsiteResponse,
)

router = APIRouter(prefix="/api/websites", tags=["websites"])


@router.get("", response_model=list[WebsiteResponse])
async def list_websites(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    links_count_sub = (
        select(
            ScrapedLink.website_id,
            func.count(ScrapedLink.id).label("links_count"),
        )
        .group_by(ScrapedLink.website_id)
        .subquery()
    )
    pages_count_sub = (
        select(
            ScrapedPage.website_id,
            func.count(ScrapedPage.id).label("pages_count"),
        )
        .group_by(ScrapedPage.website_id)
        .subquery()
    )
    result = await db.execute(
        select(
            Website,
            func.coalesce(links_count_sub.c.links_count, 0).label("links_count"),
            func.coalesce(pages_count_sub.c.pages_count, 0).label("pages_count"),
        )
        .outerjoin(links_count_sub, Website.id == links_count_sub.c.website_id)
        .outerjoin(pages_count_sub, Website.id == pages_count_sub.c.website_id)
        .where(Website.user_id == user.id)
        .order_by(Website.created_at.desc())
    )
    rows = result.all()
    return [
        WebsiteResponse(
            id=str(w.id),
            name=w.name,
            url=w.url,
            sitemap_url=w.sitemap_url,
            links_count=links_count,
            pages_count=pages_count,
            created_at=w.created_at,
            updated_at=w.updated_at,
        )
        for w, links_count, pages_count in rows
    ]


@router.post("", response_model=WebsiteResponse, status_code=status.HTTP_201_CREATED)
async def create_website(
    body: WebsiteCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    website = Website(
        user_id=user.id,
        name=body.name,
        url=body.url,
        sitemap_url=body.sitemap_url,
    )
    db.add(website)
    await db.commit()
    await db.refresh(website)
    return WebsiteResponse(
        id=str(website.id),
        name=website.name,
        url=website.url,
        sitemap_url=website.sitemap_url,
        links_count=0,
        pages_count=0,
        created_at=website.created_at,
        updated_at=website.updated_at,
    )


@router.delete("/{website_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_website(
    website_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Website).where(Website.id == website_id, Website.user_id == user.id)
    )
    website = result.scalar_one_or_none()
    if not website:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Website not found")
    await db.delete(website)
    await db.commit()


@router.delete("/{website_id}/links", status_code=status.HTTP_204_NO_CONTENT)
async def reset_website_links(
    website_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Website).where(Website.id == website_id, Website.user_id == user.id)
    )
    website = result.scalar_one_or_none()
    if not website:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Website not found")
    await db.execute(delete(ScrapedLink).where(ScrapedLink.website_id == website.id))
    await db.execute(delete(ScrapedPage).where(ScrapedPage.website_id == website.id))
    await db.commit()


async def _get_user_website(
    website_id: str, user: User, db: AsyncSession
) -> Website:
    result = await db.execute(
        select(Website).where(Website.id == website_id, Website.user_id == user.id)
    )
    website = result.scalar_one_or_none()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    return website


@router.get("/{website_id}", response_model=WebsiteResponse)
async def get_website(
    website_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    website = await _get_user_website(website_id, user, db)
    links_count = await db.scalar(
        select(func.count(ScrapedLink.id)).where(
            ScrapedLink.website_id == website.id
        )
    )
    pages_count = await db.scalar(
        select(func.count(ScrapedPage.id)).where(
            ScrapedPage.website_id == website.id
        )
    )
    return WebsiteResponse(
        id=str(website.id),
        name=website.name,
        url=website.url,
        sitemap_url=website.sitemap_url,
        links_count=links_count or 0,
        pages_count=pages_count or 0,
        created_at=website.created_at,
        updated_at=website.updated_at,
    )


@router.get("/{website_id}/links/list", response_model=PaginatedLinks)
async def list_website_links(
    website_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    search: str = Query("", max_length=200),
):
    website = await _get_user_website(website_id, user, db)
    base = select(ScrapedLink).where(ScrapedLink.website_id == website.id)
    count_base = select(func.count(ScrapedLink.id)).where(
        ScrapedLink.website_id == website.id
    )
    if search:
        base = base.where(ScrapedLink.url.ilike(f"%{search}%"))
        count_base = count_base.where(ScrapedLink.url.ilike(f"%{search}%"))
    total = await db.scalar(count_base) or 0
    offset = (page - 1) * page_size
    result = await db.execute(
        base.order_by(ScrapedLink.url).offset(offset).limit(page_size)
    )
    links = result.scalars().all()
    return PaginatedLinks(
        items=[
            LinkItem(id=str(l.id), url=l.url, created_at=l.created_at)
            for l in links
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/{website_id}/links/bulk-delete", status_code=204)
async def bulk_delete_links(
    website_id: str,
    body: BulkDeleteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    website = await _get_user_website(website_id, user, db)
    await db.execute(
        delete(ScrapedLink).where(
            ScrapedLink.website_id == website.id,
            ScrapedLink.id.in_(body.ids),
        )
    )
    await db.commit()


@router.get("/{website_id}/pages/list", response_model=PaginatedPages)
async def list_website_pages(
    website_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    search: str = Query("", max_length=200),
):
    website = await _get_user_website(website_id, user, db)
    base = select(ScrapedPage).where(ScrapedPage.website_id == website.id)
    count_base = select(func.count(ScrapedPage.id)).where(
        ScrapedPage.website_id == website.id
    )
    if search:
        like = f"%{search}%"
        search_filter = (
            ScrapedPage.url.ilike(like)
            | ScrapedPage.title.ilike(like)
            | ScrapedPage.meta_description.ilike(like)
        )
        base = base.where(search_filter)
        count_base = count_base.where(search_filter)
    total = await db.scalar(count_base) or 0
    offset = (page - 1) * page_size
    result = await db.execute(
        base.order_by(ScrapedPage.url).offset(offset).limit(page_size)
    )
    pages = result.scalars().all()
    return PaginatedPages(
        items=[
            PageItem(
                id=str(p.id),
                url=p.url,
                title=p.title,
                meta_description=p.meta_description,
                body_text=p.body_text,
                created_at=p.created_at,
            )
            for p in pages
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/{website_id}/pages/bulk-delete", status_code=204)
async def bulk_delete_pages(
    website_id: str,
    body: BulkDeleteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    website = await _get_user_website(website_id, user, db)
    await db.execute(
        delete(ScrapedPage).where(
            ScrapedPage.website_id == website.id,
            ScrapedPage.id.in_(body.ids),
        )
    )
    await db.commit()
