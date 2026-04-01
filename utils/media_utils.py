# utils/media_utils.py
"""
Media helpers for flexible review:
 - Detect image/video/sequence
 - Decode EXR/HDR/TIFF to PNG bytes (in-memory) for web display
 - Generate thumbnails
 - Transcode non-browser-friendly MOV/ProRes -> MP4 (cached)
"""

import hashlib
import io
import json
import re
import subprocess
from pathlib import Path
from typing import List, Tuple, Optional

import numpy as np
from django.conf import settings

from utils.logger import get_logger

FFMPEG = getattr(settings, "FFMPEG_BIN", "ffmpeg")

logger = get_logger(__name__)

# Try OIIO first, fallback to OpenEXR+PIL
OIIO_AVAILABLE = False
OPENEXR_AVAILABLE = False
PIL_AVAILABLE = False

try:
    import OpenImageIO as oiio  # type: ignore

    OIIO_AVAILABLE = True
except Exception:
    pass

try:
    import OpenEXR, Imath  # type: ignore

    OPENEXR_AVAILABLE = True
except Exception:
    pass

try:
    from PIL import Image  # type: ignore

    PIL_AVAILABLE = True
except Exception:
    pass

IMG_EXTS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp", ".bmp", ".gif", ".exr", ".hdr"}
VIDEO_EXTS = {".mov", ".mp4", ".m4v", ".webm", ".mkv", ".avi", ".wmv", ".mxf"}


