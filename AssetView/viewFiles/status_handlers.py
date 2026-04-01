# status_handlers.py
import json
from pathlib import Path
from typing import Dict, Any, Tuple, Optional
from urllib.parse import urlencode
from django.template.loader import render_to_string
from ..utils import as_list, status_badge, load_json, coerce_scalar
from .permissions import check_user_permission
from .history_handler import append_history_entry
from ..utils import ALL_STATUS


def get_status_form_data(
        uid: str, path: str, mode: str, name: str,
        variant: str = "", index: str = ""
) -> Dict[str, Any]:
    """Get data for status update form."""
    from ..utils import ALL_STATUS  # Import here to avoid circular imports

    data = load_json(Path(path))
    blob = (data.get("asset_info") if mode == "Asset"
            else data.get("sequence_info")) or {}
    item = blob.get(name) or {}

    # Navigate to variant data if present
    if variant and "Variants" in item:
        item = item["Variants"].get(variant, {})

    # Get the current status for this specific version
    statuses = as_list(item.get("Status"))
    if index and index.isdigit():
        idx = int(index)
        cur = statuses[idx] if idx < len(statuses) else "No Status"
    else:
        cur = coerce_scalar(item.get("Status")) or "No Status"

    return {
        "uid": uid,
        "path": path,
        "mode": mode,
        "name": name,
        "variant": variant,
        "index": index,
        "statuses": ALL_STATUS,
        "current_status": cur
    }


def update_status_data(
        path: str, mode: str, name: str, variant: str,
        uid: str, index: str, status: str, comment: str = "",
        username: Optional[str] = None,
        ip_address: Optional[str] = None,
) -> Tuple[str, Dict[str, str]]:
    """
    Update status in JSON file and return HTML response with trigger data.

    username / ip_address are optional — pass them from views.py after calling
    check_user_permission(request) so history entries are always attributed.
    """
    p = Path(path)
    data = load_json(p)
    key = "asset_info" if mode == "Asset" else "sequence_info"
    data.setdefault(key, {}).setdefault(name, {})

    # Navigate to the correct location in JSON
    if variant and "Variants" in data[key][name]:
        block = data[key][name]["Variants"].setdefault(variant, {})
    else:
        block = data[key][name]

    # ── Capture old status BEFORE overwriting ───────────────────────────
    statuses = as_list(block.get("Status"))

    version_index = None
    if index and index.isdigit():
        version_index = int(index)

    if version_index is not None:
        old_status = (
            statuses[version_index]
            if version_index < len(statuses)
            else "No Status"
        )
    else:
        old_status = coerce_scalar(block.get("Status")) or "No Status"

    # ── Update status ────────────────────────────────────────────────────
    if version_index is not None:
        while len(statuses) <= version_index:
            statuses.append("No Status")
        statuses[version_index] = status
    else:
        statuses.append(status)

    block["Status"] = statuses if len(statuses) > 1 else [statuses[0] if statuses else status]

    # ── Update comment ───────────────────────────────────────────────────
    if comment:
        comments = as_list(block.get("PublishComment"))
        if version_index is not None:
            while len(comments) <= version_index:
                comments.append("")
            comments[version_index] = comment
        else:
            comments.append(comment)
        block["PublishComment"] = (
            comments if len(comments) > 1
            else [comments[0] if comments else comment]
        )

    # ── Record history (only on real status changes) ─────────────────────
    if old_status != status:
        asset_id_list = as_list(block.get("AssetId", []))
        if version_index is not None and version_index < len(asset_id_list):
            asset_id = asset_id_list[version_index]
        else:
            asset_id = coerce_scalar(block.get("AssetId")) or "unknown"

        append_history_entry(
            block           = block,
            asset_id        = asset_id,
            previous_status = old_status,
            new_status      = status,
            comment         = comment,
            username        = username,
            ip_address      = ip_address,
        )

    # ── Save JSON ────────────────────────────────────────────────────────
    p.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    # ── Build response HTML ──────────────────────────────────────────────
    badge = status_badge(status)

    params = {"uid": uid, "path": path, "mode": mode, "name": name, "index": index}
    if variant:
        params["variant"] = variant
    query_string = urlencode(params)

    display_name = f"{name} ({variant})" if variant else name

    response_html = f'''
<div id="statusCell-{uid}" hx-swap-oob="true" class="inline-flex items-center gap-2">
  <span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium {badge["cls"]} shadow-sm cursor-pointer hover:opacity-80 transition-opacity"
        hx-get="/status-form/?{query_string}"
        hx-target="#statusPortal-{uid}"
        hx-swap="innerHTML"
        hx-trigger="click"
        onclick="event.stopPropagation();">
    <i class="fas {badge["icon"]}"></i>
    <span>{badge["text"]}</span>
  </span>
</div>
<div id="statusPortal-{uid}" hx-swap-oob="true" class="absolute top-full left-0 z-50 mt-1 min-w-[250px]"></div>
'''

    trigger_data = {
        "statusUpdated": {
            "status": status,
            "name": display_name
        }
    }

    return response_html.strip(), trigger_data