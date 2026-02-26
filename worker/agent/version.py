import hashlib
from pathlib import Path


def compute_code_hash() -> str:
    agent_dir = Path(__file__).parent
    source_files = sorted(agent_dir.rglob("*.py"))

    hasher = hashlib.sha256()
    for path in source_files:
        relative = str(path.relative_to(agent_dir))
        hasher.update(relative.encode())
        hasher.update(path.read_bytes())

    return hasher.hexdigest()[:16]


AGENT_CODE_HASH = compute_code_hash()
