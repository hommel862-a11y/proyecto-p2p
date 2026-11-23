import os

CELERY_CONFIG = {
    "broker_url": os.getenv("REDIS_URL", "redis://localhost:6389/0"),
    "result_backend": os.getenv("REDIS_URL", "redis://localhost:6389/0"),
    "timezone": "America/Caracas",
    "enable_utc": False,
    "worker_concurrency": 1,
    "worker_prefetch_multiplier": 1,
    "task_acks_late": True,
    "task_reject_on_worker_lost": True,
    "task_queues": {
        "video_heavy": {
            "exchange": "video_heavy",
            "routing_key": "video_heavy",
            "max_concurrency": 1,
        },
        "light_io": {
            "exchange": "light_io",
            "routing_key": "light_io",
            "max_concurrency": 2,
        },
    },
}
