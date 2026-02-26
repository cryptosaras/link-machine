import hashlib
from pathlib import Path


def compute_expected_worker_hash() -> str:
    worker_agent_dir = Path(__file__).parent.parent.parent.parent / "worker" / "agent"
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
