import os
from utils.logger import get_logger
from django.core.wsgi import get_wsgi_application

DJANGO_ENV = os.environ.get('DJANGO_ENV', 'dev').lower()
if DJANGO_ENV == 'prod':
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'AssetBrowser.settings.prod')
else:
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'AssetBrowser.settings.dev')

logger = get_logger(__name__)
logger.info("Starting WSGI application (env=%s)", DJANGO_ENV)

application = get_wsgi_application()
