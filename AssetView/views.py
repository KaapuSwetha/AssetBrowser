# # AssetView/views.py
from __future__ import annotations
import os
import json
import logging
import datetime as dt
from pathlib import Path
from django.conf import settings
from django.http import (
    HttpResponse, HttpResponseBadRequest,
    HttpResponseNotFound, JsonResponse,
    StreamingHttpResponse,
)
import re as _re
from django.views.decorators.csrf import csrf_exempt
from django.shortcuts import render
from django.template.loader import render_to_string
from django.views.decorators.cache import cache_page
from django.views.decorators.http import require_GET, require_POST
from urllib.parse import urlencode

# Import from refactored modules
from .viewFiles.permissions import check_user_permission
from .viewFiles.tree_handler import build_category_branch, build_sequence_branch
from .viewFiles.metadatahandlers import get_asset_rows, get_row_metadata_data
from .viewFiles.status_handlers import get_status_form_data, update_status_data
from .viewFiles.search_handlers import search_assets_data, api_data_search
from .utils import (
    as_list, entry_to_path, basename_noext, load_json,
    coerce_scalar, status_badge, age_badge, pretty, web_path,
    apply_status_badges, ALL_STATUS, path_date
)
from .viewFiles.notifications_handler import (
    scan_json_for_new_keys,
    get_unread_notifications,
    mark_notification_read,
    mark_all_read,
    delete_notification, start_background_watcher
)
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from typing import List, Dict
import subprocess
import tempfile
import threading
import uuid
import time as _time

logger = logging.getLogger(__name__)
from django.contrib.auth.decorators import login_required

# --------------------------------------------------------------------------- #
# Settings
# --------------------------------------------------------------------------- #
BASE = Path(getattr(settings, "BASE_PROJECT_PATH", "."))
ACTIVE: List[str] = list(getattr(settings, "ACTIVE_PROJECTS", []))
_MERGE_JOBS: dict = {}


# --------------------------------------------------------------------------- #
# Helper function to resolve media paths
# --------------------------------------------------------------------------- #
def resolve_media_path(path_str: str) -> Path:
    if not path_str:
        return None

    # Strategy 0: Remove URL prefix if present
    if path_str.startswith('http://') or path_str.startswith('https://'):
        from urllib.parse import urlparse
        parsed = urlparse(path_str)
        path_str = parsed.path

    # Strategy 1: Try as direct absolute path FIRST
    try:
        test_path = Path(path_str)
        if test_path.exists():
            return test_path
    except Exception:
        pass

    # Strategy 2: Try with forward slashes normalized to backslashes (Windows)
    try:
        test_path = Path(path_str.replace('/', '\\'))
        if test_path.exists():
            return test_path
    except Exception:
        pass

    # Strategy 3: Try with backslashes normalized to forward slashes (Unix-style)
    try:
        test_path = Path(path_str.replace('\\', '/'))
        if test_path.exists():
            return test_path
    except Exception:
        pass

    # Strategy 4: Handle web paths (e.g., /media/c_drive/Ref/...)
    if path_str.startswith('/media/'):
        relative_path = path_str.replace('/media/', '', 1)

        for drive_letter in ['C', 'D', 'E', 'F', 'G', 'H', 'V', 'W', 'X', 'Y', 'Z']:
            drive_prefix = f"{drive_letter.lower()}_drive/"
            if relative_path.startswith(drive_prefix):
                clean_path = relative_path.replace(drive_prefix, '', 1)
                test_path = Path(f'{drive_letter}:/') / clean_path
                if test_path.exists():
                    return test_path

        for drive in ['V:', 'C:', 'D:', 'E:', 'F:', 'G:', 'H:', 'W:', 'X:', 'Y:', 'Z:']:
            test_path = Path(drive) / relative_path
            if test_path.exists():
                return test_path

        test_path = Path('/') / relative_path
        if test_path.exists():
            return test_path

    # Strategy 5: Try relative to BASE
    try:
        test_path = BASE / path_str
        if test_path.exists():
            return test_path
    except Exception:
        pass

    # Strategy 6: Try removing leading slash
    if path_str.startswith('/'):
        try:
            test_path = Path(path_str[1:])
            if test_path.exists():
                return test_path
        except Exception:
            pass

    logger.error(f"Failed to resolve path: {path_str} (BASE={BASE})")
    return None


def get_feedback_files(preview_path: str) -> list:
    if not preview_path:
        return []

    try:
        fs_path = resolve_media_path(str(preview_path))

        if not fs_path:
            fs_path = Path(str(preview_path).replace("\\", "/"))

        source_dir = fs_path.parent

        if source_dir.name.lower() == "preview":
            parent_dir = source_dir.parent
        else:
            parent_dir = source_dir.parent

        parts = parent_dir.parts
        remapped = tuple(
            "07_TemporaryData" if part == "04_publish" else part
            for part in parts
        )

        try:
            remapped_dir = Path(*remapped)
        except TypeError:
            return []

        feedback_dir = remapped_dir / "feedback"

        if not feedback_dir.exists():
            return []

        IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".tif"}
        VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".avi"}

        files = []
        for f in feedback_dir.iterdir():
            if not f.is_file():
                continue

            ext = f.suffix.lower()
            if ext in IMAGE_EXTS:
                media_type = "image"
            elif ext in VIDEO_EXTS:
                media_type = "video"
            else:
                continue

            ver_match = _re.search(r"_v(\d+)$", f.stem)
            version_num = int(ver_match.group(1)) if ver_match else None

            file_mtime = f.stat().st_mtime
            display_ts = pretty(dt.datetime.fromtimestamp(file_mtime))
            sort_key = version_num if version_num is not None else file_mtime

            files.append({
                "name": f.name,
                "src": web_path(str(f)),
                "path": str(f),
                "type": media_type,
                "display_timestamp": display_ts,
                "version": f"v{version_num}" if version_num is not None else "",
                "_sort": sort_key,
            })

        files.sort(key=lambda x: x["_sort"])
        for f in files:
            del f["_sort"]

        return files

    except Exception as exc:
        logger.warning(f"[feedback] error scanning for {preview_path}: {exc}")
        return []


# --------------------------------------------------------------------------- #
# Shell
# --------------------------------------------------------------------------- #
@require_GET
def asset_browser(_request):
    return render(_request, "AssetView/asset_browser.html",
                  {"empty_versions": []})


# --------------------------------------------------------------------------- #
# Tree fragments
# --------------------------------------------------------------------------- #
@require_GET
def get_project_tree(_request):
    from utils.config import load_config
    config = load_config(config_path=str(settings.CONFIG_FILE), reload_on_change=True)
    active = sorted(config.get("projects", {}).get("active", ACTIVE))
    ctx = {"projects": [{"name": p} for p in active]}
    html = render_to_string("AssetView/partials/_project_tree.html", ctx)
    return HttpResponse(html)


@cache_page(60, key_prefix="ab:cat")
@require_GET
def get_category_branch(request):
    project = (request.GET.get("project") or "").strip()
    if not project:
        return HttpResponse("<div class='px-3 py-2 text-ink-500'>No project</div>")

    root = BASE / project / "Asset"
    html = build_category_branch(project, root)
    return HttpResponse(html)


@cache_page(60, key_prefix="ab:seq")
@require_GET
def get_sequence_branch(request):
    project = (request.GET.get("project") or "").strip()
    if not project:
        return HttpResponse("<div class='px-3 py-2 text-ink-500'>No project</div>")

    root = BASE / project / "Sequence"
    html = build_sequence_branch(project, root)
    return HttpResponse(html)


# --------------------------------------------------------------------------- #
# Versions table
# --------------------------------------------------------------------------- #
@require_GET
def get_asset_versions(request):
    path = (request.GET.get("path") or "").strip()
    mode = (request.GET.get("mode") or "").strip()
    name = (request.GET.get("name") or "").strip()
    variant = (request.GET.get("variant") or "").strip()

    if not (path and mode and name):
        return HttpResponseBadRequest("Missing params")

    if mode not in {"Asset", "Sequence"}:
        return HttpResponseBadRequest("Invalid mode")

    fp = Path(path)
    if not fp.exists():
        return HttpResponseNotFound("JSON not found")

    rows = get_asset_rows(fp, mode, name, variant)

    for row in rows:
        if row.get("Status"):
            badge_info = status_badge(row["Status"])
            row["Status"] = badge_info
        else:
            row["Status"] = None

    context = {
        "data_type": mode,
        "rows": rows,
        "path": path,
        "name": name,
        "variant": variant
    }
    html = render_to_string("AssetView/partials/_asset_rows.html", context)
    return HttpResponse(html)


@require_GET
def get_row_metadata(request):
    path = (request.GET.get("path") or "").strip()
    name = (request.GET.get("name") or "").strip()
    mode = (request.GET.get("mode") or "").strip()
    variant = (request.GET.get("variant") or "").strip()
    filename = (request.GET.get("filename") or "").strip()
    index_str = (request.GET.get("index") or "").strip()

    try:
        metadata = get_row_metadata_data(path, name, mode, variant, filename, index_str)
    except FileNotFoundError:
        return HttpResponseNotFound("JSON not found")

    can_annotate, _, _ = check_user_permission(request)

    meta_html = render_to_string(
        "AssetView/partials/_metadata_rows.html",
        {
            "meta": metadata["meta"],
            "status_badge": metadata["status_badge"],
            "date_badge": metadata["date_badge"]
        },
    )

    preview_path = metadata["media"].get("original_path", "")
    feedback_files = get_feedback_files(preview_path)
    status_history = metadata.get("history", [])

    preview_html = render_to_string(
        "AssetView/partials/_preview.html",
        {
            "media": metadata["media"],
            "can_annotate": can_annotate,
            "current_status": metadata["meta"].get("Status", "No Status"),
            "status_badge": metadata["status_badge"],
            "all_status": ALL_STATUS,
            "name": name,
            "variant": variant,
            "path": path,
            "data_type": mode,
            "preview_file_path": metadata["media"].get("original_path", ""),
            "feedback_files": feedback_files,
            "status_history": status_history,
        }
    )

    preview_oob = preview_html.replace(
        '<div id="previewCard"',
        '<div id="previewCard" hx-swap-oob="true"'
    )

    return HttpResponse(meta_html + preview_oob)


