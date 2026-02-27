"""
Captures stdout/stderr and sends log batches to the control server.
"""
import asyncio
import io
import sys
import threading
from collections import deque


class LogInterceptor(io.TextIOBase):
    """Wraps an original stream, copying lines to a shared buffer."""

    def __init__(self, original, buffer, prefix=""):
        self._original = original
        self._buffer = buffer
        self._prefix = prefix

    def write(self, text):
        if text and text.strip():
            for line in text.splitlines():
                stripped = line.rstrip()
                if stripped:
                    self._buffer.append(f"{self._prefix}{stripped}")
        if self._original:
            return self._original.write(text)
        return len(text)

    def flush(self):
        if self._original:
            self._original.flush()

    def isatty(self):
        return False


class LogCapture:
    """Buffers stdout/stderr and flushes batches to the backend."""

    def __init__(self, max_buffer=2000):
        self._buffer = deque(maxlen=max_buffer)
        self._lock = threading.Lock()
        self._original_stdout = sys.stdout
        self._original_stderr = sys.stderr

    def install(self):
        sys.stdout = LogInterceptor(self._original_stdout, self._buffer)
        sys.stderr = LogInterceptor(self._original_stderr, self._buffer, prefix="[stderr] ")

    def drain(self):
        with self._lock:
            lines = list(self._buffer)
            self._buffer.clear()
            return lines

    async def flush_loop(self, client, config):
        """Periodically send buffered log lines to the backend."""
        base = config.CONTROL_SERVER_URL.rstrip("/")
        headers = {"Authorization": f"Bearer {config.WORKER_API_KEY}"}

        while True:
            await asyncio.sleep(5)
            lines = self.drain()
            if not lines:
                continue
            try:
                await client.post(
                    f"{base}/api/worker-agent/logs",
                    json={"lines": lines},
                    headers=headers,
                    timeout=10,
                )
            except Exception:
                pass  # Don't print here to avoid infinite loop
