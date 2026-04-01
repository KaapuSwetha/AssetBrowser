# utils/redis_conn.py
import time, os
import redis
from utils.logger import get_logger
from django.conf import settings

logger = get_logger(__name__)

def get_redis(retries: int = 3, delay: float = 0.5) -> redis.Redis:
    """Return a Redis connection with small retry window."""
    url = getattr(settings, "REDIS_URL", "redis://127.0.0.1:6379/3")
    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            r = redis.Redis.from_url(
                url,
                decode_responses=True,
                socket_timeout=float(os.getenv("REDIS_SOCKET_TIMEOUT", "2")),
                socket_connect_timeout=float(os.getenv("REDIS_CONNECT_TIMEOUT", "2")),
            )
            r.ping()
            if attempt > 1:
                logger.warning("Redis connection recovered after %s attempts", attempt)
            return r
        except Exception as e:
            last_exc = e
            logger.error("Redis connect attempt %s failed: %s", attempt, e)
            time.sleep(delay)
    logger.critical("Redis connection failed after %s retries", retries)
    raise last_exc

