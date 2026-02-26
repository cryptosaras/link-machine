import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, JSON, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Worker(Base):
    __tablename__ = "workers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    ssh_host: Mapped[str] = mapped_column(String(255), nullable=False)
    ssh_user: Mapped[str] = mapped_column(String(100), nullable=False, default="root")
    ssh_port: Mapped[int] = mapped_column(Integer, nullable=False, default=22)
    ssh_password_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    ssh_key_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    api_key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="offline")
    last_heartbeat: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    system_stats: Mapped[dict] = mapped_column(JSON, default=dict)
    code_hash: Mapped[str | None] = mapped_column(String(16), nullable=True)
    needs_update: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    install_log: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
