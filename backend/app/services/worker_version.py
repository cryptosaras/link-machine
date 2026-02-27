import hashlib
from pathlib import Path


def compute_expected_worker_hash() -> str:
    # In Docker, the worker dir is mounted at /worker-source; locally, it's beside backend/
    docker_path = Path("/worker-source")
    local_path = Path(__file__).parent.parent.parent.parent / "worker"
    worker_dir = docker_path if docker_path.exists() else local_path
    if not worker_dir.exists():
        return ""

    # Hash ALL Python files: agent + plugins
    source_files = sorted(worker_dir.rglob("*.py"))
    if not source_files:
        return ""

    hasher = hashlib.sha256()
    for path in source_files:
        relative = str(path.relative_to(worker_dir))
        hasher.update(relative.encode())
        hasher.update(path.read_bytes())

    # Also include requirements.txt
    req_file = worker_dir / "requirements.txt"
    if req_file.exists():
        hasher.update(b"requirements.txt")
        hasher.update(req_file.read_bytes())

    return hasher.hexdigest()[:16]


def get_expected_worker_hash() -> str:
    """Compute hash fresh every time so file changes are detected without restart."""
    return compute_expected_worker_hash()
