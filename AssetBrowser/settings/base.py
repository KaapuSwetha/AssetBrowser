# base.py
import os
import logging
from pathlib import Path
import environ
from utils.config import load_config
from utils.logger import configure_logging, get_logger

# ---------------------------------------------------------------------
# Base Paths
# ---------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent.parent

CONFIG_FILE = os.getenv("CONFIG_FILE", str(BASE_DIR / "config" / "config.yaml"))
# CONFIG_FILE = Path(r"C:\Users\swetha\AssetBrowser\config\config.yaml")
FFMPEG_BIN = os.getenv("FFMPEG_BIN", "ffmpeg")
OIIO_BIN = os.getenv("OIIO_BIN", "oiiotool")
# ---------------------------------------------------------------------
# Environment setup
# ---------------------------------------------------------------------
env = environ.Env()
ENV_FILE = BASE_DIR / ".env"
if ENV_FILE.exists():
    env.read_env(str(ENV_FILE))

DJANGO_ENV = env.str("DJANGO_ENV", default=os.environ.get("ENV", "dev")).lower()

# ---------------------------------------------------------------------
# Load YAML config and apply environment overrides
# ---------------------------------------------------------------------
CONFIG = load_config(config_path=str(CONFIG_FILE), reload_on_change=True)
ENV_CONFIG = CONFIG.get("env", {}).get(DJANGO_ENV, {})

for section in ["app", "logging", "email", "projects", "admins", "sessions"]:
    if section in ENV_CONFIG:
        CONFIG[section] = {**CONFIG.get(section, {}), **ENV_CONFIG[section]}

# ---------------------------------------------------------------------
# Application Info
# ---------------------------------------------------------------------
APP_NAME = CONFIG.get("app", {}).get("name", "AssetBrowser")
DEBUG = env.bool("DEBUG", default=CONFIG.get("app", {}).get("debug", True))

# ---------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------
LOG_LEVEL = logging.DEBUG if DEBUG else logging.INFO
LOG_DIR = Path(CONFIG.get("logging", {}).get("log_dir", BASE_DIR / "logs"))
LOG_FILE_NAME = CONFIG.get("logging", {}).get("file_name", "app.json.log")
MAIL_ON_ERROR = bool(CONFIG.get("logging", {}).get("log_errors_via_email", False))
ADMINS = [(a.get("name"), a.get("email")) for a in CONFIG.get("admins", []) if a.get("email")]

smtp_conf = {
    "host": os.environ.get("EMAIL_HOST", CONFIG.get("email", {}).get("host")),
    "port": int(os.environ.get("EMAIL_PORT", CONFIG.get("email", {}).get("port", 25))),
    "user": os.environ.get("EMAIL_HOST_USER", ""),
    "password": os.environ.get("EMAIL_HOST_PASSWORD", ""),
    "use_tls": bool(os.environ.get("EMAIL_USE_TLS", CONFIG.get("email", {}).get("use_tls", False))),
}

configure_logging(
    level=LOG_LEVEL,
    json_output=CONFIG.get("logging", {}).get("json", True),
    log_dir=LOG_DIR,
    file_name=str(LOG_DIR / LOG_FILE_NAME),
    file_max_bytes=int(CONFIG.get("logging", {}).get("max_bytes", 20 * 1024 * 1024)),
    file_backup_count=int(CONFIG.get("logging", {}).get("backup_count", 14)),
    console=True,
    file=True,
    mail_on_error=MAIL_ON_ERROR,
    admins=ADMINS,
    email_from=CONFIG.get("email", {}).get("default_from") or os.environ.get("DEFAULT_FROM_EMAIL"),
    smtp_config=smtp_conf,
    emergency_sentinel=CONFIG.get("logging", {}).get("emergency_sentinel"),
    emergency_shutdown=bool(CONFIG.get("logging", {}).get("emergency_shutdown_on_critical", False)),
)

logger = get_logger(__name__)
logger.info("%s Logger configured. LOG_DIR=%s", APP_NAME, LOG_DIR)

# ---------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------
BASE_PROJECT_PATH = CONFIG.get("projects", {}).get("base_path", BASE_DIR / "projects")
ACTIVE_PROJECTS = CONFIG.get("projects", {}).get("active", [])
PROJECT_PATHS = [os.path.join(BASE_PROJECT_PATH, p) for p in ACTIVE_PROJECTS]
logger.info("%s Active projects: %s", APP_NAME, ACTIVE_PROJECTS)

STATUS_UPDATE_HOLDERS = CONFIG.get("status_update", {}).get("holders", [])
IP_TO_USER = CONFIG.get("status_update", {}).get("ip_to_user", {})

TREE_CACHE_KEY = "asset_project_tree_v1"
TREE_CACHE_TTL_SECONDS = 10

# ---------------------------------------------------------------------
# Django Core
# ---------------------------------------------------------------------
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "unsafe-default-key")
ALLOWED_HOSTS = ["assetbrowser-1asu.onrender.com", ".onrender.com", "127.0.0.1", "localhost", "0.0.0.0"]
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # Third-party
    'channels',
    'django_browser_reload',  # only in dev
    'tailwind',

    # Local apps
    'theme',  # must come before AssetView
    'AssetView',
]

# ---------------------------------------------------------------------
# Tailwind
# ---------------------------------------------------------------------
TAILWIND_APP_NAME = 'theme'
NPM_BIN_PATH = "npm"

