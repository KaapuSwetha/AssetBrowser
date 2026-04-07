# AssetView/consumers/presence.py
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from utils.logger import get_logger

logger = get_logger(__name__)


def _get_redis_url():
    try:
        from django.conf import settings
        redis_url = getattr(settings, "REDIS_URL", None)
        if redis_url:
            return redis_url
        cl = getattr(settings, "CHANNEL_LAYERS", None)
        if cl:
            try:
                host, port = cl["default"]["CONFIG"]["hosts"][0]
                return f"redis://{host}:{port}/3"
            except Exception:
                return None
        return None
    except Exception:
        return None


@sync_to_async
def redis_mark_active(session_key: str, ttl: int = 180):
    try:
        import redis
        redis_url = _get_redis_url()
        if not redis_url:
            return
        r = redis.Redis.from_url(redis_url)
        r.set(f"artist_active:{session_key}", "1", ex=ttl)
    except Exception as e:
        logger.exception("redis_mark_active failed: %s", e)


@sync_to_async
def redis_mark_inactive(session_key: str):
    try:
        import redis
        redis_url = _get_redis_url()
        if not redis_url:
            return
        r = redis.Redis.from_url(redis_url)
        r.delete(f"artist_active:{session_key}")
    except Exception as e:
        logger.exception("redis_mark_inactive failed: %s", e)


class PresenceConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        session = self.scope.get("session")
        self.session_key = getattr(session, "session_key", None) or self.channel_name
        try:
            await self.accept()
            await redis_mark_active(self.session_key)
            logger.info("Presence connected session=%s", self.session_key)
        except Exception as exc:
            logger.exception("Failed to accept presence socket: %s", exc)
            await self.close(code=1011)

    async def disconnect(self, code):
        try:
            await redis_mark_inactive(self.session_key)
            logger.info("Presence disconnected session=%s code=%s", self.session_key, code)
        except Exception as exc:
            logger.exception("Presence disconnect error: %s", exc)

    async def receive(self, text_data=None, bytes_data=None):
        try:
            if text_data:
                data = json.loads(text_data)
                if data.get("type") == "heartbeat":
                    await redis_mark_active(self.session_key)
                    await self.send(text_data=json.dumps({"ok": True}))
        except Exception as exc:
            logger.exception("Error in Presence.receive: %s", exc)


class AssetUpdatesConsumer(AsyncJsonWebsocketConsumer):
    group_name = "asset_updates"

    async def connect(self):
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def broadcast_message(self, event):
        await self.send_json(event.get("data", {}))
