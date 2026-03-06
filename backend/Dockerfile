FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir \
    "fastapi>=0.115.0" \
    "uvicorn[standard]>=0.34.0" \
    "sqlalchemy[asyncio]>=2.0.0" \
    "asyncpg>=0.30.0" \
    "alembic>=1.14.0" \
    "pydantic-settings>=2.7.0" \
    "bcrypt>=4.2.0" \
    "pyjwt>=2.10.0" \
    "redis>=5.2.0" \
    "httpx>=0.28.0" \
    "asyncssh>=2.17.0" \
    "cryptography>=43.0.0" \
    "python-multipart>=0.0.9"

COPY . .

ENV PYTHONPATH=/app

CMD alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000