# ---------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'utils.middleware.session_activity.SessionIdleTimeoutMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'django_browser_reload.middleware.BrowserReloadMiddleware',
]
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'
ROOT_URLCONF = 'AssetBrowser.urls'
WSGI_APPLICATION = 'AssetBrowser.wsgi.application'
ASGI_APPLICATION = 'AssetBrowser.asgi.application'

# ---------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------
TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'DIRS': [BASE_DIR / 'AssetView' / 'templates'],
    'APP_DIRS': True,
    'OPTIONS': {
        'context_processors': [
            'django.template.context_processors.debug',
            'django.template.context_processors.request',
            'django.contrib.auth.context_processors.auth',
            'django.contrib.messages.context_processors.messages',
        ],
    },
}]

# ---------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------
DATABASES = {
    'default': env.db(default=f'sqlite:///{BASE_DIR / "db.sqlite3"}')
}
CELERY_IMPORTS = (
    "tasks.notification_tasks",
    "tasks.email_tasks",
)
# ---------------------------------------------------------------------
# Static / Media
# ---------------------------------------------------------------------
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [BASE_DIR / 'theme' / 'static']

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'
REVIEW_MEDIA_ROOT = BASE_DIR / "media" / "cache"

# Binaries

OCIO_CONFIG = ""  # optional show config
REVIEW_ALLOW_HLS = False  # optional
# ---------------------------------------------------------------------
# Celery
# ---------------------------------------------------------------------
REDIS_HOST = env('REDIS_HOST', default='127.0.0.1')
REDIS_PORT = env.int('REDIS_PORT', default=6379)


CELERY_TASK_ACKS_LATE = True
CELERY_TASK_REJECT_ON_WORKER_LOST = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERYD_MAX_TASKS_PER_CHILD = 100
CELERY_TASK_RESULT_EXPIRES = 86400
CELERY_TIMEZONE = 'UTC'
CELERY_ENABLE_UTC = True
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]

# ---------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------
EMAIL_BACKEND = os.environ.get(
    "EMAIL_BACKEND", CONFIG.get("email", {}).get("backend", "django.core.mail.backends.smtp.EmailBackend")
)
EMAIL_HOST = os.environ.get("EMAIL_HOST", CONFIG.get("email", {}).get("host", "localhost"))
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", CONFIG.get("email", {}).get("port", 25)))
EMAIL_USE_TLS = bool(os.environ.get("EMAIL_USE_TLS", CONFIG.get("email", {}).get("use_tls", False)))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
DEFAULT_FROM_EMAIL = os.environ.get(
    "DEFAULT_FROM_EMAIL", CONFIG.get("email", {}).get("default_from", EMAIL_HOST_USER)
)

# ---------------------------------------------------------------------
# Redis (Channels + Cache)
# ---------------------------------------------------------------------
REDIS_URL = os.environ.get("REDIS_URL", "").strip() or None
REDIS_AVAILABLE = bool(REDIS_URL)

CELERY_BROKER_URL = os.environ.get(
    "CELERY_BROKER_URL",
    f"{REDIS_URL}?db=1" if REDIS_AVAILABLE else None,
)
CELERY_RESULT_BACKEND = os.environ.get(
    "CELERY_RESULT_BACKEND",
    f"{REDIS_URL}?db=2" if REDIS_AVAILABLE else None,
)

if REDIS_AVAILABLE:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {"hosts": [REDIS_URL]},
        },
    }
    CACHES = {
        "default": {
            "BACKEND": "django_redis.cache.RedisCache",
            "LOCATION": REDIS_URL,
            "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
        }
    }
else:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer",
        },
    }
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        }
    }
# ---------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------
SESSION_ENGINE = "django.contrib.sessions.backends.cache"
SESSION_CACHE_ALIAS = "default"
DEFAULT_SESSION_IDLE_TIMEOUT = int(
    os.environ.get("DEFAULT_SESSION_IDLE_TIMEOUT", CONFIG.get("sessions", {}).get("default_session_idle_timeout", 1800))
)
ARTIST_SESSION_IDLE_TIMEOUT = int(
    os.environ.get("ARTIST_SESSION_IDLE_TIMEOUT", CONFIG.get("sessions", {}).get("artist_session_idle_timeout", 21600))
)
SESSION_SAVE_EVERY_REQUEST = False
SESSION_HEARTBEAT_URL = CONFIG.get("sessions", {}).get("heartbeat_url", "/session/heartbeat/")
# add/merge into the default list in base.py
SESSION_IGNORED_PATH_PREFIXES = CONFIG.get(
    "sessions", {}
).get(
    "ignored_path_prefixes",
    [
        "/static/", "/media/", "/health", "/favicon.ico",
        "/__reload__/",
        "/ws/",
    ]
)

# ---------------------------------------------------------------------
# Safety check
# ---------------------------------------------------------------------
if DJANGO_ENV == "prod" and SECRET_KEY == "unsafe-default-key":
    logger.critical("Missing DJANGO_SECRET_KEY in production — aborting startup")
    raise RuntimeError("DJANGO_SECRET_KEY must be set in production!")

logger.info("%s Settings loaded for environment: %s (DEBUG=%s)", APP_NAME, DJANGO_ENV, DEBUG)
