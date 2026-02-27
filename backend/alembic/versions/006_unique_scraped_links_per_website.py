"""Add unique constraint on scraped_links(website_id, url)

Revision ID: 006
Revises: 005
Create Date: 2026-02-27
"""
from typing import Sequence, Union

from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Remove any existing duplicates first (keep the earliest one per website+url)
    op.execute("""
        DELETE FROM scraped_links
        WHERE id NOT IN (
            SELECT DISTINCT ON (website_id, url) id
            FROM scraped_links
            ORDER BY website_id, url, created_at ASC
        )
    """)
    op.create_unique_constraint(
        "uq_scraped_links_website_url",
        "scraped_links",
        ["website_id", "url"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_scraped_links_website_url", "scraped_links", type_="unique")
