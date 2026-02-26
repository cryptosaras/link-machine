"""Add code_hash and needs_update to workers

Revision ID: 003
Revises: 002
Create Date: 2026-02-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("workers", sa.Column("code_hash", sa.String(16), nullable=True))
    op.add_column("workers", sa.Column("needs_update", sa.Boolean(), server_default=sa.text("false"), nullable=False))


def downgrade() -> None:
    op.drop_column("workers", "needs_update")
    op.drop_column("workers", "code_hash")
