# utils/notifications.py

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import List, Dict

from utils.logger import get_logger
from utils.redis_conn import get_redis

logger = get_logger(__name__)

LIST_KEY = "AssetBrowser:notifications"
SEEN_KEY_PREFIX = "AssetBrowser:seen:"


def _make_id(item: Dict) -> str:
    return f"{item.get('timestamp', '')}-{item.get('path', '')}-{item.get('status', '')}"


def push_notification(item: Dict) -> None:
    try:
        r = get_redis()
        payload = dict(item)
        payload["timestamp"] = payload.get("timestamp") or datetime.now(timezone.utc).isoformat()
        payload["id"] = _make_id(payload)
        r.lpush(LIST_KEY, json.dumps(payload))
        r.ltrim(LIST_KEY, 0, 1999)
        logger.debug("push_notification ok id=%s", payload["id"])
    except Exception as e:
        logger.exception("push_notification failed: %s", e)


def list_recent(days: int = 3, requester_ip: str = "", unread_only: bool = False, hide_self: bool = True) -> List[Dict]:
    try:
        r = get_redis()
        raw = r.lrange(LIST_KEY, 0, -1)
        out: List[Dict] = []
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        seen_ids = set()
        if requester_ip:
            seen_ids = set(r.smembers(f"{SEEN_KEY_PREFIX}{requester_ip}"))

        for row in raw:
            try:
                d = json.loads(row)
                ts = datetime.fromisoformat(d.get("timestamp", "").replace("Z", "+00:00"))
            except Exception:
                continue
            if ts < cutoff:
                continue
            if hide_self and requester_ip and d.get("ip") == requester_ip:
                continue
            if unread_only and d.get("id") in seen_ids:
                continue
            out.append(d)
        out.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        return out
    except Exception as e:
        logger.exception("list_recent failed: %s", e)
        return []


def mark_seen(ids: List[str], requester_ip: str) -> int:
    if not requester_ip or not ids:
        return 0
    try:
        r = get_redis()
        key = f"{SEEN_KEY_PREFIX}{requester_ip}"
        added = sum(1 for _ in ids if r.sadd(key, _))
        r.expire(key, 60 * 60 * 24 * 14)
        return added
    except Exception as e:
        logger.exception("mark_seen failed: %s", e)
        return 0
