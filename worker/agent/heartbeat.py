import asyncio
import platform

import httpx


async def heartbeat_loop(config):
    async with httpx.AsyncClient() as client:
        while True:
            try:
                stats = {
                    "hostname": platform.node(),
                }
                resp = await client.post(
                    f"{config.CONTROL_SERVER_URL}/api/worker-agent/heartbeat",
                    json={"system_stats": stats},
                    headers={"Authorization": f"Bearer {config.WORKER_API_KEY}"},
                    timeout=10,
                )
                if resp.status_code == 200:
                    print("Heartbeat OK")
                else:
                    print(f"Heartbeat failed: {resp.status_code}")
            except Exception as e:
                print(f"Heartbeat error: {e}")

            await asyncio.sleep(config.HEARTBEAT_INTERVAL)
