from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.task import ScrapedLink, ScrapedPage
from app.models.user import User
from app.models.website import Website
from app.schemas.website import WebsiteCreate, WebsiteResponse

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
