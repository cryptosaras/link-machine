import asyncio
import platform

import httpx

from agent.version import AGENT_CODE_HASH


async def heartbeat_loop(config):
    async with httpx.AsyncClient() as client:
        while True:
            try:
                stats = {
                    "hostname": platform.node(),
                }
                base = config.CONTROL_SERVER_URL.rstrip("/")
                resp = await client.post(
                    f"{base}/api/worker-agent/heartbeat",
                    json={"system_stats": stats, "code_hash": AGENT_CODE_HASH},
                    headers={"Authorization": f"Bearer {config.WORKER_API_KEY}"},
                    timeout=10,
                )
                if resp.status_code == 200:
                    print(f"Heartbeat OK (hash: {AGENT_CODE_HASH})")
                else:
                    print(f"Heartbeat failed: {resp.status_code}")
            except Exception as e:
                print(f"Heartbeat error: {e}")

            await asyncio.sleep(config.HEARTBEAT_INTERVAL)
