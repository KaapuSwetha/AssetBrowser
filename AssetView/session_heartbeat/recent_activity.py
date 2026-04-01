# AssetView/views/recent_activity.py
import json
from django.http import JsonResponse, HttpResponseBadRequest
from django.views.decorators.http import require_GET, require_POST
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings

from utils.notifications import list_recent, mark_seen
from utils.logger import get_logger

logger = get_logger(__name__)

def _client_ip(request):
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "") or ""

@require_GET
def recent_activity(request):
    try:
        days = int(request.GET.get("days", getattr(settings, "NOTIFICATIONS_DAYS_DEFAULT", 3)))
        unread = request.GET.get("unread", "0") == "1"
        hide_self = request.GET.get("hide_self", "0") == "1"
    except Exception:
        return HttpResponseBadRequest("Invalid query parameters")

    ip = _client_ip(request)
    data = list_recent(days, ip, unread_only=unread, hide_self=hide_self)
    logger.debug("Recent activity fetched for %s: %d items", ip, len(data))
    return JsonResponse(data, safe=False)

@csrf_exempt
@require_POST
def notifications_mark_seen(request):
    ip = _client_ip(request)
    if not ip:
        return HttpResponseBadRequest("No client IP")

    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
        ids = payload.get("ids") or []
        if not isinstance(ids, list):
            return HttpResponseBadRequest("ids must be list")
    except Exception:
        return HttpResponseBadRequest("Invalid JSON")

    count = mark_seen(ids, ip)
    logger.info("Marked %d notifications seen by %s", count, ip)
    return JsonResponse({"ok": True, "added": count})
