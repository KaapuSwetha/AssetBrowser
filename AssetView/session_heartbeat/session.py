# AssetView/views/session.py
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from utils.logger import get_logger

logger = get_logger(__name__)
from datetime import datetime, timezone


@csrf_exempt
def session_heartbeat(request):
    """
    Anonymous-friendly heartbeat. POST {artist_active: true/false} allowed.
    Refreshes session last_activity and optionally sets artist_active flag in session.
    """
    try:
        if not hasattr(request, "session"):
            return JsonResponse({"detail": "no_session"}, status=400)
        if request.method == "POST":
            try:
                import json
                payload = json.loads(request.body.decode("utf-8") or "{}")
                if "artist_active" in payload:
                    request.session["artist_active"] = bool(payload.get("artist_active"))
            except Exception:
                # ignore body parse errors but log
                logger.debug("session_heartbeat: failed to parse payload")
        request.session["last_activity"] = datetime.now(timezone.utc).isoformat()
        request.session.modified = True

        logger.debug(
            "Heartbeat refreshed session=%s artist_active=%s",
            getattr(request.session, "session_key", None),
            request.session.get("artist_active")
        )
        return JsonResponse({"detail": "ok"}, status=200)
    except Exception as e:
        logger.exception("Heartbeat error: %s", e)
        return JsonResponse({"detail": "error"}, status=500)
