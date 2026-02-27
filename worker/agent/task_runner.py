"""
Task runner — loads and executes plugins, reports progress to control server.
"""
import asyncio
import importlib.util
import os

import httpx


PLUGIN_DIR = os.path.join(os.path.dirname(__file__), "..", "plugins")


async def execute_task(config, task_info):
    """
    Execute a task using the appropriate plugin.
    task_info: {"id", "task_type", "params", "website_url", "website_sitemap_url"}
    """
    task_id = task_info["id"]
    task_type = task_info["task_type"]
    params = task_info.get("params", {})
    params["website_url"] = task_info.get("website_url", "")
    params["website_sitemap_url"] = task_info.get("website_sitemap_url")

    base = config.CONTROL_SERVER_URL.rstrip("/")
    headers = {"Authorization": f"Bearer {config.WORKER_API_KEY}"}

    async with httpx.AsyncClient(timeout=30) as client:

        async def report_progress(progress_dict):
            try:
                await client.post(f"{base}/api/worker-agent/task-progress", json={
                    "task_id": task_id,
                    "progress": progress_dict,
                }, headers=headers)
            except Exception as e:
                print(f"Progress report error: {e}")

        async def report_complete(status, result_summary=None, error_message=None):
            for attempt in range(4):
                try:
                    await client.post(f"{base}/api/worker-agent/task-complete", json={
                        "task_id": task_id,
                        "status": status,
                        "result_summary": result_summary,
                        "error_message": error_message,
                    }, headers=headers)
                    return
                except Exception as e:
                    print(f"Complete report error (attempt {attempt + 1}): {e}")
                    if attempt < 3:
                        await asyncio.sleep(2 ** attempt)

        async def upload_links(urls):
            try:
                await client.post(f"{base}/api/worker-agent/task-links", json={
                    "task_id": task_id,
                    "urls": urls,
                }, headers=headers, timeout=60)
            except Exception as e:
                print(f"Link upload error: {e}")

        try:
            plugin_path = os.path.join(PLUGIN_DIR, f"{task_type}.py")
            if not os.path.exists(plugin_path):
                await report_complete("failed", error_message=f"Plugin not found: {task_type}")
                return

            spec = importlib.util.spec_from_file_location(f"plugins.{task_type}", plugin_path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

            print(f"Running plugin: {task_type} for task {task_id}")
            await module.run(params, report_progress, report_complete, upload_links)
            print(f"Plugin {task_type} completed for task {task_id}")

        except Exception as e:
            print(f"Plugin execution error: {e}")
            await report_complete("failed", error_message=f"Plugin error: {str(e)}")
