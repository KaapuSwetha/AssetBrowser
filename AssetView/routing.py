from django.urls import re_path
from .consumers.asset_update import AssetUpdateConsumer, NotificationsConsumer

from .consumers.presence import PresenceConsumer

websocket_urlpatterns = [
    # Broadcasts when a publish JSON appears/changes
    re_path(r"^ws/asset-updates/?$", AssetUpdateConsumer.as_asgi(), name="ws_asset_updates"),

    # Lightweight, fan-out notifications (status changes, publishes, etc.)
    re_path(r"^ws/notifications/?$", NotificationsConsumer.as_asgi(), name="ws_notifications"),

    # Optional presence channel (typing/online indicators, heartbeats)
    re_path(r"^ws/presence/?$", PresenceConsumer.as_asgi(), name="ws_presence"),
]