# --------------------------------------------------------------------------- #
# Metadata + preview
# --------------------------------------------------------------------------- #
@require_GET
def get_file_metadata(request):
    path = (request.GET.get("path") or "").strip()
    name = (request.GET.get("name") or "").strip()
    mode = (request.GET.get("mode") or "").strip()
    variant = (request.GET.get("variant") or "").strip()

    if not (path and name and mode):
        return HttpResponseBadRequest("Missing required query params: path, name, mode")

    fp = Path(path)
    if not fp.exists():
        return HttpResponseNotFound("JSON not found")

    data = load_json(fp)

    if mode == "Asset":
        blob = data.get("asset_info") or {}
    else:
        blob = data.get("sequence_info") or {}

    item = blob.get(name) or {}

    if mode == "Asset" and variant and "Variants" in item:
        item = item.get("Variants", {}).get(variant, {})
        item = dict(item)
        item["Variant"] = variant
        item["Asset"] = name
    else:
        item = dict(item)
        item["Asset"] = name

    pub = as_list(item.get("PublishdFilePath"))
    last_path = entry_to_path(pub[-1]) if pub else ""
    dtobj = path_date(last_path)
    date_badge = {
        "text": pretty(dtobj),
        "badge_class": age_badge(dtobj),
        "title": last_path or ""
    }

    st_text = coerce_scalar(item.get("Status")) or "No Status"
    st_badge = status_badge(st_text)

    meta = {}
    for k, v in item.items():
        if k == "Variants":
            continue
        meta[k] = coerce_scalar(v)

    meta["Date"] = date_badge["text"]
    meta["Status"] = st_badge["text"]

    preview = coerce_scalar(item.get("PreviewPath"))
    media = {"type": "none", "src": "", "original_path": preview}
    if preview:
        ext = Path(preview).suffix.lower()
        if ext in {".mov", ".mp4", ".m4v", ".webm", ".avi"}:
            media = {"type": "video", "src": web_path(preview), "original_path": preview}
        elif ext in {".exr", ".hdr"}:
            media = {"type": "image", "src": f"/preview/convert/?path={preview}", "original_path": preview}
        else:
            media = {"type": "image", "src": web_path(preview), "original_path": preview}

    can_annotate, _, _ = check_user_permission(request)

    meta_html = render_to_string(
        "AssetView/partials/_metadata_rows.html",
        {"meta": meta, "status_badge": st_badge, "date_badge": date_badge},
    )

    feedback_files = get_feedback_files(preview)

    preview_html = render_to_string(
        "AssetView/partials/_preview.html",
        {
            "media": media,
            "can_annotate": can_annotate,
            "current_status": st_text,
            "status_badge": st_badge,
            "all_status": ALL_STATUS,
            "name": name,
            "variant": variant,
            "path": path,
            "data_type": mode,
            "preview_file_path": preview,
            "feedback_files": feedback_files,
            "status_history": item.get("History", []),
        }
    )
    preview_oob = preview_html.replace(
        '<div id="previewCard"',
        '<div id="previewCard" hx-swap-oob="true"'
    )

    return HttpResponse(meta_html + preview_oob)


# --------------------------------------------------------------------------- #
# Search
# --------------------------------------------------------------------------- #
@require_GET
def search_assets(request):
    q = (request.GET.get("q") or "").strip().lower()
    if len(q) < 2:
        return HttpResponse(status=204)

    try:
        results = search_assets_data(q, ACTIVE, BASE)

        for result in results:
            if 'variant' not in result:
                result['variant'] = ''

        html = render_to_string(
            "AssetView/partials/_search_results.html",
            {"results": results},
            request=request,
        )
        return HttpResponse(html)
    except Exception as e:
        logger.error(f"Search error for query '{q}': {e}", exc_info=True)
        error_html = f"""
        <div class="px-3 py-8 text-center text-rose-400">
            <i class="fas fa-exclamation-triangle text-3xl mb-2"></i>
            <p class="text-sm">Error searching: {str(e)}</p>
        </div>
        """
        return HttpResponse(error_html)


# --------------------------------------------------------------------------- #
# Status popover + update
# --------------------------------------------------------------------------- #
@require_GET
def status_form(request):
    uid = (request.GET.get("uid") or "").strip()
    path = (request.GET.get("path") or "").strip()
    mode = (request.GET.get("mode") or "").strip()
    name = (request.GET.get("name") or "").strip()
    variant = (request.GET.get("variant") or "").strip()
    index = (request.GET.get("index") or "").strip()

    if not (uid and path and mode and name):
        return HttpResponseBadRequest("Missing params")

    can_edit, username, client_ip = check_user_permission(request)

    if not can_edit:
        html = f"""
        <script>
        if (window.Toast) {{
            Toast.error(
                'Only authorized users can change status.',
                'Permission Denied'
            );
        }}
        </script>
        """
        return HttpResponse(html)

    form_data = get_status_form_data(uid, path, mode, name, variant, index)
    html = render_to_string("AssetView/partials/_status_form.html", form_data)
    return HttpResponse(html)


@require_GET
def status_form_close(_req):
    return HttpResponse("")


# --------------------------------------------------------------------------- #
# Preview conversion
# --------------------------------------------------------------------------- #
@csrf_exempt
@require_GET
def convert_preview(request):
    src = request.GET.get("path")
    if not src:
        return JsonResponse({"error": "Missing path"}, status=400)
    return JsonResponse({"preview": web_path(src)})


# --------------------------------------------------------------------------- #
# JSON data API
# --------------------------------------------------------------------------- #
@require_GET
def api_data(request):
    mode = (request.GET.get("mode") or "").strip()
    project = (request.GET.get("project") or "").strip()

    if mode not in {"Asset", "Sequence"}:
        return JsonResponse({"error": "mode must be 'Asset' or 'Sequence'"}, status=400)

    try:
        payload = api_data_search(mode, project, ACTIVE, BASE)
    except ValueError as e:
        return JsonResponse({"error": str(e)}, status=400)

    return JsonResponse({"results": payload})


@csrf_exempt
@require_GET
def check_permission(request):
    can_edit, username, client_ip = check_user_permission(request)
    return JsonResponse({
        'status': 'allowed' if can_edit else 'denied',
        'username': username if username else 'unknown',
        'can_edit': can_edit,
        'client_ip': client_ip,
        'debug_info': {
            'ip_resolved': client_ip is not None,
            'username_found': username is not None
        }
    })


@csrf_exempt
@require_GET
def debug_path_resolution(request):
    path_str = request.GET.get("path", "")
    if not path_str:
        return JsonResponse({
            "error": "Missing 'path' parameter",
            "usage": "/debug/path/?path=/media/c_drive/Ref/file.mov"
        })

    resolved = resolve_media_path(path_str)
    return JsonResponse({
        "input_path": path_str,
        "resolved_path": str(resolved) if resolved else None,
        "exists": resolved.exists() if resolved else False,
        "is_file": resolved.is_file() if resolved else False,
        "is_dir": resolved.is_dir() if resolved else False,
        "parent": str(resolved.parent) if resolved else None,
        "base_path": str(BASE),
        "debug_info": {
            "starts_with_media": path_str.startswith('/media/'),
            "is_absolute": Path(path_str).is_absolute() if path_str else False
        }
    })


# --------------------------------------------------------------------------- #
# Update status
# --------------------------------------------------------------------------- #
@require_POST
def update_asset_status(request):
    """Update asset status - check permission before allowing update."""
    path = (request.POST.get("path") or "").strip()
    mode = (request.POST.get("mode") or "").strip()
    name = (request.POST.get("name") or "").strip()
    variant = (request.POST.get("variant") or "").strip()
    uid = (request.POST.get("uid") or "").strip()
    index_str = (request.POST.get("index") or "").strip()
    status = (request.POST.get("status") or "No Status").strip() or "No Status"
    comment = (request.POST.get("comment") or "").strip()

    if not (path and mode and name and uid):
        return HttpResponseBadRequest("Missing params")

    can_edit, username, client_ip = check_user_permission(request)

    if not can_edit:
        response = HttpResponse("")
        response["HX-Trigger"] = json.dumps({
            "showToast": {
                "type": "error",
                "title": "✗ Permission Denied",
                "message": "Only authorized users can change status."
            }
        })
        return response

    try:
        response_html, trigger_data = update_status_data(
            path, mode, name, variant, uid, index_str, status, comment,
            username=username,
            ip_address=client_ip,
        )

        metadata_update_script = f"""
        <script>
        (function() {{
            const metadataCard = document.getElementById('metadataCard');
            if (metadataCard) {{
                const statusBadge = metadataCard.querySelector('.inline-flex.items-center.gap-1.px-2.py-1.rounded-lg.font-medium');
                if (statusBadge) {{
                    const STATUS_MAP = {{
                        "Internal Approved": {{"cls": "bg-emerald-600 text-white", "icon": "fa-check-circle"}},
                        "Internal Review": {{"cls": "bg-amber-500 text-black", "icon": "fa-hourglass-half"}},
                        "Internal Retake": {{"cls": "bg-rose-500 text-white", "icon": "fa-undo"}},
                        "Client Approved": {{"cls": "bg-emerald-800 text-white", "icon": "fa-thumbs-up"}},
                        "Client Review": {{"cls": "bg-amber-600 text-black", "icon": "fa-eye"}},
                        "Client Retake": {{"cls": "bg-rose-600 text-white", "icon": "fa-sync"}},
                        "Work In Progress": {{"cls": "bg-sky-600 text-white", "icon": "fa-spinner"}},
                        "No Status": {{"cls": "bg-slate-600 text-white", "icon": "fa-question"}},
                    }};

                    function getStatusBadge(text) {{
                        const t = (text || "No Status").trim() || "No Status";
                        const meta = STATUS_MAP[t] || STATUS_MAP["No Status"];
                        return {{"text": t, "cls": meta.cls, "icon": meta.icon}};
                    }}

                    const badge = getStatusBadge("{status}");
                    statusBadge.className = `ml-2 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium ${{badge.cls}} shadow-sm align-middle`;
                    statusBadge.innerHTML = `<i class="fas ${{badge.icon}}"></i><span>${{badge.text}}</span>`;
                }}

                const comment = "{comment}".trim();
                if (comment) {{
                    const rows = metadataCard.querySelectorAll('tbody tr');
                    for (const row of rows) {{
                        const firstCell = row.querySelector('td:first-child');
                        if (firstCell && firstCell.textContent.trim() === 'PublishComment') {{
                            const secondCell = row.querySelector('td:nth-child(2)');
                            if (secondCell) {{
                                secondCell.textContent = comment;
                            }}
                            break;
                        }}
                    }}
                }}
            }}

            const previewMediaElements = document.querySelectorAll(`[data-asset-name="{name}"][data-variant="{variant or ''}"][data-mode="{mode}"]`);
            previewMediaElements.forEach(el => {{
                el.dataset.status = "{status}";
            }});

            const noteModal = document.getElementById('textInputModal') || document.getElementById('textInputModalClone');
            if (noteModal && !noteModal.classList.contains('hidden')) {{
                const statusSelect = noteModal.querySelector('#noteStatusSelect');
                if (statusSelect) {{
                    statusSelect.value = "{status}";
                }}
            }}
        }})();
        </script>
        """

        response_html += metadata_update_script
        response = HttpResponse(response_html)
        response["HX-Trigger"] = json.dumps({
            "showToast": {
                "type": "success",
                "title": "✓ Update Successful",
                "message": f'Status updated to {trigger_data["statusUpdated"]["status"]} '
            }
        })

        return response

    except Exception as e:
        logger.error(f"Error updating status: {e}")
        response = HttpResponse("")
        response["HX-Trigger"] = json.dumps({
            "showToast": {
                "type": "error",
                "title": "Update Failed",
                "message": f"Error updating status: {str(e)}"
            }
        })
        return response


