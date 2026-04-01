# AssetView/views_review_htmx.py
from __future__ import annotations

import json
from typing import Dict, Any, Optional

from django.contrib.auth.decorators import login_required
from django.db import models
from django.http import HttpRequest, HttpResponse
from django.shortcuts import get_object_or_404
from django.template.loader import render_to_string
from django.views.decorators.http import require_GET, require_POST

from .models_review import Playlist, PlaylistItem, MediaAsset, Version


# --------------------------
# Helpers used across views
# --------------------------

def _media_payload(ma: MediaAsset) -> Dict[str, Any]:
    """
    Return a front-end friendly payload for a MediaAsset.
    kind: 'video' | 'image' | 'sequence'
    """
    # This mirrors your existing logic; adjust field names if needed.
    payload: Dict[str, Any] = {"id": ma.id, "version_id": ma.version_id}

    if ma.kind == MediaAsset.KIND_VIDEO:
        payload.update({
            "type": "video",
            "src": ma.proxy_url or ma.url,  # proxy if present, else original
        })
    elif ma.kind == MediaAsset.KIND_IMAGE:
        payload.update({
            "type": "image",
            "src": ma.proxy_url or ma.url,
        })
    elif ma.kind == MediaAsset.KIND_SEQUENCE:
        # frames is a list of image URLs; ensure you compute/store them in your existing pipeline
        frames = ma.frames or []  # expecting a list[str]
        payload.update({
            "type": "sequence",
            "frames": frames,
            "fps": ma.fps or 24,
        })
    else:
        payload.update({"type": None, "message": "Unsupported media"})

    if getattr(ma, "pending", False):
        payload["pending"] = True

    return payload


def _render_preview_partial(request: HttpRequest, ma: MediaAsset) -> HttpResponse:
    """Render the _preview.html card from a MediaAsset."""
    payload = _media_payload(ma)
    html = render_to_string(
        "AssetView/partials/_preview.html",
        {
            "media_json": json.dumps(payload),
            "media_id": ma.id,
            "version_id": ma.version_id,
        },
        request=request,
    )
    return HttpResponse(html)


def _get_version_first_media(version: Version) -> Optional[MediaAsset]:
    """Best-effort: pick a main MediaAsset for a Version."""
    ma = getattr(version, "mediaasset_set", None)
    if ma is None:
        return None
    # Prefer video > sequence > image — tune if you like
    order = {"video": 0, "sequence": 1, "image": 2}
    items = list(ma.all())
    if not items:
        return None
    items.sort(key=lambda x: order.get(x.kind, 99))
    return items[0]


# --------------------------------
# Preview (existing entry points)
# --------------------------------

@require_GET
@login_required
def preview_by_path(request: HttpRequest) -> HttpResponse:
    """
    Existing HTMX endpoint you used in links:
      GET ?preview=<path>&version_id=<id>
    Resolve/create MediaAsset for the provided path and return _preview.html.
    """
    preview_path = request.GET.get("preview")
    version_id = request.GET.get("version_id")

    if not preview_path:
        return HttpResponse(
            render_to_string("AssetView/partials/_preview.html",
                             {"media_json": json.dumps({"message": "No preview path."})},
                             request=request)
        )

    # Your own resolver: assume you already create or fetch a MediaAsset row for this path
    ma = MediaAsset.objects.filter(source_path=preview_path).first()
    if not ma:
        # You might be enqueuing proxy build and returning a pending card
        # Keep it simple: create a 'pending' record or return a stub payload.
        payload = {"type": None, "pending": True, "message": "Preparing preview…"}
        html = render_to_string("AssetView/partials/_preview.html",
                                {"media_json": json.dumps(payload)}, request=request)
        return HttpResponse(html)

    return _render_preview_partial(request, ma)


@require_GET
@login_required
def preview_by_media_id(request: HttpRequest, media_id: int) -> HttpResponse:
    ma = get_object_or_404(MediaAsset, id=media_id)
    return _render_preview_partial(request, ma)


# --------------------------
# Playlists (new HTMX API)
# --------------------------

@require_POST
@login_required
def playlist_create(request: HttpRequest) -> HttpResponse:
    name = (request.POST.get("name") or "").strip()
    if not name:
        return HttpResponse(status=400)
    pl = Playlist.objects.create(name=name, created_by=request.user)
    html = render_to_string("AssetView/partials/playlist_row.html", {"pl": pl}, request=request)
    return HttpResponse(html)


@require_POST
@login_required
def playlist_add_item(request: HttpRequest, playlist_id: int) -> HttpResponse:
    pl = get_object_or_404(Playlist, id=playlist_id)
    version_id = request.POST.get("version_id")
    if not version_id:
        return HttpResponse(status=400)

    v = get_object_or_404(Version, id=version_id)
    max_order = pl.items.aggregate(m=models.Max("order")).get("order__max") or 0
    PlaylistItem.objects.create(playlist=pl, version=v, order=max_order + 1)

    # Return the refreshed item list for the sidebar/panel
    items = pl.items.select_related("version").all()
    html = render_to_string("AssetView/partials/playlist_panel.html",
                            {"pl": pl, "items": items}, request=request)
    return HttpResponse(html)


@require_GET
@login_required
def playlist_panel(request: HttpRequest, playlist_id: int) -> HttpResponse:
    pl = get_object_or_404(Playlist, id=playlist_id)
    items = pl.items.select_related("version").all()
    html = render_to_string("AssetView/partials/playlist_panel.html",
                            {"pl": pl, "items": items}, request=request)
    return HttpResponse(html)


@require_GET
@login_required
def playlist_play(request: HttpRequest, playlist_id: int) -> HttpResponse:
    """
    Load first item’s preview into #previewCard (caller should set target there).
    """
    pl = get_object_or_404(Playlist, id=playlist_id)
    item = pl.items.select_related("version").first()
    if not item:
        payload = {"type": None, "message": "Empty playlist."}
        html = render_to_string("AssetView/partials/_preview.html",
                                {"media_json": json.dumps(payload)}, request=request)
        return HttpResponse(html)

    v = item.version
    ma = _get_version_first_media(v)
    if not ma:
        payload = {"type": None, "message": "No media for version."}
        html = render_to_string("AssetView/partials/_preview.html",
                                {"media_json": json.dumps(payload)}, request=request)
        return HttpResponse(html)
    return _render_preview_partial(request, ma)


# --------------------------
# Compare (new HTMX API)
# --------------------------

def _payload_for_version(v_id: int) -> Dict[str, Any]:
    v = get_object_or_404(Version, id=v_id)
    ma = _get_version_first_media(v)
    if not ma:
        return {"type": None, "message": "No media"}
    return _media_payload(ma)


@require_GET
@login_required
def compare_view(request: HttpRequest) -> HttpResponse:
    """
    GET /review/compare/?a=<ver_id>&b=<ver_id>&mode=side|overlay|diff
    Returns a panel with two previews or canvases depending on mode.
    """
    a_id = request.GET.get("a")
    b_id = request.GET.get("b")
    mode = (request.GET.get("mode") or "side").lower()
    if not a_id or not b_id:
        return HttpResponse(status=400)

    a_payload = _payload_for_version(int(a_id))
    b_payload = _payload_for_version(int(b_id))

    html = render_to_string(
        "AssetView/partials/compare_panel.html",
        {
            "mode": mode if mode in ("side", "overlay", "diff") else "side",
            "a_json": json.dumps(a_payload),
            "b_json": json.dumps(b_payload),
        },
        request=request,
    )
    return HttpResponse(html)
