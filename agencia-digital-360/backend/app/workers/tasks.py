from contextlib import contextmanager
import threading
from typing import Iterator


class VideoWorkerBusyError(Exception):
    """Raised when a second heavy video job attempts to run while concurrency=1 slot is busy."""


class SingleConcurrencyVideoLock:
    """
    Architectural Constraint #4:
    Strict concurrency = 1 semaphore for heavy video rendering (MoneyPrinterTurbo,
    FFmpeg, faster-whisper, MediaPipe) so the host PC, Backend, and Frontend never freeze.
    """

    def __init__(self) -> None:
        self._mutex = threading.Lock()
        self._active_job_id: str | None = None

    @contextmanager
    def acquire(self, job_id: str) -> Iterator[str]:
        acquired = self._mutex.acquire(blocking=False)
        if not acquired:
            raise VideoWorkerBusyError(
                f"Concurrency=1 lock active (running='{self._active_job_id}', rejected='{job_id}')"
            )
        self._active_job_id = job_id
        try:
            yield job_id
        finally:
            self._active_job_id = None
            self._mutex.release()
