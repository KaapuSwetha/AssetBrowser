# AssetView/consumers/asset_update.py
import json
from channels.generic.websocket import AsyncWebsocketConsumer, AsyncJsonWebsocketConsumer
from asgiref.sync import sync_to_async

from utils.logger import get_logger

logger = get_logger(__name__)

_NOTIF_GROUP = "notifications"


def _get_redis_url():
    """
    Resolve Redis URL lazily (safe when settings not configured at import time).
    """
    try:
        from django.conf import settings
        # prefer explicit REDIS_URL setting, otherwise fallback to channel layer host/port if present
        redis_url = getattr(settings, "REDIS_URL", None)
        if not redis_url:
            # safe fallback: try to read channel layers if they exist, otherwise default localhost
            cl = getattr(settings, "CHANNEL_LAYERS", None)
            if cl:
                try:
                    host, port = cl["default"]["CONFIG"]["hosts"][0]
                    redis_url = f"redis://{host}:{port}/3"
                except Exception:
                    redis_url = "redis://127.0.0.1:6379/3"
            else:
                redis_url = "redis://127.0.0.1:6379/3"
        return redis_url
    except Exception:
        return "redis://127.0.0.1:6379/3"


@sync_to_async
def mark_active(session_key: str, ttl: int = 180):
    try:
        import redis
        redis_url = _get_redis_url()
        r = redis.Redis.from_url(redis_url)
        r.set(f"artist_active:{session_key}", "1", ex=ttl)
    except Exception as e:
        logger.exception("mark_active failed for %s: %s", session_key, e)


@sync_to_async
def mark_inactive(session_key: str):
    try:
        import redis
        redis_url = _get_redis_url()
        r = redis.Redis.from_url(redis_url)
        r.delete(f"artist_active:{session_key}")
    except Exception as e:
        logger.exception("mark_inactive failed for %s: %s", session_key, e)


class AssetUpdateConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        session = self.scope.get("session")
        self.session_key = getattr(session, "session_key", None) or self.channel_name
        try:
            await self.channel_layer.group_add("asset_updates", self.channel_name)
            await self.accept()
            await mark_active(self.session_key)
            logger.info("WebSocket connected (asset_updates) session=%s channel=%s", self.session_key,
                        self.channel_name)
        except Exception as exc:
            logger.exception("Failed to accept websocket (asset_updates): %s", exc)
            await self.close(code=1011)

    async def disconnect(self, code):
        try:
            await self.channel_layer.group_discard("asset_updates", self.channel_name)
            await mark_inactive(self.session_key)
            logger.info("WebSocket disconnected (asset_updates) session=%s code=%s", self.session_key, code)
        except Exception as exc:
            logger.exception("Error during websocket disconnect: %s", exc)

    async def asset_update(self, event):
        try:
            payload = {
                "path": event.get("path"),
                "version": event.get("version"),
                "timestamp": event.get("timestamp"),
                "action": event.get("action"),
            }
            if not payload["path"]:
                logger.warning("asset_update event missing path: %s", event)
                return
            await self.send(text_data=json.dumps(payload))
            logger.debug("Sent asset_update to session=%s payload=%s", self.session_key, payload)
        except Exception as exc:
            logger.exception("Failed to send asset_update: %s", exc)


class NotificationsConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        await self.channel_layer.group_add(_NOTIF_GROUP, self.channel_name)
        await self.accept()
        logger.debug("Notifications WS connected: %s", self.channel_name)

    async def disconnect(self, code):
        await self.channel_layer.group_discard(_NOTIF_GROUP, self.channel_name)
        logger.debug("Notifications WS disconnected: %s", self.channel_name)

    async def notify(self, event):
        # Expected event: {"type": "notify", "data": {...}}
        await self.send_json({"action": "notification", "data": event.get("data", {})})
