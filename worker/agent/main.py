import asyncio

from agent.config import WorkerConfig
from agent.heartbeat import heartbeat_loop


async def main():
    config = WorkerConfig()
    print(f"Worker agent starting. Control server: {config.CONTROL_SERVER_URL}")
    await heartbeat_loop(config)


if __name__ == "__main__":
    asyncio.run(main())