@csrf_exempt
@require_POST
def update_preview_status(request):
    try:
        status = (request.POST.get("status") or "No Status").strip()
        comment = (request.POST.get("comment") or "").strip()
        media_path = (request.POST.get("media_path") or "").strip()
        asset_name = (request.POST.get("asset_name") or "").strip()
        variant = (request.POST.get("variant") or "").strip()
        mode = (request.POST.get("mode") or "Asset").strip()
        json_path = (request.POST.get("json_path") or "").strip()

        if json_path and Path(json_path).exists():
            p = Path(json_path)
        else:
            json_path = find_json_for_asset(media_path, asset_name, variant, mode)
            if not json_path or not Path(json_path).exists():
                logger.error(f"JSON not found for asset: {asset_name}")
                return JsonResponse({"success": False, "error": f"Could not find JSON file for {asset_name}"})
            p = Path(json_path)

        data = load_json(p)
        key = "asset_info" if mode == "Asset" else "sequence_info"

        if key not in data:
            return JsonResponse({"success": False, "error": f"No {key} found in JSON"})

        if asset_name not in data[key]:
            return JsonResponse({"success": False, "error": f"Asset '{asset_name}' not found in JSON"})

        if variant and "Variants" in data[key][asset_name]:
            block = data[key][asset_name]["Variants"][variant]
        else:
            block = data[key][asset_name]

        status_list = as_list(block.get("Status", []))
        comment_list = as_list(block.get("PublishComment", []))
        file_list = as_list(block.get("FileName", []))
        publish_path_list = as_list(block.get("PublishdFilePath", []))
        preview_path_list = as_list(block.get("PreviewPath", []))

        normalized_media_path = str(media_path).replace('\\', '/').strip()
        target_index = -1

        for i, preview_path in enumerate(preview_path_list):
            if preview_path:
                normalized_preview = str(preview_path).replace('\\', '/').strip()
                if normalized_preview == normalized_media_path:
                    target_index = i
                    break
                elif Path(normalized_media_path).name == Path(normalized_preview).name:
                    target_index = i
                    break

        if target_index == -1:
            media_filename = Path(media_path).name if media_path else ""
            for i, filename in enumerate(file_list):
                if filename and media_filename:
                    if str(filename).strip() == media_filename:
                        target_index = i
                        break
                    elif media_filename in str(filename).strip() or str(filename).strip() in media_filename:
                        target_index = i
                        break

        if target_index == -1:
            for i, publish_path in enumerate(publish_path_list):
                if publish_path:
                    normalized_publish = str(publish_path).replace('\\', '/').strip()
                    if Path(normalized_media_path).name in normalized_publish:
                        target_index = i
                        break

        if target_index == -1:
            logger.error(f"Could not find matching index for media path: {media_path}")
            return JsonResponse({
                "success": False,
                "error": f"Could not find matching entry for {Path(media_path).name}"
            })

        while len(status_list) <= target_index:
            status_list.append("No Status")
        while len(comment_list) <= target_index:
            comment_list.append("")

        old_status = status_list[target_index] if target_index < len(status_list) else "No Status"
        old_comment = comment_list[target_index] if target_index < len(comment_list) else ""

        status_list[target_index] = status

        if comment:
            comment_list[target_index] = comment
        else:
            comment_list[target_index] = old_comment if old_comment else ""

        block["Status"] = status_list
        block["PublishComment"] = comment_list

        status_changed = old_status != status
        comment_changed = comment.strip() != (old_comment or "").strip()
        if status_changed or comment_changed:
            from .viewFiles.history_handler import append_history_entry
            _, username, client_ip = check_user_permission(request)
            asset_id_list = as_list(block.get("AssetId", []))
            asset_id = (
                asset_id_list[target_index]
                if target_index < len(asset_id_list)
                else "unknown"
            )
            append_history_entry(  # ← FIXED: indented inside the if block
                block=block,
                asset_id=asset_id,
                previous_status=old_status,
                new_status=status,
                comment=comment,
                username=username,
                ip_address=client_ip,
            )
        p.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

        return JsonResponse({
            "success": True,
            "message": f"Status updated to {status}",
            "status": status,
            "comment": comment_list[target_index],
            "asset": asset_name,
            "variant": variant,
            "json_path": str(p),
            "updated_index": target_index,
            "debug_info": {
                "media_path": media_path,
                "matched_index": target_index,
                "old_status": old_status,
                "new_status": status,
                "old_comment": old_comment,
                "new_comment": comment_list[target_index]
            }
        })

    except Exception as e:
        logger.error(f"Error updating preview status: {e}", exc_info=True)
        return JsonResponse({"success": False, "error": str(e)})


def find_json_for_asset(media_path, asset_name, variant, mode):
    import os
    if '.' in asset_name:
        asset_base_name = os.path.splitext(asset_name)[0]
        import re
        cleaned_name = re.sub(r'_v\d+', '', asset_base_name)
        cleaned_name = re.sub(r'_\d+$', '', cleaned_name)
        cleaned_name = re.sub(r'_ani$', '', cleaned_name)
        cleaned_name = re.sub(r'_hyd$', '', cleaned_name)
        cleaned_name = re.sub(r'_side_by_side$', '', cleaned_name)
        asset_name = cleaned_name

    for project in ACTIVE:
        project_path = BASE / project
        json_dir = project_path / "Asset" if mode == "Asset" else project_path / "Sequence"

        for json_file in json_dir.rglob("*.json"):
            try:
                data = load_json(json_file)
                key = "asset_info" if mode == "Asset" else "sequence_info"

                if key in data:
                    if asset_name in data[key]:
                        return json_file

                    if mode == "Asset":
                        for asset_key, asset_data in data[key].items():
                            if "Variants" in asset_data:
                                for variant_name in asset_data["Variants"]:
                                    variant_data = asset_data["Variants"][variant_name]
                                    file_names = as_list(variant_data.get("FileName", []))
                                    for file_name in file_names:
                                        if asset_name in file_name or file_name in asset_name:
                                            return json_file

            except Exception as e:
                logger.error(f"Error reading JSON file {json_file}: {e}")
                continue

    logger.error(f"Could not find JSON file for asset: {asset_name}")
    return None


@csrf_exempt
@require_POST
def save_annotation(request):
    try:
        media_path = (request.POST.get("media_path") or "").strip()
        asset_name = (request.POST.get("asset_name") or "").strip()
        variant = (request.POST.get("variant") or "").strip()
        mode = (request.POST.get("mode") or "Asset").strip()
        status = (request.POST.get("status") or "No Status").strip()
        is_video = request.POST.get("is_video") == "true"

        actual_file_path = resolve_media_path(media_path)
        filename = Path(media_path).name

        if not actual_file_path or not actual_file_path.exists():
            for project in ACTIVE:
                project_path = BASE / project
                for found_file in project_path.rglob(filename):
                    if found_file.is_file():
                        actual_file_path = found_file
                        break
                if actual_file_path:
                    break

        if not actual_file_path or not actual_file_path.exists():
            logger.error(f"Source file not found: {filename} (original: {media_path})")
            return JsonResponse({
                "success": False,
                "error": f"Source file not found: {filename}",
                "debug_info": {
                    "filename": filename,
                    "original_path": media_path,
                    "base_path": str(BASE),
                    "active_projects": ACTIVE,
                }
            })

        media_path_obj = actual_file_path

        def _remap_publish_path(p: Path) -> Path:
            parts = p.parts
            remapped = tuple(
                '07_TemporaryData' if part == '04_publish' else part
                for part in parts
            )
            return Path(*remapped)

        source_dir = media_path_obj.parent
        parent_dir = source_dir.parent if source_dir.name.lower() == 'preview' else source_dir.parent
        parent_dir = _remap_publish_path(parent_dir)
        feedback_dir = parent_dir / "feedback"

        try:
            feedback_dir.mkdir(exist_ok=True, parents=True)
        except Exception as e:
            logger.error(f"Failed to create feedback directory: {e}")
            return JsonResponse({"success": False, "error": f"Failed to create feedback directory: {str(e)}"})

        original_stem = media_path_obj.stem
        original_ext = media_path_obj.suffix

        import re as _re_local
        base_stem = _re_local.sub(r'_v\d+$', '', original_stem, flags=_re_local.IGNORECASE)

        MEDIA_EXTS = {'.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.tif', '.mp4', '.mov', '.m4v', '.webm', '.avi'}
        existing_versions = [
            f for f in feedback_dir.iterdir()
            if f.is_file()
               and f.suffix.lower() in MEDIA_EXTS
               and _re_local.match(rf'^{_re_local.escape(base_stem)}_v\d+$', f.stem, _re_local.IGNORECASE)
        ]
        next_version = len(existing_versions) + 1
        output_filename = f"{base_stem}_v{next_version}{original_ext}"
        output_path = feedback_dir / output_filename
        if is_video:
            annotation_data = request.POST.get("annotation_data", "{}")
            try:
                annotations = json.loads(annotation_data)
            except json.JSONDecodeError:
                annotations = {}

            import shutil as sh
            ffmpeg_path = sh.which("ffmpeg")

            if not ffmpeg_path:
                try:
                    import shutil
                    shutil.copy2(media_path_obj, output_path)
                except Exception as e:
                    logger.error(f"Failed to copy video: {e}")
                    return JsonResponse({"success": False, "error": f"Failed to copy video: {str(e)}"})
            else:
                try:
                    success = burn_annotations_to_video(media_path_obj, output_path, annotations)
                    if not success:
                        import shutil
                        shutil.copy2(media_path_obj, output_path)
                except Exception as e:
                    logger.error(f"Error burning annotations: {e}")
                    import shutil
                    shutil.copy2(media_path_obj, output_path)

            annotation_metadata = {
                "video_path": str(output_path),
                "original_video": str(media_path_obj),
                "annotations": annotations.get("timeRangeAnnotations", []),
                "note_annotations": annotations.get("noteAnnotations", []),
                "created_at": dt.datetime.now().isoformat(),
                "status": status,
                "asset_name": asset_name,
                "variant": variant,
                "mode": mode,
                "video_info": {
                    "duration": annotations.get("videoDuration", 0),
                    "width": annotations.get("videoWidth", 0),
                    "height": annotations.get("videoHeight", 0),
                }
            }

            json_filename = f"{base_stem}_v{next_version}.json"
            json_path = feedback_dir / json_filename

            try:
                json_path.write_text(
                    json.dumps(annotation_metadata, indent=2, ensure_ascii=False),
                    encoding='utf-8'
                )
            except Exception as e:
                logger.error(f"Failed to save annotation JSON: {e}")

            return JsonResponse({
                "success": True,
                "message": "Video saved with annotations",
                "feedback_path": str(output_path),
                "feedback_src": web_path(str(output_path)),
                "feedback_type": "video",
                "annotation_json": str(json_path),
                "original_format": original_ext
            })

        else:
            image_data = request.POST.get("image_data", "")

            if not image_data:
                return JsonResponse({"success": False, "error": "No image data provided"})

            output_ext = original_ext if original_ext.lower() in ['.jpg', '.jpeg', '.png', '.bmp', '.tiff',
                                                                  '.tif'] else '.png'
            output_path = output_path.with_suffix(output_ext)

            try:
                import base64

                if image_data.startswith('data:image/png;base64,'):
                    image_data = image_data.replace('data:image/png;base64,', '')

                image_bytes = base64.b64decode(image_data)

                if output_ext.lower() != '.png':
                    try:
                        from PIL import Image
                        import io

                        img = Image.open(io.BytesIO(image_bytes))

                        if output_ext.lower() in ['.jpg', '.jpeg']:
                            img = img.convert('RGB')
                            img.save(output_path, 'JPEG', quality=95)
                        elif output_ext.lower() in ['.tiff', '.tif']:
                            img.save(output_path, 'TIFF')
                        elif output_ext.lower() == '.bmp':
                            img.save(output_path, 'BMP')
                        else:
                            img.save(output_path)

                    except ImportError:
                        output_path = output_path.with_suffix('.png')
                        output_path.write_bytes(image_bytes)
                else:
                    output_path.write_bytes(image_bytes)

                annotation_data = request.POST.get("annotation_data", "{}")
                try:
                    annotations = json.loads(annotation_data)
                except json.JSONDecodeError:
                    annotations = {}

                annotation_metadata = {
                    "image_path": str(output_path),
                    "original_image": str(media_path_obj),
                    "annotations": annotations.get("currentAnnotations", []),
                    "note_annotations": annotations.get("noteAnnotations", []),
                    "created_at": dt.datetime.now().isoformat(),
                    "status": status,
                    "asset_name": asset_name,
                    "variant": variant,
                    "mode": mode,
                }
                json_filename = f"{base_stem}_v{next_version}.json"
                json_path = feedback_dir / json_filename
                json_path.write_text(
                    json.dumps(annotation_metadata, indent=2, ensure_ascii=False),
                    encoding='utf-8'
                )

                return JsonResponse({
                    "success": True,
                    "message": "Image saved successfully",
                    "feedback_path": str(output_path),
                    "annotation_json": str(json_path),
                    "feedback_src": web_path(str(output_path)),
                    "feedback_type": "image",
                    "original_format": output_ext
                })

            except Exception as e:
                logger.error(f"Error saving image: {e}", exc_info=True)
                return JsonResponse({"success": False, "error": f"Failed to save image: {str(e)}"})

    except Exception as e:
        logger.error(f"Error in save_annotation: {e}", exc_info=True)
        return JsonResponse({"success": False, "error": str(e)})


