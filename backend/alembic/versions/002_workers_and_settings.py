"""Add workers and settings tables

Revision ID: 002
Revises: 001
Create Date: 2026-02-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "workers",
        sa.Column("id", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("ssh_host", sa.String(255), nullable=False),
        sa.Column("ssh_user", sa.String(100), nullable=False, server_default="root"),
        sa.Column("ssh_port", sa.Integer(), nullable=False, server_default=sa.text("22")),
        sa.Column("ssh_password_encrypted", sa.LargeBinary(), nullable=True),
        sa.Column("ssh_key_encrypted", sa.LargeBinary(), nullable=True),
        sa.Column("api_key", sa.String(255), unique=True, nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="offline"),
        sa.Column("last_heartbeat", sa.DateTime(timezone=True), nullable=True),
        sa.Column("system_stats", sa.JSON(), server_default=sa.text("'{}'")),
        sa.Column("install_log", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "settings",
        sa.Column("key", sa.String(255), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False, server_default=""),
    )

    op.execute("INSERT INTO settings (key, value) VALUES ('control_server_url', '')")


def downgrade() -> None:
    op.drop_table("settings")
    op.drop_table("workers")
