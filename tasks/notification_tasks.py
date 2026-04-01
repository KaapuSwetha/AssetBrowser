# tasks/notification_tasks.py
"""
Celery tasks for maintaining and summarizing notifications.

These include:
 - Cleaning up old Redis-stored notifications
 - Sending a daily digest email to supervisors / producers
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import List, Sequence

from celery import shared_task
from django.conf import settings

from utils.redis_conn import get_redis
from utils.logger import get_logger
from utils.notifications import LIST_KEY, list_recent
from utils.email_utils import send_email

logger = get_logger(__name__)


def _parse_iso_utc(value: str) -> datetime:
    """Parse ISO datetimes that may end with 'Z' or lack tzinfo; return aware UTC."""
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def _normalize_recipients(raw) -> List[str]:
    """Allow DAILY_DIGEST_RECIPIENTS to be a list or comma-separated string."""
    if not raw:
        return []
    if isinstance(raw, (list, tuple, set)):
        return [str(x).strip() for x in raw if str(x).strip()]
    if isinstance(raw, str):
        return [x.strip() for x in raw.split(",") if x.strip()]
    return []


@shared_task(
    name="notifications.cleanup_old",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    max_retries=5,
)
def cleanup_old_notifications(self):
    """
    Trim old notifications from Redis (older than NOTIFICATIONS_DAYS_DEFAULT * 2).
    Newest-first list: stop at the first old item and LTRIM once.
    """
    r = get_redis()
    days = int(getattr(settings, "NOTIFICATIONS_DAYS_DEFAULT", 3))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days * 2)

    try:
        raw = r.lrange(LIST_KEY, 0, -1)
        if not raw:
            logger.debug("No notifications present; nothing to clean")
            return

        # Find the last index to keep (inclusive). Stop at first item older than cutoff.
        last_keep_index = -1
        for idx, row in enumerate(raw):
            try:
                data = json.loads(row)
                ts = _parse_iso_utc(data.get("timestamp", ""))
            except Exception:
                # Keep malformed rows rather than risk deleting everything
                ts = cutoff
            if ts >= cutoff:
                last_keep_index = idx
            else:
                break

        if last_keep_index == -1:
            # All entries are old; just delete the list
            r.delete(LIST_KEY)
            logger.info("Cleanup complete: removed=%s, kept=0", len(raw))
            return

        # Retain 0..last_keep_index, trim the rest in one op
        before = len(raw)
        r.ltrim(LIST_KEY, 0, last_keep_index)
        removed = before - (last_keep_index + 1)
        if removed > 0:
            logger.info("Cleanup complete: removed=%s, kept=%s", removed, last_keep_index + 1)
        else:
            logger.debug("No outdated notifications to remove")

    except Exception as e:
        logger.exception("cleanup_old_notifications failed: %s", e)
        raise  # let Celery autoretry


@shared_task(
    name="notifications.daily_digest",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    max_retries=5,
)
def send_daily_digest(self):
    """
    Send a daily digest email containing all publishes in the past 24 hours.
    Recipients are defined in settings.DAILY_DIGEST_RECIPIENTS.
    """
    recipients = _normalize_recipients(getattr(settings, "DAILY_DIGEST_RECIPIENTS", []))
    if not recipients:
        logger.debug("Skipping daily digest: no recipients configured")
        return

    try:
        # last 24h; do not filter by IP; include all; do not hide self
        items = list_recent(1, requester_ip="", unread_only=False, hide_self=False)
        if not items:
            logger.debug("No new notifications for daily digest")
            return

        # Build summary
        lines: List[str] = []
        for i in items:
            ts = i.get("timestamp", "")
            ts_short = ts[:19] if ts else ""
            mode = i.get("mode", "—")
            project = i.get("project", "—")
            name = i.get("name", "—")
            status = i.get("status", "—")
            lines.append(f"[{ts_short}] {mode}: {project} / {name} ({status})")

        text_body = "The following items were published in the last 24 hours:\n\n" + "\n".join(lines)
        html_items = "".join(
            f"<li><b>{i.get('mode','—')}</b>: {i.get('project','—')} / {i.get('name','—')} "
            f"(<span style='color:#10b981'>{i.get('status','—')}</span>)</li>"
            for i in items
        )
        html_body = f"<h3>Daily Publish Digest</h3><ul>{html_items}</ul>"

        # IMPORTANT: match email_utils parameter names
        ok = send_email(
            subject="Daily Publish Digest",
            to=recipients,
            html_body=html_body,
            text_body=text_body,
            async_send=False,  # Celery task is already async
        )
        if ok:
            logger.info("Daily digest sent to %d recipients", len(recipients))
        else:
            logger.warning("Daily digest send_email returned False (check email backend configuration)")

    except Exception as e:
        logger.exception("send_daily_digest failed: %s", e)
        raise  # let Celery autoretry
