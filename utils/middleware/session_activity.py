from __future__ import annotations
from datetime import datetime, timezone
from django.conf import settings
from django.utils.deprecation import MiddlewareMixin
from utils.logger import get_logger

logger = get_logger(__name__)


def _is_ignored_path(path: str) -> bool:
    for p in getattr(settings, "SESSION_IGNORED_PATH_PREFIXES", []):
        if path.startswith(p):
            return True
    return False


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_any_iso(value: str) -> datetime:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


class SessionIdleTimeoutMiddleware(MiddlewareMixin):
    """
    Tracks last_activity in session for anonymous users.
    Expires session if idle time > timeout.
    Use heartbeat endpoint to refresh.
    """

    def process_request(self, request):
        path = request.path_info or request.path
        if _is_ignored_path(path):
            return None

        session = getattr(request, "session", None)
        if session is None:
            return None

        now = datetime.now(timezone.utc)
        last = session.get("last_activity")

        if not last:
            session["last_activity"] = _utcnow_iso()
            session.modified = True
            return None

        last_dt = _parse_any_iso(last)

        default_timeout = int(getattr(settings, "DEFAULT_SESSION_IDLE_TIMEOUT", 60 * 30))
        artist_timeout = int(getattr(settings, "ARTIST_SESSION_IDLE_TIMEOUT", default_timeout))
        timeout_seconds = artist_timeout if session.get("artist_active") else default_timeout

        idle_seconds = (now - last_dt).total_seconds()
        heartbeat_url = getattr(settings, "SESSION_HEARTBEAT_URL", "/session/heartbeat/")
        is_heartbeat = (path == heartbeat_url)

        if idle_seconds > timeout_seconds:
            logger.info(
                "Session expired due to inactivity. key=%s idle=%.0f timeout=%s path=%s",
                session.session_key, idle_seconds, timeout_seconds, path
            )
            try:
                session.flush()
            except Exception:
                session.clear()

            if request.headers.get("x-requested-with") == "XMLHttpRequest" or is_heartbeat:
                from django.http import JsonResponse
                return JsonResponse({"detail": "session_expired"}, status=401)
            return None

        should_refresh = False
        if is_heartbeat:
            should_refresh = True
        elif request.method in ("POST", "PUT", "PATCH", "DELETE"):
            should_refresh = True
        elif (request.headers.get("X-Refresh-Session", "") or "").lower() in ("1", "true", "yes"):
            should_refresh = True
        elif request.method == "GET":
            if (request.headers.get("HX-Request", "").lower() == "true" or
                    request.headers.get("Accept", "").startswith("text/event-stream") or
                    request.headers.get("Upgrade", "").lower() == "websocket"):
                should_refresh = False
            else:
                ua = request.META.get("HTTP_USER_AGENT", "")
                if any(tok in ua for tok in ("Mozilla", "Chrome", "Safari", "Firefox", "Edge")):
                    if not path.startswith("/api/") and not path.endswith(".json"):
                        should_refresh = True

        if should_refresh:
            session["last_activity"] = _utcnow_iso()
            session.modified = True

        return None


class SecurityHeadersMiddleware(MiddlewareMixin):
    def process_response(self, request, response):
        response["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response["X-Content-Type-Options"] = "nosniff"
        response["X-Frame-Options"] = "DENY"
        response["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        csp = getattr(settings, "CONTENT_SECURITY_POLICY", "default-src 'self'")
        response["Content-Security-Policy"] = csp
        return response