def sha1_of_text(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()


def media_kind(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in IMG_EXTS:
        return "image"
    if ext in VIDEO_EXTS:
        return "video"
    return "unknown"


def is_sequence_member(name: str) -> bool:
    # match name.0001.exr or name_0001.png etc.
    return bool(re.search(r"(?:\.|_|-)(\d{3,6})(?=\.[^.]+$)", name))


def sequence_glob_for(path: Path) -> Tuple[Path, List[Path]]:
    """
    Given one file in a sequence, return (dir, sorted_all_members).
    """
    d = path.parent
    n = path.name
    m = re.search(r"(.*?)(?:\.|_|-)(\d{3,6})(\.[^.]+)$", n)
    if not m:
        return d, [path]
    prefix, frame, ext = m.group(1), m.group(2), m.group(3)
    pattern = re.compile(rf"^{re.escape(prefix)}(?:\.|_|-)\d{{{len(frame)}}}{re.escape(ext)}$")
    members = sorted([p for p in d.iterdir() if p.is_file() and pattern.match(p.name)])
    return d, members


# -----------------------------
# EXR/HDR/TIFF decoding to PNG
# -----------------------------
def _decode_exr_oiio(path: Path, exposure: float, gamma: float) -> Optional[bytes]:
    try:
        inp = oiio.ImageInput.open(str(path))
        if not inp:
            return None
        spec = inp.spec()
        pixels = inp.read_image(format=oiio.FLOAT)
        arr = np.array(pixels, dtype=np.float32).reshape(spec.height, spec.width, spec.nchannels)
        inp.close()

        # tonemap
        arr = arr * (2.0 ** exposure)
        arr = np.clip(arr, 0, 1) ** (1.0 / max(gamma, 1e-6))
        arr = (arr * 255.0 + 0.5).astype(np.uint8)
        if arr.shape[2] >= 3:
            arr = arr[:, :, :3]
        elif arr.shape[2] == 1:
            arr = np.repeat(arr, 3, axis=2)

        from PIL import Image
        im = Image.fromarray(arr, mode="RGB")
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        buf.seek(0)
        return buf.getvalue()
    except Exception as e:
        logger.exception("OIIO EXR decode failed: %s", e)
        return None


def _decode_exr_openexr(path: Path, exposure: float, gamma: float) -> Optional[bytes]:
    if not (OPENEXR_AVAILABLE and PIL_AVAILABLE):
        return None
    try:
        import numpy as np
        file = OpenEXR.InputFile(str(path))
        dw = file.header()['dataWindow']
        size = (dw.max.x - dw.min.x + 1, dw.max.y - dw.min.y + 1)
        pt = Imath.PixelType(Imath.PixelType.FLOAT)
        channels = []
        for c in ("R", "G", "B"):
            try:
                channels.append(np.frombuffer(file.channel(c, pt), dtype=np.float32))
            except Exception:
                channels.append(np.zeros(size[0] * size[1], dtype=np.float32))
        img = np.stack(channels, axis=-1).reshape(size[1], size[0], 3)
        img = np.clip(img * (2.0 ** exposure), 0, 1) ** (1.0 / max(gamma, 1e-6))
        img = (img * 255.0 + 0.5).astype(np.uint8)

        from PIL import Image
        im = Image.fromarray(img, mode="RGB")
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        buf.seek(0)
        return buf.getvalue()
    except Exception as e:
        logger.exception("OpenEXR decode failed: %s", e)
        return None


def decode_linear_image_to_png(path: Path, exposure: float = 0.0, gamma: float = 2.2) -> Optional[bytes]:
    # EXR/HDR/TIFF: prefer OIIO pipeline; TIFF 16-bit handled by Pillow
    ext = path.suffix.lower()
    if ext in {".exr", ".hdr"}:
        if OIIO_AVAILABLE:
            return _decode_exr_oiio(path, exposure, gamma)
        return _decode_exr_openexr(path, exposure, gamma)
    if ext in {".tif", ".tiff"} and PIL_AVAILABLE:
        try:
            from PIL import Image, ImageOps
            im = Image.open(str(path))
            im = ImageOps.autocontrast(im)
            buf = io.BytesIO()
            im.save(buf, format="PNG")
            buf.seek(0)
            return buf.getvalue()
        except Exception as e:
            logger.exception("TIFF decode failed: %s", e)
            return None
    return None


# -----------------------------
# Video transcode (to MP4 H.264)
# -----------------------------
def ensure_streamable_video(path: Path, cache_dir: Path) -> Optional[Path]:
    """
    If the video isn't natively streamable in browsers, transcode to MP4 (H.264/AAC).
    Returns path to cached MP4.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    key = sha1_of_text(str(path.resolve()))
    out_path = cache_dir / f"{key}.mp4"
    if out_path.exists():
        return out_path

    # Use ffprobe to inspect container/codec quickly
    try:
        prob = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
             "stream=codec_name,codec_type", "-of", "json", str(path)],
            capture_output=True, text=True, check=False
        )
        info = json.loads(prob.stdout or "{}")
        vcodec = (info.get("streams", [{}])[0] or {}).get("codec_name", "")
    except Exception:
        vcodec = ""

    # If already h264 and extension mp4/m4v, we can serve directly (most cases)
    if path.suffix.lower() in {".mp4", ".m4v"} and vcodec in {"h264", "avc1"}:
        return path

    # Transcode to a web-friendly MP4
    try:
        cmd = [
            FFMPEG, "-y", "-i", str(path),
            "-map", "0:v:0", "-map", "0:a:0?",  # include audio if present
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k",
            str(out_path)
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return out_path
    except Exception as e:
        logger.exception("ffmpeg transcode failed: %s", e)
        return None


# -----------------------------
# Thumbnails
# -----------------------------
def generate_thumbnail(path: Path, cache_dir: Path) -> Optional[Path]:
    """
    Create a 512px thumbnail for images/videos; returns cached file path.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    key = sha1_of_text(str(path.resolve()))
    out = cache_dir / f"{key}.jpg"
    if out.exists():
        return out

    kind = media_kind(path)
    try:
        if kind == "image":
            if path.suffix.lower() in {".exr", ".hdr", ".tif", ".tiff"}:
                png_bytes = decode_linear_image_to_png(path)  # tonemapped
                if not png_bytes:
                    return None
                from PIL import Image
                im = Image.open(io.BytesIO(png_bytes))
            else:
                from PIL import Image
                im = Image.open(str(path))
            im.thumbnail((512, 512))
            im.convert("RGB").save(str(out), "JPEG", quality=85)
            return out

        if kind == "video":
            # grab frame at 1s
            cmd = ["ffmpeg", "-y", "-ss", "1.0", "-i", str(path), "-frames:v", "1",
                   "-vf", "scale='min(512,iw)':-2", str(out)]
            subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            return out
    except Exception as e:
        logger.exception("thumbnail generation failed: %s", e)
        return None

    return None
