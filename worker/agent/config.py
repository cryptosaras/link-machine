from pydantic_settings import BaseSettings


class WorkerConfig(BaseSettings):
    CONTROL_SERVER_URL: str
    WORKER_API_KEY: str
    HEARTBEAT_INTERVAL: int = 5

    model_config = {"env_file": ".env"}
