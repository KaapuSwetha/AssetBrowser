# AssetView/views/update_status.py
"""
View to handle supervisor or lead status updates on assets/shots.

Actions performed:
 1. Update the corresponding JSON metadata file on disk
 2. Push a notification into Redis (via utils.notifications)
 3. Broadcast to WebSocket clients (via utils.broadcast)
 4. Trigger an email task to notify relevant departments
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from django.conf import settings
from django.http import JsonResponse, HttpResponseBadRequest
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from tasks.email_tasks import send_status_email
from utils.broadcast import broadcast_notification
from utils.logger import get_logger
from utils.notifications import push_notification

logger = get_logger(__name__)


def _client_ip(request):
    """Safely get client IP from request."""
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "") or ""


def _resolve_user_by_ip(ip: str) -> str:
    return settings.IP_TO_USER.get(ip, "")


def _load_json(path):
    """Read existing JSON safely."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        logger.error("Metadata file not found: %s", path)
    except Exception as e:
        logger.exception("Error loading metadata JSON %s: %s", path, e)
    return None


def _save_json(path, data):
    """Write updated JSON atomically."""
    try:
        tmp_path = path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        os.replace(tmp_path, path)
        logger.info("Metadata JSON updated: %s", path)
        return True
    except Exception as e:
        logger.exception("Failed to save JSON %s: %s", path, e)
        return False


@csrf_exempt
@require_POST
def update_status(request):
    """
    POST body:
    {
        "path": "absolute/path/to/json",
        "status": "Approved",
        "comment": "Looks good.",
        "project": "ProjectX",
        "name": "Character_A",
        "mode": "Asset" or "Sequence",
        "notify_departments": ["lighting","comp","fx"]
    }
    """

    try:
        payload = json.loads(request.body.decode("utf-8"))
    except Exception:
        return HttpResponseBadRequest("Invalid JSON body")

    json_path = payload.get("path")
    new_status = payload.get("status")
    comment = payload.get("comment", "")
    project = payload.get("project")
    name = payload.get("name")
    mode = payload.get("mode", "Asset")
    departments = payload.get("notify_departments", [])
    ip = _client_ip(request)
    user = _resolve_user_by_ip(ip)
    if user.lower() not in [u.lower() for u in settings.STATUS_UPDATE_HOLDERS]:
        return JsonResponse({"error": "forbidden"}, status=403)
    if not json_path or not os.path.exists(json_path):
        return HttpResponseBadRequest("Invalid or missing file path")

    logger.info("Status update requested: %s (%s) -> %s", name, mode, new_status)

    # 1️⃣ Load existing metadata
    data = _load_json(json_path)
    if not data:
        return JsonResponse({"error": "metadata_load_failed"}, status=500)

    # 2️⃣ Update status fields
    try:
        target_block = None
        if mode.lower() == "asset":
            asset_info = data.get("asset_info", {})
            if name in asset_info:
                target_block = asset_info[name]
            elif asset_info:
                # fallback to first key if name mismatch
                first_key = next(iter(asset_info.keys()))
                target_block = asset_info[first_key]
        else:
            seq_info = data.get("sequence_info", {})
            if name in seq_info:
                target_block = seq_info[name]
            elif seq_info:
                first_key = next(iter(seq_info.keys()))
                target_block = seq_info[first_key]

        if not target_block:
            logger.warning("No metadata block found for %s in %s", name, json_path)
            return JsonResponse({"error": "asset_not_found"}, status=404)

        # Append status & comment
        timestamp = datetime.now(timezone.utc).isoformat()
        statuses = target_block.get("Status", [])
        if not isinstance(statuses, list):
            statuses = [statuses]
        statuses.append(new_status)
        target_block["Status"] = statuses
        target_block["PublishComment"] = comment
        target_block["LastUpdated"] = timestamp

        _save_json(json_path, data)

    except Exception as e:
        logger.exception("Failed to modify metadata for %s: %s", json_path, e)
        return JsonResponse({"error": "metadata_update_failed"}, status=500)

    # 3️⃣ Push notification to Redis
    notif_payload = {
        "name": name,
        "mode": mode,
        "status": new_status,
        "project": project,
        "path": json_path,
        "ip": ip,
    }
    try:
        push_notification(notif_payload)
        broadcast_notification({"action": "update", **notif_payload})
        logger.info("Notification broadcasted for %s (%s)", name, new_status)
    except Exception as e:
        logger.exception("Failed to push/broadcast notification: %s", e)

    # 4️⃣ Trigger email via Celery task
    try:
        recipients = _resolve_recipients(project, departments)
        if recipients:
            send_status_email.delay(project, name, new_status, comment, recipients)
        else:
            logger.debug("No recipients resolved for %s/%s", project, name)
    except Exception as e:
        logger.exception("Email task trigger failed: %s", e)

    return JsonResponse({"ok": True, "status": new_status, "comment": comment})


# Helper to resolve email recipients dynamically (stub)
def _resolve_recipients(project, departments):
    """
    Return a list of email addresses based on department routing.
    You can expand this later to query your DB or config file.
    """
    mapping = {
        "lighting": ["lighting@studio.local"],
        "comp": ["comp@studio.local"],
        "fx": ["fx@studio.local"],
        "model": ["model@studio.local"],
    }
    recipients = []
    for dept in departments:
        recipients.extend(mapping.get(dept.lower(), []))
    # fallback to general supervisors if none found
    if not recipients:
        recipients = getattr(settings, "DAILY_DIGEST_RECIPIENTS", [])
    return list(set(recipients))


def _atomic_write_json(json_path: Path, data: dict):
    tmp = json_path.with_suffix(json_path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(tmp, json_path)


@require_POST
def ping_asset_update(request):
    """
    Called by external publishers AFTER writing the JSON.
    Body: { "path": "Y:\\AssetPublishPipeData\\PublishData\\projects\\MRM\\Asset\\chr\\04_Texture\\..._asset_info.json" }
    Broadcasts to WS group so the UI refreshes without a full reload.
    """
    try:
        data = json.loads(request.body.decode("utf-8"))
        path = data.get("path", "").strip()
        if not path:
            return JsonResponse({"ok": False, "error": "missing path"}, status=400)

        # Broadcast over Channels:
        channel_layer = get_channel_layer()
        payload = {"type": "asset.update", "path": path}
        async_to_sync(channel_layer.group_send)("asset_updates", {"type": "broadcast.message", "data": payload})
        logger.info("Ping broadcast sent for asset JSON: %s", path)

        return JsonResponse({"ok": True})
    except Exception as e:
        logger.exception("ping_asset_update failed: %s", e)
        return JsonResponse({"ok": False, "error": "server error"}, status=500)