def burn_annotations_to_video(input_path, output_path, annotations):
    try:
        probe_cmd = [
            'ffprobe', '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height,duration',
            '-of', 'json',
            str(input_path)
        ]

        probe_result = subprocess.run(probe_cmd, capture_output=True, text=True)
        if probe_result.returncode != 0:
            logger.error(f"FFprobe failed: {probe_result.stderr}")
            return False

        video_info = json.loads(probe_result.stdout)
        streams = video_info.get('streams', [])
        if not streams:
            logger.error("No video streams found")
            return False

        width = int(streams[0].get('width', 1920))
        height = int(streams[0].get('height', 1080))

        filter_parts = []

        time_annotations = annotations.get("timeRangeAnnotations", [])
        note_annotations = annotations.get("noteAnnotations", [])

        for anno in time_annotations + note_annotations:
            anno_type = anno.get('type')
            timestamp = float(anno.get('timestamp', 0))
            color = anno.get('color', '#f472b6').lstrip('#')

            color_str = f"0x{color}FF"
            start_time = max(0, timestamp - 0.25)
            end_time = timestamp + 0.25
            time_filter = f"enable='between(t,{start_time},{end_time})'"

            if anno_type == 'pen' and 'points' in anno:
                points = anno.get('points', [])
                if len(points) >= 2:
                    for i in range(len(points) - 1):
                        x1 = int((points[i].get('x', 0) / 100) * width)
                        y1 = int((points[i].get('y', 0) / 100) * height)
                        x2 = int((points[i + 1].get('x', 0) / 100) * width)
                        y2 = int((points[i + 1].get('y', 0) / 100) * height)
                        filter_parts.append(
                            f"drawbox=x={x1}:y={y1}:w=3:h=3:color={color_str}:t=fill:{time_filter}"
                        )

            elif anno_type == 'rect':
                x = int((anno.get('x', 0) / width) * width)
                y = int((anno.get('y', 0) / height) * height)
                w = int((anno.get('width', 100) / width) * width)
                h = int((anno.get('height', 100) / height) * height)
                filter_parts.append(
                    f"drawbox=x={x}:y={y}:w={w}:h={h}:color={color_str}:t=3:{time_filter}"
                )

            elif anno_type == 'text' or anno_type == 'note':
                text = anno.get('text', '')
                x = int((anno.get('x', 50) / 100) * width)
                y = int((anno.get('y', 50) / 100) * height)
                text = text.replace(':', r'\:').replace("'", r"'\\\''")
                filter_parts.append(
                    f"drawtext=text='{text}':x={x}:y={y}:fontsize=24:fontcolor={color_str}:box=1:boxcolor=black@0.7:boxborderw=5:{time_filter}"
                )

        if filter_parts:
            ffmpeg_cmd = [
                'ffmpeg', '-i', str(input_path),
                '-vf', ','.join(filter_parts),
                '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
                '-c:a', 'copy', '-y', str(output_path)
            ]
        else:
            ffmpeg_cmd = [
                'ffmpeg', '-i', str(input_path),
                '-c', 'copy', '-y', str(output_path)
            ]

        result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True, timeout=300)

        if result.returncode != 0:
            logger.error(f"FFmpeg failed: {result.stderr}")
            return False

        return True

    except subprocess.TimeoutExpired:
        logger.error("FFmpeg timeout")
        return False
    except Exception as e:
        logger.error(f"Error in burn_annotations_to_video: {e}", exc_info=True)
        return False


def create_annotation_overlay(self, annotation, temp_dir):
    try:
        anno_type = annotation.get('type')
        color = annotation.get('color', '#FF0000')
        start_time = float(annotation.get('startTime', 0))
        end_time = float(annotation.get('endTime', start_time + 0.05))

        color = color.lstrip('#')
        rgb = tuple(int(color[i:i + 2], 16) for i in (0, 2, 4))

        if anno_type == 'rect':
            x = int(annotation.get('video_x', 0))
            y = int(annotation.get('video_y', 0))
            width = int(annotation.get('video_width', 100))
            height = int(annotation.get('video_height', 100))
            return f"drawbox=x={x}:y={y}:w={width}:h={height}:color={rgb[0]}/{rgb[1]}/{rgb[2]}:t=3"

        elif anno_type == 'pen' and 'points' in annotation:
            points = annotation['points']
            if len(points) >= 2:
                draw_commands = []
                for i in range(len(points) - 1):
                    x1 = int((points[i].get('x', 0) / 100) * 1920)
                    y1 = int((points[i].get('y', 0) / 100) * 1080)
                    x2 = int((points[i + 1].get('x', 0) / 100) * 1920)
                    y2 = int((points[i + 1].get('y', 0) / 100) * 1080)
                    draw_commands.append(f"line={x1}:{y1}:{x2}:{y2}")

                if draw_commands:
                    return f"draw={'|'.join(draw_commands)}:color={rgb[0]}/{rgb[1]}/{rgb[2]}:thickness=3"

        elif anno_type == 'text' and 'text' in annotation:
            x = int(annotation.get('video_x', 0))
            y = int(annotation.get('video_y', 0))
            text = annotation.get('text', '').replace(':', '\\:').replace("'", "'\\\\\\''")
            fontfile = self.find_system_font()
            if fontfile:
                return f"drawtext=text='{text}':x={x}:y={y}:fontfile='{fontfile}':fontsize=24:fontcolor={rgb[0]}/{rgb[1]}/{rgb[2]}:box=1:boxcolor=black@0.7:boxborderw=5"
            else:
                return f"drawtext=text='{text}':x={x}:y={y}:fontsize=24:fontcolor={rgb[0]}/{rgb[1]}/{rgb[2]}:box=1:boxcolor=black@0.7:boxborderw=5"

        return None

    except Exception as e:
        logger.error(f"Error creating annotation overlay: {e}")
        return None


def _is_sbs_preview(path_str: str) -> bool:
    return str(path_str).lower().endswith('_side_by_side.mov')


def _path_belongs_to_sequence(path_str: str, sequence: str) -> bool:
    if not sequence or sequence.lower() in ("", "sequence"):
        return True
    return sequence.lower() in str(path_str).lower()


@require_GET
def get_sequence_clips(request):
    project = (request.GET.get("project") or "").strip()
    sequence = (request.GET.get("sequence") or "").strip()
    mode = (request.GET.get("mode") or "").strip().lower()
    dept = (request.GET.get("dept") or "").strip().lower()

    if not project:
        return JsonResponse({"error": "Missing project param"}, status=400)

    seq_root = BASE / project / "Sequence"
    if not seq_root.exists():
        return JsonResponse({"error": f"No Sequence folder for project: {project}"}, status=404)

    is_top_level = sequence.lower() in ("", "sequence")
    if is_top_level:
        search_root = seq_root
    else:
        candidate = seq_root / sequence
        if candidate.is_dir():
            search_root = candidate
        else:
            match = next(
                (d for d in seq_root.iterdir() if d.is_dir() and d.name.lower() == sequence.lower()),
                None,
            )
            search_root = match if match else seq_root

    if mode == "compare":
        return _get_compare_clips(search_root, project, sequence, dept)

    best: Dict[str, dict] = {}
    json_files = sorted(search_root.rglob("*.json"))

    for json_file in json_files:
        if not _dept_matches_json(dept, json_file):
            continue

        try:
            data = load_json(json_file)
        except Exception as exc:
            logger.warning(f"[sequence-clips] bad JSON {json_file}: {exc}")
            continue

        blob = data.get("sequence_info") or {}
        if not blob:
            continue

        for shot_name, shot_data in blob.items():
            preview_list = as_list(shot_data.get("PreviewPath", []))
            status_list = as_list(shot_data.get("Status", []))
            name_list = as_list(shot_data.get("FileName", []))
            publish_list = as_list(shot_data.get("PublishdFilePath", []))

            def _collect_valid(preview_list, publish_list, allow_sbs):
                """Inner helper — reused for both passes."""
                result = []
                for i, p in enumerate(preview_list):
                    if not p:
                        continue
                    if not allow_sbs and _is_sbs_preview(p):
                        continue
                    pub = publish_list[i] if i < len(publish_list) else ""
                    if not is_top_level:
                        if not _path_belongs_to_sequence(p, sequence) and \
                                not _path_belongs_to_sequence(pub, sequence):
                            continue
                    if dept and not _dept_matches(dept, str(p)):
                        if not _dept_matches(dept, str(pub)):
                            continue
                    result.append((i, p))
                return result

            valid = _collect_valid(preview_list, publish_list, allow_sbs=False)
            if not valid:  # all previews are SBS — use them anyway
                valid = _collect_valid(preview_list, publish_list, allow_sbs=True)

            if not valid:
                continue

            i, preview = valid[-1]
            pub_path = publish_list[i] if i < len(publish_list) else ""
            ver_match = _re.search(r'_v(\d+)', str(pub_path), _re.IGNORECASE)
            version = f"v{ver_match.group(1)}" if ver_match else f"v{i + 1:03d}"
            status = (status_list[i] if i < len(status_list) else "") or "No Status"
            label = (name_list[i] if i < len(name_list) else "") or f"{shot_name}_{version}"
            preview_filename = Path(preview).stem
            seq_clip_name = _re.sub(r'_v\d+$', '', preview_filename, flags=_re.IGNORECASE)
            clip = {
                "name": seq_clip_name,
                "label": label,
                "src": web_path(str(preview)),
                "path": str(preview),
                "status": status,
                "version": version,
                "shot": shot_name,
                "json": str(json_file),
            }

            existing = best.get(shot_name)
            if existing is None or _ver_num(version) >= _ver_num(existing["version"]):
                best[shot_name] = clip

    clips = [best[s] for s in sorted(best.keys(), key=_shot_sort_key)]

    if not clips:
        seen_bases: set = set()
        raw: list = []
        for f in sorted(search_root.rglob("*")):
            if f.suffix.lower() not in _VIDEO_EXTS or not f.is_file():
                continue
            if _is_sbs_preview(f.name):
                continue
            if dept and not _dept_matches(dept, str(f)):
                continue
            base = _base_stem(f.stem)
            if base in seen_bases:
                raw = [c for c in raw if c["shot"] != base]
            seen_bases.add(base)
            raw.append({
                "name": f.stem,
                "label": f.name,
                "src": web_path(str(f)),
                "path": str(f),
                "status": "No Status",
                "version": _ver_label(f.stem) or "",
                "shot": base,
                "json": "",
            })
        clips = sorted(raw, key=lambda c: _shot_sort_key(c["shot"]))

    return JsonResponse(clips, safe=False)


