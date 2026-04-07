# prod.py
from .base import *
from utils.logger import get_logger
import os

logger = get_logger(__name__)

DEBUG = False

# Safety: ensure secret key is not default
if SECRET_KEY == "unsafe-default-key":
    logger.critical("Missing DJANGO_SECRET_KEY in production — aborting startup")
    raise RuntimeError("DJANGO_SECRET_KEY must be set in production!")

ALLOWED_HOSTS = env.list(
    "DJANGO_ALLOWED_HOSTS",
    default=["assetbrowser-1asu.onrender.com", ".onrender.com"],
)

# Redis Channels layer
REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/1")
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [REDIS_URL],
            "capacity": 10000,
            "expiry": 10,
        },
    },
}

# CSRF and security
CSRF_TRUSTED_ORIGINS = [
    "https://assetbrowser-1asu.onrender.com",
    "http://assetbrowser-1asu.onrender.com",
]
# Celery & Email overrides
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", CELERY_BROKER_URL)
CELERY_RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", CELERY_RESULT_BACKEND)
EMAIL_HOST = os.environ.get("EMAIL_HOST", EMAIL_HOST)
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", EMAIL_PORT))
EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", str(EMAIL_USE_TLS)).lower() in ("1", "true", "yes")
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", EMAIL_HOST_USER)
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", EMAIL_HOST_PASSWORD)

# Production security headers
SECURE_HSTS_SECONDS = 2592000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_BROWSER_XSS_FILTER = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
X_FRAME_OPTIONS = "DENY"

if "django_browser_reload" in INSTALLED_APPS:
    INSTALLED_APPS.remove("django_browser_reload")

logger.info("Production settings loaded with Redis Channels and hardened security")



