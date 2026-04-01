# AssetBrowser/asgi.py
"""
ASGI entrypoint for the Asset Browser.

Key improvements:
- Environment set BEFORE importing Django or Channels modules.
- Secure WebSocket stack with AllowedHostsOriginValidator.
- Async-safe ClientIPMiddleware (ASGI 3 compatible).
- Clean, production-ready logging.
"""

import os
from utils.logger import get_logger

# ---------------------------------------------------------------------
# Configure Django environment early
# ---------------------------------------------------------------------
DJANGO_ENV = os.environ.get("DJANGO_ENV", "dev").lower()
if DJANGO_ENV == "prod":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "AssetBrowser.settings.prod")
else:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "AssetBrowser.settings.dev")

logger = get_logger(__name__)
logger.info("ASGI boot: environment=%s settings=%s",
            DJANGO_ENV, os.environ.get("DJANGO_SETTINGS_MODULE"))

# ---------------------------------------------------------------------
# Imports that depend on DJANGO_SETTINGS_MODULE
# ---------------------------------------------------------------------
from django.core.asgi import get_asgi_application  # noqa: E402
from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.auth import AuthMiddlewareStack  # noqa: E402
from channels.security.websocket import AllowedHostsOriginValidator  # noqa: E402
import AssetView.routing  # noqa: E402

# ---------------------------------------------------------------------
# ASGI 3.0 compliant middleware to add client IP
# ---------------------------------------------------------------------
class ClientIPMiddleware:
    """
    Adds scope["client_ip"] for downstream consumers.
    Compatible with ASGI 3 call signature: (scope, receive, send).
    """

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        client_ip = None
        try:
            # channels puts (host, port) in scope["client"]
            if scope.get("client"):
                client_ip = scope["client"][0]
            # Check for X-Forwarded-For header if behind proxy
            for k, v in scope.get("headers", []):
                if k == b"x-forwarded-for":
                    client_ip = v.decode("latin1").split(",")[0].strip()
                    break
        except Exception:
            pass

        scope["client_ip"] = client_ip or "0.0.0.0"
        await self.inner(scope, receive, send)

# ---------------------------------------------------------------------
# Compose WebSocket stack: ClientIP → AllowedHosts → Auth → URLRouter
# ---------------------------------------------------------------------
websocket_stack = ClientIPMiddleware(
    AllowedHostsOriginValidator(
        AuthMiddlewareStack(
            URLRouter(AssetView.routing.websocket_urlpatterns)
        )
    )
)

# ---------------------------------------------------------------------
# Final ASGI application
# ---------------------------------------------------------------------
application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": websocket_stack,
})
