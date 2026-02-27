import hashlib
from pathlib import Path


def compute_code_hash() -> str:
    worker_dir = Path(__file__).parent.parent
    source_files = sorted(worker_dir.rglob("*.py"))

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


AGENT_CODE_HASH = compute_code_hash()
