"""Change scraped_links and scraped_pages task_id FK from CASCADE to SET NULL

Revision ID: 008
Revises: 007
Create Date: 2026-02-27
"""
from typing import Sequence, Union

from alembic import op

revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # scraped_links: task_id CASCADE -> SET NULL
    op.drop_constraint("scraped_links_task_id_fkey", "scraped_links", type_="foreignkey")
    op.alter_column("scraped_links", "task_id", nullable=True)
    op.create_foreign_key(
        "scraped_links_task_id_fkey", "scraped_links",
        "tasks", ["task_id"], ["id"], ondelete="SET NULL",
    )

    # scraped_pages: task_id CASCADE -> SET NULL
    op.drop_constraint("scraped_pages_task_id_fkey", "scraped_pages", type_="foreignkey")
    op.alter_column("scraped_pages", "task_id", nullable=True)
    op.create_foreign_key(
        "scraped_pages_task_id_fkey", "scraped_pages",
        "tasks", ["task_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    # scraped_pages: revert to CASCADE
    op.drop_constraint("scraped_pages_task_id_fkey", "scraped_pages", type_="foreignkey")
    op.alter_column("scraped_pages", "task_id", nullable=False)
    op.create_foreign_key(
        "scraped_pages_task_id_fkey", "scraped_pages",
        "tasks", ["task_id"], ["id"], ondelete="CASCADE",
    )

    # scraped_links: revert to CASCADE
    op.drop_constraint("scraped_links_task_id_fkey", "scraped_links", type_="foreignkey")
    op.alter_column("scraped_links", "task_id", nullable=False)
    op.create_foreign_key(
        "scraped_links_task_id_fkey", "scraped_links",
        "tasks", ["task_id"], ["id"], ondelete="CASCADE",
    )
