import asyncio
import base64

import asyncssh
import redis.asyncio as aioredis
from pathlib import Path
from sqlalchemy import select

from app.config import settings
from app.models.worker import Worker

# Path to the canonical worker source files
# In Docker, the worker dir is mounted at /worker-source; locally, it's beside backend/
_docker_path = Path("/worker-source")
_local_path = Path(__file__).parent.parent.parent.parent / "worker"
WORKER_SOURCE_DIR = _docker_path if _docker_path.exists() else _local_path


def _read_worker_file(relative_path: str) -> str:
    """Read a file from the worker source directory."""
    file_path = WORKER_SOURCE_DIR / relative_path
    return file_path.read_text(encoding="utf-8")


def _encode_file(content: str) -> str:
    """Base64-encode file content for safe transfer via bash."""
    return base64.b64encode(content.encode("utf-8")).decode("ascii")


def build_provision_script(control_server_url: str, worker_api_key: str) -> str:
    # Read the actual source files so deployed code matches the expected hash
    agent_files = {
        "agent/__init__.py": _read_worker_file("agent/__init__.py"),
        "agent/version.py": _read_worker_file("agent/version.py"),
        "agent/config.py": _read_worker_file("agent/config.py"),
        "agent/heartbeat.py": _read_worker_file("agent/heartbeat.py"),
        "agent/main.py": _read_worker_file("agent/main.py"),
        "agent/task_runner.py": _read_worker_file("agent/task_runner.py"),
    }
    plugin_files = {}
    plugins_dir = WORKER_SOURCE_DIR / "plugins"
    if plugins_dir.exists():
        for f in plugins_dir.iterdir():
            if f.suffix == ".py":
                plugin_files[f"plugins/{f.name}"] = f.read_text(encoding="utf-8")

    requirements = _read_worker_file("requirements.txt")
    dockerfile = _read_worker_file("Dockerfile")

    # Build base64 write commands for each file
    file_writes = ""
    for rel_path, content in agent_files.items():
        encoded = _encode_file(content)
        file_writes += f'echo "{encoded}" | base64 -d > /opt/link-machine-worker/{rel_path}\n'

    plugin_writes = ""
    for rel_path, content in plugin_files.items():
        encoded = _encode_file(content)
        plugin_writes += f'echo "{encoded}" | base64 -d > /opt/link-machine-worker/{rel_path}\n'

    encoded_requirements = _encode_file(requirements)
    encoded_dockerfile = _encode_file(dockerfile)

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
mkdir -p /opt/link-machine-worker/plugins

echo "=== Writing worker configuration ==="
cat > /opt/link-machine-worker/.env << 'ENVEOF'
CONTROL_SERVER_URL={control_server_url}
WORKER_API_KEY={worker_api_key}
HEARTBEAT_INTERVAL=5
ENVEOF

echo "=== Writing worker agent code ==="
echo "{encoded_requirements}" | base64 -d > /opt/link-machine-worker/requirements.txt
{file_writes}
echo "=== Writing plugin code ==="
{plugin_writes}
echo "{encoded_dockerfile}" | base64 -d > /opt/link-machine-worker/Dockerfile

cat > /opt/link-machine-worker/docker-compose.yml << 'DCEOF'
services:
  worker:
    build: .
    restart: unless-stopped
    container_name: lm-worker
DCEOF

echo "=== Building worker Docker image ==="
cd /opt/link-machine-worker
docker compose build --no-cache

echo "=== Starting worker container ==="
docker compose up -d --force-recreate

echo "=== Verifying worker is running ==="
sleep 3
if docker ps | grep -q lm-worker; then
    echo "Worker container is running"
    docker compose logs --tail 5
else
    echo "WARNING: Worker container may not have started properly"
    docker compose logs
fi

echo "=== Installation complete ==="
"""


async def reset_worker_container(
    ssh_host: str,
    ssh_user: str,
    ssh_port: int,
    ssh_password: str | None,
    ssh_key: str | None,
    worker_id: str,
    db_session_factory,
):
    """SSH into worker and restart the Docker container to clear stuck state."""
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
            await publish("Stopping worker container...")

            script = """#!/bin/bash
set -e
cd /opt/link-machine-worker

echo "=== Stopping worker container ==="
docker compose down --timeout 10 || true

echo "=== Cleaning up stale processes ==="
docker rm -f lm-worker 2>/dev/null || true

echo "=== Starting worker container ==="
docker compose up -d --force-recreate

echo "=== Waiting for container startup ==="
sleep 3

if docker ps | grep -q lm-worker; then
    echo "Worker container is running"
    docker compose logs --tail 5
else
    echo "WARNING: Worker container may not have started properly"
    docker compose logs --tail 20
fi

echo "=== Reset complete ==="
"""
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
                await publish("__DONE__ Worker reset completed successfully.")
                final_status = "offline"
            else:
                await publish(f"__ERROR__ Reset failed with exit code {result.exit_status}")
                final_status = "error"

    except Exception as e:
        await publish(f"__ERROR__ Connection failed: {str(e)}")
        final_status = "error"
    finally:
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
