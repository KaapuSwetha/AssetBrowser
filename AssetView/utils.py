# AssetView/utils.py
from __future__ import annotations

import datetime as dt
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, Mapping
from typing import Optional

# --- Paths & formats ----------------------------------------------------------
DRIVE_MAP = {
    "V:/": "/media/v_drive/",
    "N:/": "/media/n_drive/",
    "S:/": "/media/s_drive/",
    "C:/": "/media/c_drive/",
    "D:/": "/media/c_drive/",
}
__all__ = [
    'as_list',
    'entry_to_path',
    'basename_noext',
    'load_json',
    'coerce_scalar',
    'status_badge',
    'age_badge',
    'pretty',
    'web_path',
    'apply_status_badges',
    'ALL_STATUS',
    'path_date',  # Make sure this is defined
]

def as_list(v: Any) -> list:
    if v is None: return []
    return v if isinstance(v, list) else [v]


def entry_to_path(entry: Any) -> str:
    if isinstance(entry, str): return entry
    if isinstance(entry, Mapping):
        for k in ("PublishdFilePath", "Path", "FilePath", "path", "file"):
            if k in entry: return str(entry[k])
    return ""


def basename_noext(path: str) -> str:
    return Path(path).stem if path else ""


def web_path(p: str) -> str:
    if not p: return ""
    norm = p.replace("\\", "/")
    if norm.startswith(("/media/", "http://", "https://")): return norm
    if norm.startswith(("//", "\\\\")):
        share, *rest = norm.strip("/\\").split("/")
        return f"/media/{share.lower()}/" + "/".join(rest)
    for drive, mount in DRIVE_MAP.items():
        if norm.lower().startswith(drive.lower()):
            return mount + norm[len(drive):]
    return norm


def load_json(path: Path) -> dict:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return {}


def coerce_scalar(v: Any) -> str:
    if v is None: return ""
    if isinstance(v, list):
        for item in reversed(v):
            if item not in (None, "", [], {}): return str(item)
        return str(v[-1]) if v else ""
    if isinstance(v, Mapping):
        try:
            return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
        except Exception:
            return str(v)
    return str(v)


def path_date(p: str) -> Optional[dt.datetime]:
    """Return the file creation (or metadata change) date as a datetime object."""
    try:
        creation_time = os.path.getctime(p)
        return dt.datetime.fromtimestamp(creation_time)
    except FileNotFoundError:
        return None


def pretty(dtobj: Optional[dt.datetime]) -> str:
    """Format datetime nicely, or show '—' if None."""
    return dtobj.strftime("%d %b %Y, %I:%M %p") if dtobj else "—"


def age_badge(dtobj: dt.datetime | None) -> str:
    """
    Return a Tailwind-style color class based on the age of a datetime.
    - Green: within 30 days
    - Yellow: 31–90 days
    - Red: older than 90 days
    - Slate: no date provided
    """
    if not dtobj:
        return "bg-slate-600 text-white"
    now = dt.datetime.now(tz=dtobj.tzinfo) if dtobj.tzinfo else dt.datetime.now()
    age_days = (now - dtobj).days

    if age_days > 90:
        return "bg-red-600 text-white"
    elif age_days > 30:
        return "bg-yellow-500 text-black"
    else:
        return "bg-green-600 text-white"


# --- Status mapping -----------------------------------------------------------
STATUS_MAP: Mapping[str, Mapping[str, str]] = {
    "Internal Approved": {"cls": "bg-emerald-600 text-white", "icon": "fa-check-circle"},
    "Internal Review": {"cls": "bg-amber-500 text-black", "icon": "fa-hourglass-half"},
    "Internal Retake": {"cls": "bg-rose-500 text-white", "icon": "fa-undo"},
    "Client Approved": {"cls": "bg-emerald-800 text-white", "icon": "fa-thumbs-up"},
    "Client Review": {"cls": "bg-amber-600 text-black", "icon": "fa-eye"},
    "Client Retake": {"cls": "bg-rose-600 text-white", "icon": "fa-sync"},
    "Work In Progress": {"cls": "bg-sky-600 text-white", "icon": "fa-spinner"},
    "No Status": {"cls": "bg-slate-600 text-white", "icon": "fa-question"},
}
ALL_STATUS = [{"text": k, **v} for k, v in STATUS_MAP.items()]


