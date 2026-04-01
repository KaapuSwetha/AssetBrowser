#!/usr/bin/env python
import os
import sys
from utils.logger import get_logger

def main():
    DJANGO_ENV = os.environ.get('DJANGO_ENV', 'dev').lower()
    if DJANGO_ENV == 'prod':
        os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'AssetBrowser.settings.prod')
    else:
        os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'AssetBrowser.settings.dev')

    logger = get_logger(__name__)
    logger.info("Starting manage.py with DJANGO_ENV=%s", DJANGO_ENV)

    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        logger.exception("Django import error: %s", exc)
        raise
    execute_from_command_line(sys.argv)

if __name__ == '__main__':
    main()
