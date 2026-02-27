import asyncio
import platform

import httpx
import psutil

from agent.version import AGENT_CODE_HASH
from agent.task_runner import execute_task
from agent.log_capture import LogCapture


async def heartbeat_loop(config):
    current_task_id = None
    task_handle = None

    log_capture = LogCapture()
    log_capture.install()

    async with httpx.AsyncClient() as client:
        # Start log flush loop in background
        asyncio.create_task(log_capture.flush_loop(client, config))

        while True:
            # Check if running task has finished
            if task_handle is not None and task_handle.done():
                try:
                    task_handle.result()
                except Exception as e:
                    print(f"Task execution failed: {e}")
                current_task_id = None
                task_handle = None
                print("Task finished, worker idle")

            try:
                mem = psutil.virtual_memory()
                stats = {
                    "hostname": platform.node(),
                    "cpu_cores": psutil.cpu_count(logical=True),
                    "cpu_percent": psutil.cpu_percent(interval=None),
                    "ram_total_mb": round(mem.total / (1024 * 1024)),
                    "ram_percent": mem.percent,
                }
                base = config.CONTROL_SERVER_URL.rstrip("/")
                resp = await client.post(
                    f"{base}/api/worker-agent/heartbeat",
                    json={
                        "system_stats": stats,
                        "code_hash": AGENT_CODE_HASH,
                        "current_task_id": current_task_id,
                    },
                    headers={"Authorization": f"Bearer {config.WORKER_API_KEY}"},
                    timeout=10,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    print(f"Heartbeat OK (hash: {AGENT_CODE_HASH})")

                    if current_task_id is None and data.get("assigned_task"):
                        task_info = data["assigned_task"]
                        current_task_id = task_info["id"]
                        print(f"Received task: {task_info['task_type']} ({current_task_id})")
                        task_handle = asyncio.create_task(execute_task(config, task_info))
                else:
                    print(f"Heartbeat failed: {resp.status_code}")
            except Exception as e:
                print(f"Heartbeat error: {e}")

            await asyncio.sleep(config.HEARTBEAT_INTERVAL)
