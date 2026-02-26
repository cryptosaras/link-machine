import asyncio
import io

import asyncssh
import redis.asyncio as aioredis
from sqlalchemy import select

from app.config import settings
from app.models.worker import Worker


def build_provision_script(control_server_url: str, worker_api_key: str) -> str:
    return f"""#!/bin/bash
set -e

echo "=== Updating system packages ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

echo "=== Installing UFW firewall ==="
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw --force enable
echo "Firewall configured: deny incoming, allow outgoing, allow SSH"

echo "=== Installing Docker ==="
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo "Docker installed successfully"
else
    echo "Docker already installed, skipping"
fi

echo "=== Installing Docker Compose plugin ==="
if ! docker compose version &> /dev/null; then
    apt-get install -y docker-compose-plugin
    echo "Docker Compose plugin installed"
else
    echo "Docker Compose already available"
fi

echo "=== Creating worker directory ==="
mkdir -p /opt/link-machine-worker/agent

echo "=== Writing worker configuration ==="
cat > /opt/link-machine-worker/.env << 'ENVEOF'
CONTROL_SERVER_URL={control_server_url}
WORKER_API_KEY={worker_api_key}
HEARTBEAT_INTERVAL=30
ENVEOF

echo "=== Writing worker agent code ==="
cat > /opt/link-machine-worker/requirements.txt << 'REQEOF'
httpx>=0.28.0
pydantic-settings>=2.7.0
REQEOF

cat > /opt/link-machine-worker/agent/__init__.py << 'INITEOF'
INITEOF

cat > /opt/link-machine-worker/agent/config.py << 'CFGEOF'
from pydantic_settings import BaseSettings

class WorkerConfig(BaseSettings):
    CONTROL_SERVER_URL: str
    WORKER_API_KEY: str
    HEARTBEAT_INTERVAL: int = 30
    model_config = {{"env_file": ".env"}}
CFGEOF

cat > /opt/link-machine-worker/agent/heartbeat.py << 'HBEOF'
import asyncio
import platform
import httpx

async def heartbeat_loop(config):
    async with httpx.AsyncClient() as client:
        while True:
            try:
                stats = {{
                    "hostname": platform.node(),
                }}
                resp = await client.post(
                    f"{{config.CONTROL_SERVER_URL}}/api/worker-agent/heartbeat",
                    json={{"system_stats": stats}},
                    headers={{"Authorization": f"Bearer {{config.WORKER_API_KEY}}"}},
                    timeout=10,
                )
                if resp.status_code == 200:
                    print(f"Heartbeat OK")
                else:
                    print(f"Heartbeat failed: {{resp.status_code}}")
            except Exception as e:
                print(f"Heartbeat error: {{e}}")
            await asyncio.sleep(config.HEARTBEAT_INTERVAL)
HBEOF

cat > /opt/link-machine-worker/agent/main.py << 'MAINEOF'
import asyncio
from agent.config import WorkerConfig
from agent.heartbeat import heartbeat_loop

async def main():
    config = WorkerConfig()
    print(f"Worker agent starting. Control server: {{config.CONTROL_SERVER_URL}}")
    await heartbeat_loop(config)

if __name__ == "__main__":
    asyncio.run(main())
MAINEOF

cat > /opt/link-machine-worker/Dockerfile << 'DKEOF'
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY agent/ ./agent/
COPY .env .
CMD ["python", "-m", "agent.main"]
DKEOF

cat > /opt/link-machine-worker/docker-compose.yml << 'DCEOF'
services:
  worker:
    build: .
    restart: unless-stopped
    container_name: lm-worker
DCEOF

echo "=== Building worker Docker image ==="
cd /opt/link-machine-worker
docker compose build

echo "=== Starting worker container ==="
docker compose up -d

echo "=== Verifying worker is running ==="
sleep 2
if docker ps | grep -q lm-worker; then
    echo "Worker container is running"
else
    echo "WARNING: Worker container may not have started properly"
    docker compose logs
fi

echo "=== Installation complete ==="
"""


async def provision_worker(
    ssh_host: str,
    ssh_user: str,
    ssh_port: int,
    ssh_password: str | None,
    ssh_key: str | None,
    worker_api_key: str,
    control_server_url: str,
    worker_id: str,
    db_session_factory,
):
    r = aioredis.from_url(settings.REDIS_URL)
    log_lines: list[str] = []
    final_status = "error"

    async def publish(line: str):
        log_lines.append(line)
        await r.publish(f"install:{worker_id}", line)

    try:
        connect_kwargs: dict = {
            "host": ssh_host,
            "port": ssh_port,
            "username": ssh_user,
            "known_hosts": None,
        }
        if ssh_password:
            connect_kwargs["password"] = ssh_password
        if ssh_key:
            connect_kwargs["client_keys"] = [asyncssh.import_private_key(ssh_key)]

        await publish("Connecting to VPS...")

        async with asyncssh.connect(**connect_kwargs) as conn:
            await publish(f"Connected to {ssh_host} as {ssh_user}")
            await publish("Starting installation...")

            script = build_provision_script(control_server_url, worker_api_key)

            result = await conn.create_process("bash -s", input=script)

            async def read_stream(stream, prefix=""):
                async for line in stream:
                    stripped = line.rstrip()
                    if stripped:
                        await publish(f"{prefix}{stripped}")

            await asyncio.gather(
                read_stream(result.stdout),
                read_stream(result.stderr, "[stderr] "),
            )
            await result.wait()

            if result.exit_status == 0:
                await publish("__DONE__ Installation completed successfully.")
                final_status = "offline"  # Will go online once heartbeat arrives
            else:
                await publish(f"__ERROR__ Installation failed with exit code {result.exit_status}")
                final_status = "error"

    except Exception as e:
        await publish(f"__ERROR__ Connection failed: {str(e)}")
        final_status = "error"
    finally:
        # Update worker status and install log in DB
        try:
            async with db_session_factory() as db:
                db_result = await db.execute(
                    select(Worker).where(Worker.id == worker_id)
                )
                worker = db_result.scalar_one_or_none()
                if worker:
                    worker.status = final_status
                    worker.install_log = "\n".join(log_lines)
                    await db.commit()
        except Exception:
            pass

        await r.aclose()
