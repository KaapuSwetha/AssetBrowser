# AssetBrowser/celery.py
"""
Celery bootstrap for the AssetBrowser project.
Configures the Celery app, discovers task modules,
and registers periodic jobs for cleanup and daily digest.
"""

import os
from celery import Celery
from celery.schedules import crontab
from utils.logger import get_logger
from django.conf import settings

logger = get_logger(__name__)

# ---------------------------------------------------------------------
# 1) Select settings module based on DJANGO_ENV
# ---------------------------------------------------------------------
DJANGO_ENV = os.environ.get("DJANGO_ENV", "dev").lower()
if DJANGO_ENV == "prod":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "AssetBrowser.settings.prod")
else:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "AssetBrowser.settings.dev")

logger.info("Booting Celery app (env=%s)", DJANGO_ENV)

# ---------------------------------------------------------------------
# 2) Create Celery app and load config from Django settings
# ---------------------------------------------------------------------
app = Celery("AssetBrowser")
# Pull all CELERY_* from Django settings
app.config_from_object("django.conf:settings", namespace="CELERY")
app.conf.imports = getattr(settings, "CELERY_IMPORTS", ())

app.conf.task_routes = {
    "notifications.*": {"queue": "notifications"},
    "utils.tasks.send_email_task": {"queue": "emails"},
    "*": {"queue": "default"},
}
# Conservative, production-friendly defaults
app.conf.task_annotations = {
    "*": {"max_retries": 5, "default_retry_delay": 10}
}

# ---------------------------------------------------------------------
# 4) Autodiscover tasks in installed apps and utils packages
# ---------------------------------------------------------------------
app.autodiscover_tasks()
logger.info("Celery task discovery complete")

# ---------------------------------------------------------------------
# 5) Beat schedule (periodic jobs)
#    NOTE: Task names must match the registered task path
#          (module + function) unless you set name=... in @shared_task.
# ---------------------------------------------------------------------
app.conf.beat_schedule = {
    "cleanup-old-notifications": {
        # FIX: use the correct module-qualified task name
        "task": "notifications.cleanup_old",
        "schedule": crontab(hour=3, minute=0),
    },
    "daily-publish-digest": {
        # FIX: use the correct module-qualified task name
        "task": "notifications.daily_digest",
        "schedule": crontab(hour=8, minute=0),
    },
}
logger.info("Celery beat schedule registered: %s", list(app.conf.beat_schedule.keys()))

# ---------------------------------------------------------------------
# 6) Broker & result backend visibility
# ---------------------------------------------------------------------
logger.info("Celery configured (broker=%s, backend=%s)", app.conf.broker_url, app.conf.result_backend)


# ---------------------------------------------------------------------
# 7) Optional: debugging task
# ---------------------------------------------------------------------
@app.task(bind=True)
def debug_task(self):
    logger.debug("Debug task executed from Celery: %s", self.request.id)
    return f"Debug OK ({self.request.id})"