def _get_compare_clips(search_root: Path, project: str, sequence: str, dept: str = ""):
    dept = (dept or "").strip().lower()
    is_top_level = not sequence or sequence.lower() in ("", "sequence")

    shot_previews: Dict[str, list] = {}
    found_json = False

    json_files = sorted(search_root.rglob("*.json"))

    for json_file in json_files:
        if not _dept_matches_json(dept, json_file):
            continue

        try:
            data = load_json(json_file)
        except Exception as exc:
            logger.warning(f"[compare] bad JSON {json_file}: {exc}")
            continue

        blob = data.get("sequence_info") or {}
        if not blob:
            continue
        found_json = True

        for shot_name, shot_data in blob.items():
            preview_list = as_list(shot_data.get("PreviewPath", []))
            publish_list = as_list(shot_data.get("PublishdFilePath", []))

            clean = []

            def _pick_compare(allow_sbs):
                out = []
                for i, p in enumerate(preview_list):
                    if not p:
                        continue
                    if not allow_sbs and _is_sbs_preview(p):
                        continue
                    pub = publish_list[i] if i < len(publish_list) else ""
                    if not is_top_level:
                        if not _path_belongs_to_sequence(p, sequence) and \
                                not _path_belongs_to_sequence(pub, sequence):
                            continue
                    if dept:
                        if not _dept_matches(dept, str(p)) and not _dept_matches(dept, str(pub)):
                            continue
                    out.append(p)
                return out

            clean = _pick_compare(False) or _pick_compare(True)

            if not clean:
                continue

            existing = shot_previews.get(shot_name, [])
            seen = set(existing)
            for p in clean:
                if p not in seen:
                    existing.append(p)
                    seen.add(p)
            shot_previews[shot_name] = existing

    pairs = []

    for shot_name in sorted(shot_previews.keys(), key=_shot_sort_key):
        version_paths = shot_previews[shot_name]

        disk_files = _disk_versions(version_paths[-1])
        disk_files = [f for f in disk_files if not _is_sbs_preview(f.name)]

        if len(disk_files) >= 2:
            ordered = [str(f) for f in disk_files]
        elif len(version_paths) >= 2:
            ordered = version_paths
        elif disk_files:
            ordered = list(dict.fromkeys(version_paths + [str(f) for f in disk_files]))
        else:
            ordered = version_paths

        last_path = ordered[-1]
        prev_path = ordered[-2] if len(ordered) >= 2 else ordered[0]

        def make_entry(p):
            return {
                "src": web_path(str(p)),
                "path": str(p),
                "version": _ver_label(Path(str(p)).stem) or "v?",
            }

        pairs.append({
            "name": shot_name,
            "first": make_entry(prev_path),
            "last": make_entry(last_path),
        })

    if not found_json:
        grouped: dict = {}
        for f in sorted(search_root.rglob("*")):
            if (f.is_file()
                    and f.suffix.lower() in _VIDEO_EXTS
                    and not _is_sbs_preview(f.name)):
                if dept and not _dept_matches(dept, str(f)):
                    continue
                base = _base_stem(f.stem)
                grouped.setdefault(base, []).append(f)

        for stem in sorted(grouped.keys(), key=_shot_sort_key):
            file_list = sorted(grouped[stem])
            last_f = file_list[-1]
            prev_f = file_list[-2] if len(file_list) >= 2 else file_list[0]
            pairs.append({
                "name": stem,
                "first": {"src": web_path(str(prev_f)), "path": str(prev_f),
                          "version": _ver_label(prev_f.stem) or "v?"},
                "last": {"src": web_path(str(last_f)), "path": str(last_f),
                         "version": _ver_label(last_f.stem) or "latest"},
            })

    return JsonResponse(pairs, safe=False)


_VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".avi", ".mxf"}

_DEPT_KEYWORDS: Dict[str, List[str]] = {
    "animation": ["animation", "09_animation", "_ani_"],
    "matchmove": ["matchmove", "16_matchmove", "_mtm_"],
    "cache": ["cache", "11_cache", "_cac_"],
    "lighting": ["lighting", "12_lighting", "_lgt_"],
    "compositing": ["compositing", "comp", "_comp_"],
    "rigging": ["rigging", "rig", "_rig_"],
    "fx": ["fx", "_fx_"],
    "previz": ["previz", "_pvz_"],
}


def _dept_matches(dept: str, path_or_text: str) -> bool:
    if not dept:
        return True
    haystack = path_or_text.lower()
    dept_lc = dept.lower()
    if dept_lc in haystack:
        return True
    aliases = _DEPT_KEYWORDS.get(dept_lc, [])
    return any(alias in haystack for alias in aliases)


def _dept_matches_json(dept: str, json_file: Path) -> bool:
    return True


def _ver_label(name_str: str) -> str:
    if not name_str:
        return ""
    m = _re.search(r'_v(\d+)', str(name_str), _re.IGNORECASE)
    return f"v{m.group(1)}" if m else ""


def _ver_num(version_str: str) -> int:
    m = _re.search(r'\d+', version_str or "")
    return int(m.group()) if m else 0


def _base_stem(name_str: str) -> str:
    stem = Path(str(name_str)).stem
    return _re.sub(r'_v\d+$', '', stem, flags=_re.IGNORECASE)


def _shot_sort_key(shot_name: str):
    m = _re.search(r'(\d+)([A-Za-z]*)', str(shot_name))
    return (int(m.group(1)), m.group(2).upper()) if m else (0, str(shot_name).upper())


def _disk_versions(preview_path_str: str) -> list:
    try:
        p = resolve_media_path(str(preview_path_str))
        if not p or not p.exists():
            return []
        base = _base_stem(p.stem)
        files = [
            f for f in p.parent.iterdir()
            if f.is_file()
               and f.suffix.lower() in _VIDEO_EXTS
               and _base_stem(f.stem) == base
        ]
        return sorted(files, key=lambda f: f.name)
    except Exception as exc:
        logger.warning(f"[compare] dir scan failed for {preview_path_str}: {exc}")
        return []


@csrf_exempt
@require_POST
def merge_sequence_clips(request):
    project = (request.POST.get("project") or "").strip()
    sequence = (request.POST.get("sequence") or "").strip()
    dept = (request.POST.get("dept") or "").strip().lower()
    if not project:
        return JsonResponse({"error": "Missing 'project' param"}, status=400)

    job_id = str(uuid.uuid4())
    _MERGE_JOBS[job_id] = {
        "status": "queued",
        "progress": 0,
        "clips_total": 0,
        "clips_done": 0,
        "output_web": None,
        "error": None,
        "project": project,
        "sequence": sequence,
        "dept": dept,
    }

    threading.Thread(
        target=_run_merge_job,
        args=(job_id, project, sequence, dept),
        daemon=True,
    ).start()

    return JsonResponse({
        "job_id": job_id,
        "message": f"Merge started for {project} / {sequence or 'all'} / {dept or 'all depts'}",
    })


@require_GET
def merge_sequence_clips_status(request):
    job_id = (request.GET.get("job_id") or "").strip()
    if not job_id or job_id not in _MERGE_JOBS:
        return JsonResponse({"error": "Unknown job_id"}, status=404)

    j = _MERGE_JOBS[job_id]
    return JsonResponse({
        "job_id": job_id,
        "status": j["status"],
        "progress": j["progress"],
        "clips_done": j["clips_done"],
        "clips_total": j["clips_total"],
        "output_web": j["output_web"],
        "error": j["error"],
        "project": j["project"],
        "sequence": j["sequence"],
        "dept": j["dept"],
    })


def _collect_clips_for_merge(search_root: Path, sequence: str,
                             dept: str, is_top_level: bool) -> list:
    best: Dict[str, dict] = {}

    for json_file in sorted(search_root.rglob("*.json")):
        if not _dept_matches_json(dept, json_file):
            continue
        try:
            data = load_json(json_file)
        except Exception:
            continue

        blob = data.get("sequence_info") or {}
        for shot_name, shot_data in blob.items():
            preview_list = as_list(shot_data.get("PreviewPath", []))
            publish_list = as_list(shot_data.get("PublishdFilePath", []))

            valid = []

            def _pick(allow_sbs):
                out = []
                for i, p in enumerate(preview_list):
                    if not p:
                        continue
                    if not allow_sbs and _is_sbs_preview(p):
                        continue
                    pub = publish_list[i] if i < len(publish_list) else ""
                    if not is_top_level:
                        if not _path_belongs_to_sequence(p, sequence) and \
                                not _path_belongs_to_sequence(pub, sequence):
                            continue
                    if dept:
                        if not _dept_matches(dept, str(p)) and not _dept_matches(dept, str(pub)):
                            continue
                    out.append((i, p))
                return out

            valid = _pick(False) or _pick(True)

            if not valid:
                continue

            idx, preview = valid[-1]
            pub_path = publish_list[idx] if idx < len(publish_list) else ""
            ver_match = _re.search(r'_v(\d+)', str(pub_path), _re.IGNORECASE)
            version = f"v{ver_match.group(1)}" if ver_match else f"v{idx + 1:03d}"
            preview_filename = Path(preview).stem
            seq_clip_name = _re.sub(r'_v\d+$', '', preview_filename, flags=_re.IGNORECASE)

            clip = {"shot": shot_name, "name": seq_clip_name, "path": str(preview), "version": version}
            existing = best.get(shot_name)
            if existing is None or _ver_num(version) >= _ver_num(existing["version"]):
                best[shot_name] = clip

    return [best[s] for s in sorted(best.keys(), key=_shot_sort_key)]


