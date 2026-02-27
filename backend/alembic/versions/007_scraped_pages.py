"""Create scraped_pages table for page text extraction

Revision ID: 007
Revises: 006
Create Date: 2026-02-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "scraped_pages",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("website_id", sa.Uuid(), sa.ForeignKey("websites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id", sa.Uuid(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.String(2048), nullable=False),
        sa.Column("title", sa.String(1024), nullable=True),
        sa.Column("meta_description", sa.String(4096), nullable=True),
        sa.Column("body_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("website_id", "url", name="uq_scraped_pages_website_url"),
    )
    op.create_index("ix_scraped_pages_website_id", "scraped_pages", ["website_id"])


def downgrade() -> None:
    op.drop_index("ix_scraped_pages_website_id", table_name="scraped_pages")
    op.drop_table("scraped_pages")
