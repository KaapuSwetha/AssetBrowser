# # AssetBrowser/settings/dev.py
# from .base import *
# from utils.logger import get_logger

# logger = get_logger(__name__)
# DEBUG = True
# ALLOWED_HOSTS = [
#     '127.0.0.1',
#     'localhost',
#     '192.168.20.224'
# ]

# logger.info("Loaded development settings")
# AssetBrowser/settings/dev.py
from .base import *
from utils.logger import get_logger

logger = get_logger(__name__)

DEBUG = True

# Add both localhost and your specific IP
ALLOWED_HOSTS = [
    '127.0.0.1',
    'localhost',
    '192.168.20.224',
    'assetbrowser-1asu.onrender.com',
    '0.0.0.0',  # Allows all IPs (for testing)
]

# For development, you might want to add:
INTERNAL_IPS = [
    '127.0.0.1',
    'localhost',
    '192.168.20.224',
    "assetbrowser-1asu.onrender.com"
]

logger.info("Loaded development settings")