def _run_merge_job(job_id: str, project: str, sequence: str, dept: str):
    job = _MERGE_JOBS[job_id]
    job["status"] = "running"

    try:
        # ── Early cancellation guard ────────────────────────────────────────
        if job.get("status") == "cancelled":
            return

        seq_root = BASE / project / "Sequence"
        if not seq_root.exists():
            raise FileNotFoundError(f"No Sequence folder for project '{project}'")

        is_top_level = sequence.lower() in ("", "sequence")
        if is_top_level:
            search_root = seq_root
        else:
            candidate = seq_root / sequence
            if candidate.is_dir():
                search_root = candidate
            else:
                search_root = next(
                    (d for d in seq_root.iterdir() if d.is_dir() and d.name.lower() == sequence.lower()),
                    seq_root,
                )

        clips = _collect_clips_for_merge(search_root, sequence, dept, is_top_level)
        if not clips:
            raise ValueError(f"No clips found for {project} / {sequence or 'ALL'} / {dept or 'ALL'}")

        job["clips_total"] = len(clips)
        job["progress"] = 5

        # ── Cancellation check after clip collection ────────────────────────
        if job.get("status") == "cancelled":
            return

        resolved: list = []
        for c in clips:
            p = resolve_media_path(c["path"])
            if p and p.exists():
                resolved.append((c["shot"], p))
            else:
                logger.warning(f"[merge] skipping unresolved clip: {c['path']!r}")

        if not resolved:
            raise ValueError(
                "None of the collected clips could be resolved to real files on disk."
            )
        job["clips_total"] = len(resolved)
        job["progress"] = 10

        # ── Cancellation check before writing anything to disk ──────────────
        if job.get("status") == "cancelled":
            return

        output_dir = Path(tempfile.gettempdir()) / "seqmerge"
        output_dir.mkdir(parents=True, exist_ok=True)
        ts = _time.strftime("%Y%m%d_%H%M%S")
        tag = f"{project}_{sequence or 'all'}_{dept or 'alldepts'}_{ts}".replace(" ", "_").replace("/", "_")
        output_path = output_dir / f"{tag}_merged.mp4"

        import shutil as _sh
        ffmpeg_bin = _sh.which("ffmpeg")
        if not ffmpeg_bin:
            raise EnvironmentError("FFmpeg is not installed or not on PATH.")

        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as flist:
            concat_path = flist.name
            for _shot, p in resolved:
                safe = str(p).replace("\\", "/").replace("'", r"'\''")
                flist.write(f"file '{safe}'\n")

        job["progress"] = 15

        ok = _ffmpeg_concat(ffmpeg_bin, concat_path, output_path, job, re_encode=False)

        # ── Cancellation check between stream-copy and re-encode attempts ───
        if job.get("status") == "cancelled":
            try:
                Path(concat_path).unlink(missing_ok=True)
            except Exception:
                pass
            return

        if not ok:
            logger.warning("[merge] stream-copy failed — retrying with re-encode…")
            re_path = output_dir / f"{tag}_merged_reenc.mp4"
            ok = _ffmpeg_concat(ffmpeg_bin, concat_path, re_path, job, re_encode=True)

            if job.get("status") == "cancelled":
                try:
                    Path(concat_path).unlink(missing_ok=True)
                    re_path.unlink(missing_ok=True)
                except Exception:
                    pass
                return

            if ok:
                output_path = re_path

        try:
            Path(concat_path).unlink(missing_ok=True)
        except Exception:
            pass

        if not ok:
            raise RuntimeError("FFmpeg concat failed (both stream-copy and re-encode).")

        job["_output_path"] = str(output_path)
        job["output_web"] = f"/merge-output/{job_id}/"
        job["status"] = "done"
        job["progress"] = 100

    except Exception as exc:
        logger.error(f"[merge] job {job_id} failed: {exc}", exc_info=True)
        if job.get("status") != "cancelled":
            job["status"] = "failed"
            job["error"] = str(exc)
            job["progress"] = 0


def _ffmpeg_concat(ffmpeg_bin: str, concat_file: str,
                   output_path: Path, job: dict,
                   re_encode: bool = False) -> bool:
    if re_encode:
        codec_args = [
            "-c:v", "libx264", "-preset", "fast", "-crf", "20",
            "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
        ]
    else:
        codec_args = ["-c", "copy"]

    cmd = [
        ffmpeg_bin, "-y",
        "-f", "concat", "-safe", "0",
        "-i", concat_file,
        *codec_args,
        str(output_path),
    ]

    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)

        clips_total = max(job.get("clips_total", 1), 1)
        files_opened = 0

        for line in proc.stderr:
            # ── Cancellation check ──────────────────────────────────────────
            if job.get("status") == "cancelled":
                try:
                    proc.kill()
                except Exception:
                    pass
                # Clean up any partial output already written to disk
                try:
                    output_path.unlink(missing_ok=True)
                except Exception:
                    pass
                return False
            # ───────────────────────────────────────────────────────────────

            if "Opening '" in line and "for reading" in line:
                files_opened += 1
                job["clips_done"] = files_opened
                pct = 15 + int((files_opened / clips_total) * 80)
                job["progress"] = min(pct, 95)

        proc.wait(timeout=600)

        # Final cancellation check after stderr is exhausted
        if job.get("status") == "cancelled":
            try:
                proc.kill()
            except Exception:
                pass
            try:
                output_path.unlink(missing_ok=True)
            except Exception:
                pass
            return False

        if proc.returncode != 0:
            logger.error(f"[merge] FFmpeg exited with code {proc.returncode}")
            return False

        return True

    except subprocess.TimeoutExpired:
        try:
            proc.kill()
        except Exception:
            pass
        logger.error("[merge] FFmpeg timed out (10 min)")
        return False
    except Exception as exc:
        logger.error(f"[merge] FFmpeg exception: {exc}")
        return False


@csrf_exempt
@require_POST
def merge_sbs_clips(request):
    left_paths = request.POST.getlist("left[]")
    right_paths = request.POST.getlist("right[]")
    label = (request.POST.get("label") or "sbs").strip()
    project = (request.POST.get("project") or "").strip()
    sequence = (request.POST.get("sequence") or "").strip()

    if not left_paths or not right_paths:
        return JsonResponse({"error": "Missing left/right params"}, status=400)

    job_id = str(uuid.uuid4())
    _MERGE_JOBS[job_id] = {
        "status": "queued",
        "progress": 0,
        "clips_total": len(left_paths),
        "clips_done": 0,
        "output_web": None,
        "error": None,
        "project": project,
        "sequence": sequence,
        "dept": "sbs",
    }

    threading.Thread(
        target=_run_sbs_merge_job,
        args=(job_id, left_paths, right_paths, label),
        daemon=True,
    ).start()

    return JsonResponse({"job_id": job_id})