def status_badge(text: str) -> Dict[str, str]:
    t = (text or "No Status").strip() or "No Status"
    meta = STATUS_MAP.get(t, STATUS_MAP["No Status"])
    return {"text": t, "cls": meta["cls"], "icon": meta["icon"]}


def apply_status_badges(data: Any, field: str = "Status", inplace: bool = False) -> Any:
    """
    Convert status strings to badge dicts.
    - str -> returns badge dict
    - dict with `field` -> returns dict with that field converted
    - list[dict] -> converts each item
    - dict with `rows` -> converts every row's `field`
    """
    # Case 1: single string
    if isinstance(data, str):
        return status_badge(data)

    # Decide whether to copy
    working = data if inplace else (
        data.copy() if isinstance(data, dict) else list(data) if isinstance(data, list) else data)

    # Case 2: list -> map each element
    if isinstance(working, list):
        return [apply_status_badges(item, field=field, inplace=False) for item in working]

    # Case 3: dicts
    if isinstance(working, dict):
        # If it has the status field directly
        if field in working and isinstance(working[field], (str, type(None))):
            new_obj = working if inplace else {**working}
            new_obj[field] = status_badge(working[field])
            return new_obj

        # If it looks like your multi-level structure with rows
        if "rows" in working and isinstance(working["rows"], list):
            new_obj = working if inplace else {**working}
            new_obj["rows"] = [apply_status_badges(row, field=field, inplace=False) if isinstance(row, dict) else row
                               for row in working["rows"]]
            return new_obj

    # Anything else: return as-is
    return working
# departments.py
from typing import Mapping, Dict

DEPT_MAP: Mapping[str, Mapping[str, str]] = {
    "01_Concepts":  {"cls": "border-sky-500/60 text-sky-300",       "icon": "fa-lightbulb"},
    "02_Scans":     {"cls": "border-cyan-500/60 text-cyan-300",     "icon": "fa-camera"},
    "03_Model":     {"cls": "border-teal-500/60 text-teal-300",     "icon": "fa-cube"},
    "04_Texture":   {"cls": "border-rose-500/60 text-rose-300",     "icon": "fa-fill-drip"},
    "05_Groom":     {"cls": "border-amber-500/60 text-amber-300",   "icon": "fa-scissors"},
    "06_Lookdev":   {"cls": "border-fuchsia-500/60 text-fuchsia-300","icon": "fa-flask"},
    "07_Rig":       {"cls": "border-orange-500/60 text-orange-300", "icon": "fa-sitemap"},
    "08_Layout":    {"cls": "border-emerald-500/60 text-emerald-300","icon": "fa-object-group"},
    "09_Animation": {"cls": "border-violet-500/60 text-violet-300",  "icon": "fa-person-running"},
    "10_Cfx":       {"cls": "border-indigo-500/60 text-indigo-300",  "icon": "fa-water"},
    "11_Cache":     {"cls": "border-slate-500/60 text-slate-300",    "icon": "fa-database"},
    "12_Lighting":  {"cls": "border-sky-400/60 text-sky-200",        "icon": "fa-sun"},
    "13_Render":    {"cls": "border-cyan-400/60 text-cyan-200",      "icon": "fa-photo-film"},
    "14_Comp":      {"cls": "border-lime-500/60 text-lime-300",      "icon": "fa-layer-group"},
    "15_Fx":        {"cls": "border-red-500/60 text-red-300",        "icon": "fa-bolt"},
    "16_Matchmove": {"cls": "border-yellow-500/60 text-yellow-300",  "icon": "fa-crosshairs"},
    "17_Roto":      {"cls": "border-zinc-500/60 text-zinc-300",      "icon": "fa-vector-square"},
    "18_Paint":     {"cls": "border-pink-500/60 text-pink-300",      "icon": "fa-paintbrush"},
    "19_Dmp":       {"cls": "border-green-500/60 text-green-300",    "icon": "fa-mountain"},
    "20_Env":       {"cls": "border-lime-600/60 text-lime-300",      "icon": "fa-tree"},
}

DEFAULT_DEPT: Dict[str, str] = {"cls": "border-slate-600/60 text-slate-300", "icon": "fa-folder"}
