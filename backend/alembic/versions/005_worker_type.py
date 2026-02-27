"""Add worker_type column to workers

Revision ID: 005
Revises: 004
Create Date: 2026-02-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "workers",
        sa.Column("worker_type", sa.String(20), nullable=False, server_default="custom"),
    )


def downgrade() -> None:
    op.drop_column("workers", "worker_type")
