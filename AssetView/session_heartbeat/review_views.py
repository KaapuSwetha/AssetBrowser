# AssetView/views/review_views.py
"""
Universal Review Backend (Drive-Mapped Edition)
- Handles EXR/linear decoding, thumbnails, and streamable video cache
- Converts Windows drive paths (N:/S:/V:) to web URLs automatically
"""

import io
import json
from pathlib import Path
from datetime import datetime, timezone
from django.http import JsonResponse, FileResponse, HttpResponseBadRequest
from django.views.decorators.http import require_GET, require_POST
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings

from utils.logger import get_logger
from utils.media_utils import (
    media_kind, is_sequence_member, sequence_glob_for,
    decode_linear_image_to_png, ensure_streamable_video,
    generate_thumbnail
)
from utils.path_utils import convert_preview_path

logger = get_logger(__name__)

def _json_ok(**payload): return JsonResponse({"ok": True, **payload})
def _json_err(msg, code=400): return JsonResponse({"ok": False, "error": msg}, status=code)


# ----------------------------------------------------------------------
# Sequence listing
# ----------------------------------------------------------------------
@require_GET
def review_sequence(request):
    raw = request.GET.get("dir", "").strip()
    if not raw:
        return _json_err("Missing dir")

    # If frontend passed a web path (/media/n_drive/...), resolve it to disk
    if raw.lower().startswith("/media/"):
        raw = (Path(settings.BASE_DIR) / raw.lstrip("/")).as_posix()

    p = Path(raw)
    if not p.exists():
        return _json_err(f"Path does not exist: {p}", 400)

    # Handle a directory (list images)
    if p.is_dir():
        images = sorted([f for f in p.iterdir() if f.is_file() and media_kind(f) == "image"])
        frames = [{"index": i, "path": convert_preview_path(str(f)) or str(f)} for i, f in enumerate(images)]
        return _json_ok(sequence=frames, count=len(frames))

    # Handle a file (expand to sequence if possible)
    if p.is_file():
        if media_kind(p) != "image":
            return _json_ok(sequence=[{"index": 0, "path": convert_preview_path(str(p)) or str(p)}], count=1)
        _, members = sequence_glob_for(p)
        frames = [{"index": i, "path": convert_preview_path(str(f)) or str(f)} for i, f in enumerate(members)]
        return _json_ok(sequence=frames, count=len(frames))

    return _json_err("Invalid path")


# ----------------------------------------------------------------------
# Frame streaming (image/EXR)
# ----------------------------------------------------------------------
@require_GET
def review_frame(request):
    raw = request.GET.get("path", "").strip()
    if not raw:
        return _json_err("Missing path")

    # Allow serving /media/n_drive/... URLs directly
    if raw.lower().startswith("/media/"):
        p = Path(settings.BASE_DIR) / raw.lstrip("/")
    else:
        p = Path(raw)

    if not p.exists():
        return _json_err(f"File not found: {p}", 404)

    exposure = float(request.GET.get("exposure", "0.0"))
    gamma = float(request.GET.get("gamma", "2.2"))
    ext = p.suffix.lower()
    kind = media_kind(p)

    # Serve directly for browser-native formats
    if kind == "image" and ext in {".png", ".jpg", ".jpeg", ".webp"}:
        mime = f"image/{'jpeg' if ext in {'.jpg', '.jpeg'} else ext[1:]}"
        return FileResponse(open(p, "rb"), content_type=mime)

    # Decode EXR/HDR/TIFF to PNG
    if kind == "image" and ext in {".exr", ".hdr", ".tif", ".tiff"}:
        png_bytes = decode_linear_image_to_png(p, exposure=exposure, gamma=gamma)
        if not png_bytes:
            return _json_err("Decode failed", 500)
        return FileResponse(io.BytesIO(png_bytes), content_type="image/png")

    return FileResponse(open(p, "rb"), content_type="application/octet-stream")


# ----------------------------------------------------------------------
# Video streaming (MP4 cache)
# ----------------------------------------------------------------------
@require_GET
def review_video(request):
    raw = request.GET.get("path", "").strip()
    if not raw:
        return _json_err("Missing path")

    # Convert web media path to filesystem path if needed
    if raw.lower().startswith("/media/"):
        p = Path(settings.BASE_DIR) / raw.lstrip("/")
    else:
        p = Path(raw)

    if not p.exists():
        return _json_err(f"Video not found: {p}", 404)

    cache_dir = Path(settings.MEDIA_ROOT) / "cache" / "video"
    streamable = ensure_streamable_video(p, cache_dir)
    if not streamable or not streamable.exists():
        return _json_err("Transcode failed", 500)

    rel = str(streamable).replace(str(settings.MEDIA_ROOT), "").replace("\\", "/").lstrip("/")
    return JsonResponse({"url": f"{settings.MEDIA_URL}{rel}"})


# ----------------------------------------------------------------------
# Thumbnail generation
# ----------------------------------------------------------------------
@require_GET
def review_thumbnail(request):
    raw = request.GET.get("path", "").strip()
    if not raw:
        return _json_err("Missing path")

    if raw.lower().startswith("/media/"):
        p = Path(settings.BASE_DIR) / raw.lstrip("/")
    else:
        p = Path(raw)

    if not p.exists():
        return _json_err(f"File not found: {p}", 404)

    cache_dir = Path(settings.MEDIA_ROOT) / "cache" / "thumbs"
    out = generate_thumbnail(p, cache_dir)
    if not out:
        return _json_err("Thumbnail generation failed", 500)

    rel = str(out).replace(str(settings.MEDIA_ROOT), "").replace("\\", "/").lstrip("/")
    return JsonResponse({"thumb": f"{settings.MEDIA_URL}{rel}"})


# ----------------------------------------------------------------------
# Review comments (append to JSON)
# ----------------------------------------------------------------------
def _append_review_comment(json_path: Path, frame: int, comment: str, author: str) -> bool:
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        notes = data.setdefault("ReviewNotes", [])
        notes.append({
            "frame": int(frame),
            "comment": comment,
            "author": author or "anonymous",
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        tmp = json_path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        tmp.replace(json_path)
        return True
    except Exception as e:
        logger.exception("Append comment failed: %s", e)
        return False


@csrf_exempt
@require_POST
def review_comment(request):
    try:
        payload = json.loads(request.body.decode("utf-8"))
        json_path = Path(payload.get("json_path", ""))
        frame = int(payload.get("frame", 0))
        comment = (payload.get("comment") or "").strip()
        author = payload.get("author") or "anonymous"

        if not json_path.exists():
            return _json_err("Invalid json_path", 400)
        if not comment:
            return _json_err("Empty comment", 400)

        ok = _append_review_comment(json_path, frame, comment, author)
        if ok:
            return _json_ok(frame=frame, comment=comment)
        return _json_err("Update failed", 500)
    except Exception as e:
        logger.exception("review_comment error: %s", e)
        return _json_err("Internal error", 500)