def _run_sbs_merge_job(job_id: str, left_paths: list, right_paths: list, label: str):
    job = _MERGE_JOBS[job_id]
    job["status"] = "running"
    job["progress"] = 5

    try:
        # ── Early cancellation guard ────────────────────────────────────────
        if job.get("status") == "cancelled":
            return

        import shutil as _sh
        ffmpeg_bin = _sh.which("ffmpeg")
        if not ffmpeg_bin:
            raise EnvironmentError("FFmpeg not found on PATH")

        project = job.get("project", "")
        sequence = job.get("sequence", "")

        seq_root = BASE / project / "Sequence"
        if not seq_root.exists():
            raise FileNotFoundError(f"No Sequence folder for project '{project}'")

        output_dir = Path(tempfile.gettempdir()) / "seqmerge"
        output_dir.mkdir(parents=True, exist_ok=True)

        total = len(left_paths)
        job["clips_total"] = total

        sbs_clips = []
        for i, (lp, rp) in enumerate(zip(left_paths, right_paths)):
            # ── Per-clip cancellation check ─────────────────────────────────
            if job.get("status") == "cancelled":
                # Clean up any SBS clips already written
                for clip in sbs_clips:
                    try:
                        clip.unlink(missing_ok=True)
                    except Exception:
                        pass
                return

            left = resolve_media_path(lp)
            right = resolve_media_path(rp)

            if not left or not left.exists():
                logger.warning(f"[sbs-merge] skipping missing left clip: {lp}")
                continue
            if not right or not right.exists():
                logger.warning(f"[sbs-merge] skipping missing right clip: {rp}")
                continue

            sbs_path = output_dir / f"_sbs_tmp_{i:04d}.mp4"

            cmd = [
                ffmpeg_bin, "-y",
                "-i", str(left),
                "-i", str(right),
                "-filter_complex",
                "[0:v]scale=iw:ih[l];[1:v]scale=iw:ih[r];[l][r]hstack=inputs=2[v]",
                "-map", "[v]",
                "-c:v", "libx264", "-preset", "fast", "-crf", "20",
                "-movflags", "+faststart",
                str(sbs_path),
            ]

            proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            for line in proc.stderr:
                # ── Cancellation check inside FFmpeg stderr loop ────────────
                if job.get("status") == "cancelled":
                    try:
                        proc.kill()
                    except Exception:
                        pass
                    try:
                        sbs_path.unlink(missing_ok=True)
                    except Exception:
                        pass
                    for clip in sbs_clips:
                        try:
                            clip.unlink(missing_ok=True)
                        except Exception:
                            pass
                    return
            proc.wait(timeout=300)

            if job.get("status") == "cancelled":
                try:
                    proc.kill()
                except Exception:
                    pass
                try:
                    sbs_path.unlink(missing_ok=True)
                except Exception:
                    pass
                for clip in sbs_clips:
                    try:
                        clip.unlink(missing_ok=True)
                    except Exception:
                        pass
                return

            if proc.returncode != 0:
                logger.warning(f"[sbs-merge] pair {i + 1} failed, skipping")
                continue

            sbs_clips.append(sbs_path)
            job["clips_done"] = i + 1
            job["progress"] = int(10 + ((i + 1) / total) * 70)

        if not sbs_clips:
            raise RuntimeError("No SBS clips were created successfully")

        # ── Cancellation check before final concat ──────────────────────────
        if job.get("status") == "cancelled":
            for clip in sbs_clips:
                try:
                    clip.unlink(missing_ok=True)
                except Exception:
                    pass
            return

        ts = _time.strftime("%Y%m%d_%H%M%S")
        safe_label = label.replace(" ", "_").replace("/", "_")
        output_path = output_dir / f"{safe_label}_sbs_{ts}.mp4"

        job["progress"] = 82

        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as flist:
            concat_path = flist.name
            for clip in sbs_clips:
                safe = str(clip).replace("\\", "/").replace("'", r"'\''")
                flist.write(f"file '{safe}'\n")

        concat_cmd = [
            ffmpeg_bin, "-y",
            "-f", "concat", "-safe", "0",
            "-i", concat_path,
            "-c", "copy",
            str(output_path),
        ]

        proc = subprocess.Popen(concat_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        for line in proc.stderr:
            # ── Cancellation check in final concat stderr loop ──────────────
            if job.get("status") == "cancelled":
                try:
                    proc.kill()
                except Exception:
                    pass
                try:
                    output_path.unlink(missing_ok=True)
                    Path(concat_path).unlink(missing_ok=True)
                except Exception:
                    pass
                for clip in sbs_clips:
                    try:
                        clip.unlink(missing_ok=True)
                    except Exception:
                        pass
                return
        proc.wait(timeout=600)

        try:
            Path(concat_path).unlink(missing_ok=True)
        except Exception:
            pass

        if job.get("status") == "cancelled":
            try:
                output_path.unlink(missing_ok=True)
            except Exception:
                pass
            for clip in sbs_clips:
                try:
                    clip.unlink(missing_ok=True)
                except Exception:
                    pass
            return

        if proc.returncode != 0:
            logger.warning("[sbs-merge] stream copy failed, retrying with re-encode")
            re_path = output_dir / f"{safe_label}_sbs_{ts}_reenc.mp4"
            concat_cmd = [
                ffmpeg_bin, "-y",
                "-f", "concat", "-safe", "0",
                "-i", concat_path,
                "-c:v", "libx264", "-preset", "fast", "-crf", "20",
                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-movflags", "+faststart",
                str(re_path),
            ]
            proc2 = subprocess.Popen(concat_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            for line in proc2.stderr:
                # ── Cancellation check in re-encode stderr loop ─────────────
                if job.get("status") == "cancelled":
                    try:
                        proc2.kill()
                    except Exception:
                        pass
                    try:
                        re_path.unlink(missing_ok=True)
                    except Exception:
                        pass
                    for clip in sbs_clips:
                        try:
                            clip.unlink(missing_ok=True)
                        except Exception:
                            pass
                    return
            proc2.wait(timeout=600)

            if job.get("status") == "cancelled":
                try:
                    re_path.unlink(missing_ok=True)
                except Exception:
                    pass
                for clip in sbs_clips:
                    try:
                        clip.unlink(missing_ok=True)
                    except Exception:
                        pass
                return

            if proc2.returncode != 0:
                raise RuntimeError("FFmpeg concat failed for SBS merge")
            output_path = re_path

        for clip in sbs_clips:
            try:
                clip.unlink(missing_ok=True)
            except Exception:
                pass

        job["clips_done"] = total
        job["_output_path"] = str(output_path)
        job["output_web"] = f"/merge-output/{job_id}/"
        job["status"] = "done"
        job["progress"] = 100

    except Exception as exc:
        logger.error(f"[sbs-merge] job {job_id} failed: {exc}", exc_info=True)
        if job.get("status") != "cancelled":
            job["status"] = "failed"
            job["error"] = str(exc)
            job["progress"] = 0


@csrf_exempt
@require_POST
def delete_merge_output(request, job_id):
    job = _MERGE_JOBS.get(job_id)
    if not job:
        return JsonResponse({"error": "Unknown job_id"}, status=404)

    # Cancel any still-running FFmpeg work
    if job.get("status") not in ("done", "failed", "cancelled"):
        job["status"] = "cancelled"
        job["error"] = "Deleted by user"

    # Delete the output file regardless of completion state
    output_path = job.get("_output_path")
    deleted = False
    if output_path:
        try:
            p = Path(output_path)
            if p.exists():
                p.unlink()
                deleted = True
            job["_output_path"] = None
            job["output_web"] = None
        except Exception as e:
            logger.error(f"[delete-merge] failed to delete {output_path}: {e}")
            return JsonResponse({"ok": False, "error": str(e)}, status=500)

    return JsonResponse({"ok": True, "job_id": job_id, "deleted": deleted})


@csrf_exempt
@require_POST
def cancel_merge_job(request, job_id):
    job = _MERGE_JOBS.get(job_id)
    if not job:
        return JsonResponse({"error": "Unknown job_id"}, status=404)

    job_was_done = job.get("status") == "done"

    # Only mark cancelled (and clean up) if the job is not already completed
    if not job_was_done:
        job["status"] = "cancelled"
        job["error"] = "Cancelled by user"

        # Delete partial/incomplete output — only for incomplete jobs
        output_path = job.get("_output_path")
        if output_path:
            try:
                Path(output_path).unlink(missing_ok=True)
            except Exception:
                pass

        return JsonResponse({"ok": True, "job_id": job_id, "deleted": True})

    # Job already finished — do NOT delete the completed output
    return JsonResponse({"ok": True, "job_id": job_id, "deleted": False, "already_done": True})


@require_GET
@require_GET
def serve_merge_output(request, job_id):
    from django.http import FileResponse
    job = _MERGE_JOBS.get(job_id)
    if not job or job.get("status") != "done":
        return HttpResponseNotFound("Job not ready or unknown.")
    p = Path(job.get("_output_path", ""))
    if not p.exists():
        return HttpResponseNotFound("Merged file has been cleaned up.")

    as_attachment = request.GET.get("download") == "1"

    # Build a human-friendly filename for the Save-As dialog
    project = job.get("project", "project")
    sequence = job.get("sequence", "sequence")
    dept = job.get("dept", "")
    suffix = f"_{dept}" if dept and dept not in ("sbs", "SBS", "") else ("_SBS" if dept.lower() == "sbs" else "")
    download_name = f"{project}_{sequence}{suffix}_merged.mp4"

    response = FileResponse(
        open(p, "rb"),
        content_type="video/mp4",
        as_attachment=as_attachment,
        filename=download_name if as_attachment else None,
    )
    return response


@require_GET
def get_asset_history(request):
    path = (request.GET.get("path") or "").strip()
    mode = (request.GET.get("mode") or "Asset").strip()
    name = (request.GET.get("name") or "").strip()
    variant = (request.GET.get("variant") or "").strip()

    if not (path and name):
        return HttpResponseBadRequest("Missing params: path, name")

    fp = Path(path)
    if not fp.exists():
        return HttpResponseNotFound("JSON not found")

    data = load_json(fp)
    key = "asset_info" if mode == "Asset" else "sequence_info"
    blob = data.get(key) or {}
    item = blob.get(name) or {}

    if variant and "Variants" in item:
        block = item["Variants"].get(variant, {})
    else:
        block = item

    history = block.get("History", [])

    html = render_to_string("AssetView/partials/_history_table.html", {"history": history})
    return HttpResponse(html)


@require_GET
def get_notifications(request):
    _, username, client_ip = check_user_permission(request)
    if not username:
        username = f"unknown@{client_ip}" if client_ip else "anonymous"
    unread = get_unread_notifications(username)
    unread.sort(key=lambda n: n.get("timestamp", ""), reverse=True)

    return JsonResponse({"count": len(unread), "notifications": unread})


@csrf_exempt
@require_POST
def mark_notification_read_view(request, notification_id):
    _, username, client_ip = check_user_permission(request)
    if not username:
        username = f"unknown@{client_ip}" if client_ip else "anonymous"
    ok = mark_notification_read(notification_id, username)
    return JsonResponse({"ok": ok})


@csrf_exempt
@require_POST
def mark_all_notifications_read(request):
    _, username, client_ip = check_user_permission(request)
    if not username:
        username = f"unknown@{client_ip}" if client_ip else "anonymous"
    count = mark_all_read(username)
    return JsonResponse({"ok": True, "marked": count})


@csrf_exempt
@require_POST
def delete_notification_view(request, notification_id):
    _, username, client_ip = check_user_permission(request)
    if not username:
        username = f"unknown@{client_ip}" if client_ip else "anonymous"

    ok = delete_notification(notification_id, username)
    return JsonResponse({"ok": ok})


import time as _time  # already imported as _time in the merge section above


def notification_stream(request):
    _, username, client_ip = check_user_permission(request)
    if not username:
        username = f"unknown@{client_ip}" if client_ip else "anonymous"

    def _collect_json_files():
        files = []
        for project in ACTIVE:
            for section in ("Asset", "Sequence"):
                p = BASE / project / section
                if p.exists():
                    files.extend(p.rglob("*.json"))
        return files

    def event_stream():
        last_ids: set = set()
        while True:
            try:
                # No more scan here — watcher handles it
                unread = get_unread_notifications(username)
                unread.sort(key=lambda n: n.get("timestamp", ""), reverse=True)

                current_ids = {n["id"] for n in unread}
                if current_ids != last_ids:
                    last_ids = current_ids
                    payload = json.dumps({"count": len(unread), "notifications": unread})
                    yield f"data: {payload}\n\n"
                else:
                    yield ": keepalive\n\n"
            except GeneratorExit:
                break
            except Exception as exc:
                logger.warning(f"[SSE] stream error: {exc}")
                yield ": error\n\n"

            _time.sleep(3)  # reduce SSE poll interval too

    response = StreamingHttpResponse(
        streaming_content=event_stream(),
        content_type="text/event-stream; charset=utf-8",
    )
    response["Cache-Control"] = "no-cache, no-store"
    response["X-Accel-Buffering"] = "no"  # disable nginx/gunicorn buffering
    response["Connection"] = "keep-alive"
    return response


def _get_all_json_files():
    files = []
    for project in ACTIVE:
        for section in ("Asset", "Sequence"):
            p = BASE / project / section
            if p.exists():
                files.extend(p.rglob("*.json"))
    return files


start_background_watcher(_get_all_json_files, interval_seconds=3)

@require_POST
def check_path_exists(request):
    path = request.POST.get("path", "").strip()
    if not path:
        return JsonResponse({"exists": False, "error": "No path provided"})
    exists = os.path.exists(path)
    return JsonResponse({"exists": exists})
import zipfile  # add alongside the existing `import subprocess, tempfile, threading, uuid, time as _time`

_ZIP_JOBS: dict = {}


def _resolve_zip_root(project: str, category: str, subpath: str = ""):
    """
    Resolve as far down BASE/project/category/subpath as real directories
    exist on disk (category -> type -> department are real folders).

    Anything beyond that — an asset group like 'FJ_chr_imanvi_mod' or a
    variant like 'anim' — is virtual: it's built from JSON content, not a
    real folder. Those leftover segments are returned as `filter_parts`
    so the caller can filter down to just that asset/variant inside the
    JSON instead of trying to walk to a folder that doesn't exist.

    Returns (root_path, filter_parts) — root_path is None if nothing
    resolves at all.
    """
    if project not in ACTIVE:
        return None, []
    if category not in {"Asset", "Sequence"}:
        return None, []

    root = (BASE / project / category).resolve()
    if not root.exists():
        return None, []

    if not subpath:
        return root, []

    segments = [s for s in subpath.replace("\\", "/").split("/") if s]

    current = root
    consumed = 0
    for seg in segments:
        candidate = (current / seg).resolve()
        try:
            candidate.relative_to(root)  # guard against path traversal
        except ValueError:
            break
        if candidate.is_dir():
            current = candidate
            consumed += 1
        else:
            break

    filter_parts = segments[consumed:]  # e.g. ['FJ_chr_imanvi_mod'] or ['FJ_chr_imanvi_mod', 'anim']
    return current, filter_parts

def _resolve_sequence_zip_root(project: str, seq_name: str = ""):
    """
    Resolve BASE/project/Sequence[/seq_name].
    Returns (root_path, resolved_seq_name) — resolved_seq_name preserves
    the real on-disk casing/spelling even if the frontend sent something
    slightly different.
    """
    if project not in ACTIVE:
        return None, ""

    seq_root = (BASE / project / "Sequence").resolve()
    if not seq_root.exists():
        return None, ""

    if not seq_name:
        return seq_root, ""

    candidate = (seq_root / seq_name).resolve()
    try:
        candidate.relative_to(seq_root)  # guard against path traversal
    except ValueError:
        return None, ""

    if candidate.is_dir():
        return candidate, seq_name

    match = next(
        (d for d in seq_root.iterdir() if d.is_dir() and d.name.lower() == seq_name.lower()),
        None,
    )
    if match:
        return match, match.name

    # Sequence folder doesn't exist as a real directory — fall back to the
    # whole Sequence root and still filter by seq_name via JSON content.
    return seq_root, seq_name


def _extract_sequence_publish_paths(json_path: Path, shot_filter: str = "", dept_filter: str = "") -> list:
    """
    Pull real, on-disk delivered file paths out of a sequence_info JSON.

    shot_filter: if set, only include that exact shot name (e.g. 'SHOT_0002')
    dept_filter: if set, only include files whose path matches that
                 department (uses the same keyword matching as the rest
                 of the sequence code — _dept_matches), since department
                 isn't a JSON key here, just something reflected in the path.
    """
    PUBLISH_FIELDS = (
        "PublishdFilePath", "PreviewPath", "Alembic", "Usd", "FBX",
        "AdditionalMaps", "DecimatedMesh", "TextureSourcePath",
    )

    paths = []
    try:
        data = load_json(json_path)
    except Exception as exc:
        logger.warning(f"[zip] failed to parse {json_path}: {exc}")
        return paths

    blob = data.get("sequence_info") or {}
    for shot_name, shot_data in blob.items():
        if shot_filter and shot_name != shot_filter:
            continue
        if not isinstance(shot_data, dict):
            continue

        for field in PUBLISH_FIELDS:
            for v in as_list(shot_data.get(field)):
                if not v:
                    continue
                if dept_filter and not _dept_matches(dept_filter, str(v)):
                    continue
                paths.append(str(v))

    return paths


def _run_sequence_zip_job(job_id: str, root: Path, project: str,
                           seq_name: str, shot_filter: str, dept_filter: str):
    job = _ZIP_JOBS[job_id]
    job["status"] = "running"

    try:
        if job.get("status") == "cancelled":
            return

        json_files = [f for f in root.rglob("*.json") if f.is_file()]
        if not json_files:
            raise ValueError(f"No sequence metadata (.json) found under {root}")

        raw_paths = []
        for jf in json_files:
            raw_paths.extend(_extract_sequence_publish_paths(jf, shot_filter, dept_filter))

        seen = set()
        resolved_files = []
        for p in raw_paths:
            if p in seen:
                continue
            seen.add(p)

            fp = resolve_media_path(p)
            if not fp:
                fp = Path(str(p).replace("/", "\\"))

            if fp and fp.exists() and fp.is_file():
                resolved_files.append((p, fp))
            else:
                logger.warning(f"[zip] skipping missing/unresolved file: {p}")

        job["files_total"] = len(resolved_files)
        if not resolved_files:
            scope = " / ".join([b for b in (seq_name, shot_filter, dept_filter) if b]) or "ALL"
            raise ValueError(f"No real files could be resolved on disk for {project} / Sequence / {scope}")

        output_dir = Path(tempfile.gettempdir()) / "assetview_zips"
        output_dir.mkdir(parents=True, exist_ok=True)

        ts = _time.strftime("%Y%m%d_%H%M%S")
        tag_bits = [project, "Sequence"] + [b.replace(" ", "_") for b in (seq_name, shot_filter, dept_filter) if b]
        tag = "_".join(tag_bits)
        output_path = output_dir / f"{tag}_{ts}.zip"

        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for i, (raw_path, fp) in enumerate(resolved_files):
                if job.get("status") == "cancelled":
                    break

                arcname = _arcname_for_publish_path(raw_path, project, fp.name)
                try:
                    zf.write(fp, arcname=str(arcname))
                except Exception as exc:
                    logger.warning(f"[zip] skipping file {fp}: {exc}")

                job["files_done"] = i + 1
                job["progress"] = min(int(((i + 1) / len(resolved_files)) * 100), 99)

        if job.get("status") == "cancelled":
            output_path.unlink(missing_ok=True)
            return

        job["_output_path"] = str(output_path)
        job["output_web"] = f"/zip-output/{job_id}/"
        job["status"] = "done"
        job["progress"] = 100

    except Exception as exc:
        logger.error(f"[zip] job {job_id} failed: {exc}", exc_info=True)
        if job.get("status") != "cancelled":
            job["status"] = "failed"
            job["error"] = str(exc)
            job["progress"] = 0
@csrf_exempt
@require_POST
def start_zip_download(request):
    """Kick off a background job that zips an Asset or Sequence scope —
    category, type, department, asset group, variant (Asset side), or
    sequence, department, shot, shot+department (Sequence side)."""
    project = (request.POST.get("project") or "").strip()
    category = (request.POST.get("category") or "").strip()
    subpath = (request.POST.get("path") or "").strip()   # Asset: full subpath. Sequence: just the seq name.
    shot = (request.POST.get("shot") or "").strip()       # Sequence only
    dept = (request.POST.get("dept") or "").strip()       # Sequence only

    if category == "Sequence":
        root, seq_name = _resolve_sequence_zip_root(project, subpath)
        if not root:
            return JsonResponse(
                {"error": "Invalid or missing project/sequence"}, status=400
            )

        job_id = str(uuid.uuid4())
        _ZIP_JOBS[job_id] = {
            "status": "queued",
            "progress": 0,
            "files_total": 0,
            "files_done": 0,
            "output_web": None,
            "error": None,
            "project": project,
            "category": category,
            "subpath": subpath,
            "_output_path": None,
        }

        threading.Thread(
            target=_run_sequence_zip_job,
            args=(job_id, root, project, seq_name, shot, dept),
            daemon=True,
        ).start()

        scope = " / ".join([b for b in (seq_name, shot, dept) if b]) or "ALL"
        return JsonResponse({
            "job_id": job_id,
            "message": f"Zipping started for {project} / Sequence / {scope}",
        })

    # ── Asset side (unchanged) ──
    root, filter_parts = _resolve_zip_root(project, category, subpath)
    if not root:
        return JsonResponse(
            {"error": "Invalid or missing project/category/path"}, status=400
        )

    job_id = str(uuid.uuid4())
    _ZIP_JOBS[job_id] = {
        "status": "queued",
        "progress": 0,
        "files_total": 0,
        "files_done": 0,
        "output_web": None,
        "error": None,
        "project": project,
        "category": category,
        "subpath": subpath,
        "_output_path": None,
    }

    threading.Thread(
        target=_run_zip_job,
        args=(job_id, root, project, category, subpath, filter_parts),
        daemon=True,
    ).start()

    return JsonResponse({
        "job_id": job_id,
        "message": f"Zipping started for {project} / {category}{('/' + subpath) if subpath else ''}",
    })

@require_GET
def zip_download_status(request):
    job_id = (request.GET.get("job_id") or "").strip()
    job = _ZIP_JOBS.get(job_id)
    if not job:
        return JsonResponse({"error": "Unknown job_id"}, status=404)

    return JsonResponse({
        "job_id": job_id,
        "status": job["status"],
        "progress": job["progress"],
        "files_done": job["files_done"],
        "files_total": job["files_total"],
        "output_web": job["output_web"],
        "error": job["error"],
        "project": job["project"],
        "category": job["category"],
    })


def _extract_publish_paths(json_path: Path, asset_filter: str = "", variant_filter: str = "") -> list:

    PUBLISH_FIELDS = (
        "PublishdFilePath", "PreviewPath", "Alembic", "Usd", "FBX",
        "AdditionalMaps", "DecimatedMesh", "TextureSourcePath",
    )

    paths = []
    try:
        data = load_json(json_path)
    except Exception as exc:
        logger.warning(f"[zip] failed to parse {json_path}: {exc}")
        return paths

    for section_key in ("asset_info", "sequence_info"):
        blob = data.get(section_key) or {}
        for asset_name, asset_data in blob.items():
            if asset_filter and asset_name != asset_filter:
                continue

            variants = asset_data.get("Variants") or {"default": asset_data}
            for variant_name, block in variants.items():
                if variant_filter and variant_name != variant_filter:
                    continue
                if not isinstance(block, dict):
                    continue

                for field in PUBLISH_FIELDS:
                    for v in as_list(block.get(field)):
                        if v:
                            paths.append(str(v))

    return paths


def _arcname_for_publish_path(raw_path: str, project: str, fallback_name: str) -> Path:

    norm = raw_path.replace("\\", "/")
    parts = [p for p in norm.split("/") if p]

    if project in parts:
        idx = parts.index(project)
        parts = parts[idx:]
    else:
        parts = parts[1:] if len(parts) > 1 else parts

    return Path(*parts) if parts else Path(fallback_name)


def _run_zip_job(job_id: str, root: Path, project: str, category: str,
                  subpath: str, filter_parts: list = None):
    job = _ZIP_JOBS[job_id]
    job["status"] = "running"

    filter_parts = filter_parts or []
    asset_filter = filter_parts[0] if len(filter_parts) >= 1 else ""
    variant_filter = filter_parts[1] if len(filter_parts) >= 2 else ""

    try:
        if job.get("status") == "cancelled":
            return

        json_files = [f for f in root.rglob("*.json") if f.is_file()]
        if not json_files:
            raise ValueError(f"No asset metadata (.json) found under {root}")

        raw_paths = []
        for jf in json_files:
            raw_paths.extend(_extract_publish_paths(jf, asset_filter, variant_filter))

        seen = set()
        resolved_files = []
        for p in raw_paths:
            if p in seen:
                continue
            seen.add(p)

            fp = resolve_media_path(p)
            if not fp:
                fp = Path(str(p).replace("/", "\\"))

            if fp and fp.exists() and fp.is_file():
                resolved_files.append((p, fp))
            else:
                logger.warning(f"[zip] skipping missing/unresolved file: {p}")

        job["files_total"] = len(resolved_files)
        if not resolved_files:
            scope = " / ".join([category, subpath]) if subpath else category
            raise ValueError(f"No real files could be resolved on disk for {project} / {scope}")

        output_dir = Path(tempfile.gettempdir()) / "assetview_zips"
        output_dir.mkdir(parents=True, exist_ok=True)

        ts = _time.strftime("%Y%m%d_%H%M%S")
        tag_bits = [project, category] + (
            [subpath.replace("/", "_").replace("\\", "_")] if subpath else []
        )
        tag = "_".join(tag_bits).replace(" ", "_")
        output_path = output_dir / f"{tag}_{ts}.zip"

        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for i, (raw_path, fp) in enumerate(resolved_files):
                if job.get("status") == "cancelled":
                    break

                arcname = _arcname_for_publish_path(raw_path, project, fp.name)
                try:
                    zf.write(fp, arcname=str(arcname))
                except Exception as exc:
                    logger.warning(f"[zip] skipping file {fp}: {exc}")

                job["files_done"] = i + 1
                job["progress"] = min(int(((i + 1) / len(resolved_files)) * 100), 99)

        if job.get("status") == "cancelled":
            output_path.unlink(missing_ok=True)
            return

        job["_output_path"] = str(output_path)
        job["output_web"] = f"/zip-output/{job_id}/"
        job["status"] = "done"
        job["progress"] = 100

    except Exception as exc:
        logger.error(f"[zip] job {job_id} failed: {exc}", exc_info=True)
        if job.get("status") != "cancelled":
            job["status"] = "failed"
            job["error"] = str(exc)
            job["progress"] = 0


@csrf_exempt
@require_POST
def cancel_zip_job(request, job_id):
    job = _ZIP_JOBS.get(job_id)
    if not job:
        return JsonResponse({"error": "Unknown job_id"}, status=404)

    if job.get("status") != "done":
        job["status"] = "cancelled"
        job["error"] = "Cancelled by user"
        output_path = job.get("_output_path")
        if output_path:
            try:
                Path(output_path).unlink(missing_ok=True)
            except Exception:
                pass
        return JsonResponse({"ok": True, "job_id": job_id})

    return JsonResponse({"ok": True, "job_id": job_id, "already_done": True})


@require_GET
def serve_zip_output(request, job_id):
    from django.http import FileResponse
    job = _ZIP_JOBS.get(job_id)
    if not job or job.get("status") != "done":
        return HttpResponseNotFound("Job not ready or unknown.")

    p = Path(job.get("_output_path", ""))
    if not p.exists():
        return HttpResponseNotFound("Zip file has been cleaned up.")

    project = job.get("project", "project")
    download_name = f"{project}.zip"

    response = FileResponse(
        open(p, "rb"),
        content_type="application/zip",
        as_attachment=True,
        filename=download_name,
    )
    return response