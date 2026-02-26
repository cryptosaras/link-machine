import hashlib
from pathlib import Path


def compute_expected_worker_hash() -> str:
    # In Docker, the worker dir is mounted at /worker-source; locally, it's beside backend/
    docker_path = Path("/worker-source/agent")
    local_path = Path(__file__).parent.parent.parent.parent / "worker" / "agent"
    worker_agent_dir = docker_path if docker_path.exists() else local_path
    if not worker_agent_dir.exists():
        return ""
    source_files = sorted(worker_agent_dir.rglob("*.py"))
    if not source_files:
        return ""

    hasher = hashlib.sha256()
    for path in source_files:
        relative = str(path.relative_to(worker_agent_dir))
        hasher.update(relative.encode())
        hasher.update(path.read_bytes())

    return hasher.hexdigest()[:16]


EXPECTED_WORKER_HASH = compute_expected_worker_hash()
