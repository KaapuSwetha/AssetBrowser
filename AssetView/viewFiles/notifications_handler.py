"""
notifications_handler.py  –  HaloHues ATLAS
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Paths ──────────────────────────────────────────────────────────────────
_HERE       = Path(__file__).parent
DATA_DIR    = _HERE.parent / "data"
NOTIFICATIONS_F = DATA_DIR / "notifications.json"
MTIMES_F        = DATA_DIR / "file_mtimes.json"
USER_STATE_DIR  = DATA_DIR / "user_state"
SEEDED_FLAG     = DATA_DIR / "seeded.flag"
SNAPSHOT_F      = DATA_DIR / "json_snapshot.json"
_SCAN_LOCK = threading.Lock()

# Sentinel key suffix stored per-file so we know the file has been fully seeded
_FILE_SEEDED_SUFFIX = "::__file_seeded__"

# ── Department maps ────────────────────────────────────────────────────────
_DEPT_MAP = {
    "03_model":     "Model",
    "04_texture":   "Surfacing",
    "05_groom":     "Groom",
    "06_lookdev":   "Surfacing",
    "07_rig":       "Rigging",
    "08_previz":    "Previz",
    "09_animation": "Animation",
    "10_matchmove": "Matchmove",
    "11_cache":     "Cache",
    "12_lighting":  "Lighting",
    "14_comp":      "Compositing",
    "16_matchmove": "Matchmove",
     "17_Roto":      "Roto",
}

_DEPT_LABEL_MAP = {
    "Modeling":    "Model",
    "Rigging":     "Rigging",
    "Texturing":   "Surfacing",
    "FX":          "FX",
    "Animation":   "Animation",
    "Matchmove":   "Matchmove",
    "Roto":        "Roto",
    "Lighting":    "Lighting",
    "Compositing": "Compositing",
    "Environment": "Layout",
    "Cache":       "Cache",
    "Previz":      "Previz",
    "Crowd":       "Crowd",
}

_CONFIG_PATH = DATA_DIR / "department_config.json"


# ══════════════════════════════════════════════════════════════════════════════
# SMALL HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _as_list(value: Any) -> list:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _norm(v: Any) -> str:
    return str(v).strip() if v is not None else ""


def _norm_path(p: str | Path) -> str:
    return str(p).replace("\\", "/").lower().rstrip("/")


def _extract_dept(json_path: str) -> str:
    if not json_path:
        return ""
    norm = json_path.replace("\\", "/").lower()
    for folder, label in _DEPT_MAP.items():
        if f"/{folder}/" in norm:
            return label
    return ""


# ══════════════════════════════════════════════════════════════════════════════
# FILE I/O
# ══════════════════════════════════════════════════════════════════════════════

def _ensure_dirs():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    USER_STATE_DIR.mkdir(parents=True, exist_ok=True)


def _load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning(f"[notif] Could not read {path}: {exc}")
        return default


def _save_json(path: Path, obj: Any):
    _ensure_dirs()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def load_notifications() -> List[Dict]:
    return _load_json(NOTIFICATIONS_F, [])


def _save_notifications(notifications: List[Dict]):
    _save_json(NOTIFICATIONS_F, notifications)


def _load_snapshot() -> Dict:
    return _load_json(SNAPSHOT_F, {})


def _save_snapshot(snapshot: Dict):
    _save_json(SNAPSHOT_F, snapshot)


def _load_mtimes() -> Dict[str, float]:
    return _load_json(MTIMES_F, {})


def _save_mtimes(mtimes: Dict[str, float]):
    _save_json(MTIMES_F, mtimes)


# ══════════════════════════════════════════════════════════════════════════════
# SNAPSHOT KEY HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _file_sentinel_key(file_key: str) -> str:
    """Key that marks a file as fully seeded in the snapshot."""
    return f"{file_key}{_FILE_SEEDED_SUFFIX}"


def _item_key(file_key: str, section: str, name: str) -> str:
    """Key for a single asset/shot snapshot entry."""
    return f"{file_key}::{section}::{name}"


# ══════════════════════════════════════════════════════════════════════════════
# USER STATE
# ══════════════════════════════════════════════════════════════════════════════

def _safe_username(username: str) -> str:
    if not username:
        return "anonymous"
    safe = re.sub(r"[^\w.\-@]", "_", username.strip())
    return safe or "anonymous"


def _user_state_path(username: str) -> Path:
    return USER_STATE_DIR / f"{_safe_username(username)}.json"


_USER_STATE_LOCK = threading.Lock()

def _load_user_state(username: str) -> Dict:
    return _load_json(_user_state_path(username), {"read": {}, "deleted": {}})

def _save_user_state(username: str, state: Dict):
    with _USER_STATE_LOCK:
        _save_json(_user_state_path(username), state)


# ══════════════════════════════════════════════════════════════════════════════
# DEPT / PERMISSION HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _load_dept_config() -> dict:
    try:
        return json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def get_user_department(username: str) -> Optional[str]:
    config      = _load_dept_config()
    employee_db = config.get("Employee_DB", {})
    db_to_notif = {v: k for k, v in _DEPT_LABEL_MAP.items()}

    def _lookup(name: str) -> Optional[str]:
        for db_dept, members in employee_db.items():
            if name in members:
                return db_to_notif.get(db_dept, db_dept)
        return None

    result = _lookup(username)
    if result is None and "@" in username:
        result = _lookup(username.rsplit("@", 1)[0])
    return result


def _get_global_view_roles() -> set:
    return set(_load_dept_config().get("Global_View_Roles", []))


def _user_can_see_notif(user_dept: str, notif_dept: str) -> bool:
    if not user_dept or not notif_dept:
        return True
    if user_dept.lower() == notif_dept.lower():
        return True
    config  = _load_dept_config()
    dep     = config.get("Department_Dependency", {})
    reverse: Dict[str, List[str]] = {}
    for src, deps in dep.items():
        for d in deps:
            reverse.setdefault(d.lower(), []).append(src.lower())
    if user_dept.lower() in reverse.get(notif_dept.lower(), []):
        return True
    direct = [d.lower() for d in dep.get(notif_dept.lower(), [])]
    return user_dept.lower() in direct


# ══════════════════════════════════════════════════════════════════════════════
# PUBLIC NOTIFICATION API
# ══════════════════════════════════════════════════════════════════════════════

def get_unread_notifications(username: str) -> List[Dict]:
    master       = load_notifications()
    state        = _load_user_state(username)
    user_read    = state.get("read", {})
    user_deleted = state.get("deleted", {})

    user_dept = get_user_department(username)
    is_global = user_dept in _get_global_view_roles() or user_dept is None

    result = []
    for n in master:
        nid = n.get("id")
        if user_deleted.get(nid) or user_read.get(nid):
            continue
        if not is_global:
            ndept = n.get("dept", "")
            if ndept and not _user_can_see_notif(user_dept, ndept):
                continue
        result.append(dict(n))
    return result


def mark_notification_read(notification_id: str, username: str) -> bool:
    with _USER_STATE_LOCK:
        state = _load_user_state(username)
        state.setdefault("read", {})[notification_id] = True
        _save_json(_user_state_path(username), state)
    return True

def mark_all_read(username: str) -> int:
    with _USER_STATE_LOCK:
        master = load_notifications()
        state  = _load_user_state(username)
        rdict  = state.setdefault("read", {})
        count  = sum(1 for n in master if not rdict.get(n.get("id")))
        for n in master:
            rdict[n.get("id")] = True
        if count:
            _save_json(_user_state_path(username), state)
    return count

def delete_notification(notification_id: str, username: str) -> bool:
    with _USER_STATE_LOCK:
        state = _load_user_state(username)
        state.setdefault("deleted", {})[notification_id] = True
        state.setdefault("read",    {})[notification_id] = True
        _save_json(_user_state_path(username), state)
    return True


# ══════════════════════════════════════════════════════════════════════════════
# NOTIFICATION FACTORY
# ══════════════════════════════════════════════════════════════════════════════

def _make_notif(
    *,
    notif_type: str,
    asset: str,
    key: str,
    json_path: str,
    message: str,
    variant: str = "",
) -> Dict:
    return {
        "id":        str(uuid.uuid4()),
        "type":      notif_type,
        "asset":     asset,
        "key":       key,
        "json_path": json_path,
        "dept":      _extract_dept(json_path),
        "variant":   variant,
        "timestamp": datetime.now().isoformat(),
        "message":   message,
    }


# ══════════════════════════════════════════════════════════════════════════════
# SNAPSHOT STRUCTURES
#
#  Per-file sentinel:
#    snapshot["<norm_file_path>::__file_seeded__"] = True
#    → marks the file as fully seeded; new items in this file = real new items
#
#  Flat shot (sequence / no Variants):
#    snapshot["<file_key>::<section>::<name>"] = {
#        "count":    int,           # number of PublishdFilePath entries
#        "statuses": [str, ...],    # normalised Status list
#        "comments": [str, ...],    # normalised PublishComment list
#    }
#
#  Variant asset (asset_info with Variants dict):
#    snapshot["<file_key>::<section>::<name>"] = {
#        "variants": {
#            "<variant_name>": {
#                "count":    int,
#                "statuses": [str, ...],
#                "comments": [str, ...],
#            }
#        }
#    }
# ══════════════════════════════════════════════════════════════════════════════

def _is_flat(item_data: dict) -> bool:
    """True when the item has no Variants dict – treat as flat version list."""
    return not bool(item_data.get("Variants"))


def _build_flat_snap(data: dict) -> Dict:
    publishes = _as_list(data.get("PublishdFilePath", []))
    statuses  = _as_list(data.get("Status", []))
    comments  = _as_list(data.get("PublishComment", []))
    return {
        "count":    len(publishes),
        "statuses": [_norm(s) for s in statuses],
        "comments": [_norm(c) for c in comments],
    }


def _build_asset_snap(data: dict) -> Dict:
    variants_raw = data.get("Variants") or {}
    variants: Dict[str, Dict] = {}
    for vname, vdata in variants_raw.items():
        if not isinstance(vdata, dict):
            continue
        asset_ids = _as_list(vdata.get("AssetId", []))
        statuses  = _as_list(vdata.get("Status", []))
        comments  = _as_list(vdata.get("PublishComment", []))
        variants[vname] = {
            "count": len(asset_ids),
            "asset_ids": [_norm(a) for a in asset_ids],
            "statuses": [_norm(s) for s in statuses],
            "comments": [_norm(c) for c in comments],
        }
    return {"variants": variants}


# ══════════════════════════════════════════════════════════════════════════════
# NEW-ITEM NOTIFICATION  (one shot, latest entry only)
# ══════════════════════════════════════════════════════════════════════════════

def _notify_new_item(
    name: str,
    item_data: dict,
    json_path: str,
    section: str,
) -> List[Dict]:
    """
    Emit exactly ONE notification for a brand-new item.
    Always points to the latest / most recent entry only.
    Never walks historical entries.
    """
    notifications: List[Dict] = []
    dept   = _extract_dept(json_path)
    is_seq = section == "sequence_info"

    if _is_flat(item_data):
        # ── Flat shot ────────────────────────────────────────────────────────
        publishes = _as_list(item_data.get("PublishdFilePath", []))
        statuses  = _as_list(item_data.get("Status", []))
        comments  = _as_list(item_data.get("PublishComment", []))

        if not publishes:
            # No published files yet – still notify but without version
            status  = _norm(statuses[-1]) if statuses else ""
            comment = _norm(comments[-1]) if comments else ""
            parts   = [f"{'Shot' if is_seq else 'Asset'}: {name}"]
            if dept:    parts.append(f"Dept: {dept}")
            if status:  parts.append(f"Status: {status}")
            if comment: parts.append(f"Comment: {comment}")
            notifications.append(_make_notif(
                notif_type="new_shot" if is_seq else "new_asset",
                asset=name, key=name,
                json_path=json_path,
                message="  |  ".join(parts),
            ))
            return notifications

        idx = len(publishes) - 1  # latest only
        version = f"v{idx + 1:03d}"
        status = _norm(statuses[idx]) if idx < len(statuses) else ""
        comment = _norm(comments[idx]) if idx < len(comments) else ""
        parts = [f"{'Shot' if is_seq else 'Asset'}: {name}"]
        if dept:    parts.append(f"Dept: {dept}")
        parts.append(f"Version: {version}")
        if status:  parts.append(f"Status: {status}")
        if comment: parts.append(f"Comment: {comment}")
        notifications.append(_make_notif(
            notif_type="new_shot" if is_seq else "new_asset",
            asset=name, key=f"{name} / {version}",
            json_path=json_path,
            message="  |  ".join(parts),
        ))

    else:
        # ── Variant asset – one notification per variant ──────────────────────
        variants_raw = item_data.get("Variants") or {}
        for vname, vdata in variants_raw.items():
            if not isinstance(vdata, dict):
                continue
            asset_ids = _as_list(vdata.get("AssetId", []))
            statuses  = _as_list(vdata.get("Status", []))
            comments  = _as_list(vdata.get("PublishComment", []))
            idx     = len(asset_ids) - 1 if asset_ids else -1
            status  = _norm(statuses[idx])  if idx >= 0 and idx < len(statuses)  else ""
            comment = _norm(comments[idx])  if idx >= 0 and idx < len(comments)  else ""
            asset_id = _norm(asset_ids[idx]) if idx >= 0 and idx < len(asset_ids) else ""
            parts = []
            if asset_id: parts.append(f"Asset ID: {asset_id}")
            if dept:     parts.append(f"Dept: {dept}")
            if status:   parts.append(f"Status: {status}")
            if comment:  parts.append(f"Comment: {comment}")
            notifications.append(_make_notif(
                notif_type="new_asset",
                asset=name, key=f"{name} / {vname}",
                json_path=json_path,
                message="  |  ".join(parts),
                variant=vname,
            ))

    return notifications


# ══════════════════════════════════════════════════════════════════════════════
# DIFF HELPERS  (existing item changed)
# ══════════════════════════════════════════════════════════════════════════════

def _diff_flat(
    name: str,
    old_snap: Dict,
    new_snap: Dict,
    json_path: str,
    section: str,
) -> List[Dict]:
    """
    Diff two flat snapshots. Emits:
      new_shot / new_asset   – for each batch of new entries (latest only)
      status_change          – status changed on an already-known entry
      comment_change         – comment changed on an already-known entry
    """
    notifications: List[Dict] = []
    dept   = _extract_dept(json_path)
    is_seq = section == "sequence_info"
    label  = "Shot" if is_seq else "Asset"
    ntype  = "new_shot" if is_seq else "new_asset"

    old_count    = old_snap.get("count", 0)
    new_count    = new_snap.get("count", 0)
    new_statuses = new_snap.get("statuses", [])
    new_comments = new_snap.get("comments", [])
    old_statuses = old_snap.get("statuses", [])
    old_comments = old_snap.get("comments", [])

    # ── 1. New entries: emit ONE notification pointing to the latest ─────────
    if new_count > old_count:
        idx = new_count - 1
        version = f"v{idx + 1:03d}"
        status = new_statuses[idx] if idx < len(new_statuses) else ""
        comment = new_comments[idx] if idx < len(new_comments) else ""
        parts = [f"{label}: {name}"]
        if dept:    parts.append(f"Dept: {dept}")
        parts.append(f"Version: {version}")
        if status:  parts.append(f"Status: {status}")
        if comment: parts.append(f"Comment: {comment}")
        notifications.append(_make_notif(
            notif_type=ntype, asset=name, key=f"{name} / {version}",
            json_path=json_path, message="  |  ".join(parts),
        ))

    # ── 2. Changes within already-known entries ──────────────────────────────
    for idx in range(min(old_count, new_count)):
        old_st = old_statuses[idx] if idx < len(old_statuses) else ""
        new_st = new_statuses[idx] if idx < len(new_statuses) else ""
        old_cm = old_comments[idx] if idx < len(old_comments) else ""
        new_cm = new_comments[idx] if idx < len(new_comments) else ""

        if old_st and new_st and old_st != new_st:
            parts = [f"{label}: {name}"]
            if dept: parts.append(f"Dept: {dept}")
            parts.append(f"Status: {old_st} → {new_st}")
            notifications.append(_make_notif(
                notif_type="status_change", asset=name, key=name,
                json_path=json_path, message="  |  ".join(parts),
            ))

        if old_cm and new_cm and old_cm != new_cm:
            parts = [f"{label}: {name}"]
            if dept: parts.append(f"Dept: {dept}")
            parts.append(f"Comment: {new_cm}")
            notifications.append(_make_notif(
                notif_type="comment_change", asset=name, key=name,
                json_path=json_path, message="  |  ".join(parts),
            ))

    return notifications


def _diff_asset(
    name: str,
    old_snap: Dict,
    new_snap: Dict,
    json_path: str,
) -> List[Dict]:
    """
    Diff two variant-asset snapshots. Emits:
      new_asset      – brand-new variant on a known asset
      new_version    – new AssetId entries in an existing variant
      status_change  – status changed on already-known entry
      comment_change – comment changed on already-known entry
    """
    notifications: List[Dict] = []
    dept         = _extract_dept(json_path)
    old_variants: Dict[str, Dict] = old_snap.get("variants", {})
    new_variants: Dict[str, Dict] = new_snap.get("variants", {})

    for vname, vnew in new_variants.items():
        vold = old_variants.get(vname)

        if vold is None:
            # Brand-new variant on a known asset
            status  = vnew["statuses"][-1] if vnew["statuses"] else ""
            comment = vnew["comments"][-1] if vnew["comments"] else ""
            asset_ids_list = vnew.get("asset_ids", [])
            asset_id = asset_ids_list[-1] if asset_ids_list else ""
            parts = []
            if asset_id: parts.append(f"Asset ID: {asset_id}")
            if dept:     parts.append(f"Dept: {dept}")
            if status:   parts.append(f"Status: {status}")
            if comment:  parts.append(f"Comment: {comment}")
            notifications.append(_make_notif(
                notif_type="new_asset",
                asset=name, key=f"{name} / {vname}",
                json_path=json_path, message="  |  ".join(parts),
                variant=vname,
            ))
            continue

        old_count    = vold.get("count", 0)
        new_count    = vnew.get("count", 0)
        new_statuses = vnew.get("statuses", [])
        new_comments = vnew.get("comments", [])
        old_statuses = vold.get("statuses", [])
        old_comments = vold.get("comments", [])

        # New version entries – latest only
        if new_count > old_count:
            idx = new_count - 1
            status = new_statuses[idx] if idx < len(new_statuses) else ""
            comment = new_comments[idx] if idx < len(new_comments) else ""
            asset_ids_list = vnew.get("asset_ids", [])
            asset_id = asset_ids_list[idx] if idx < len(asset_ids_list) else ""
            parts = []
            if asset_id: parts.append(f"Asset ID: {asset_id}")
            if dept:     parts.append(f"Dept: {dept}")
            if status:   parts.append(f"Status: {status}")
            if comment:  parts.append(f"Comment: {comment}")
            notifications.append(_make_notif(
                notif_type="new_version",
                asset=name, key=f"{name} / {vname}",
                json_path=json_path, message="  |  ".join(parts),
                variant=vname,
            ))
        # Changes within already-known entries
        for idx in range(min(old_count, new_count)):
            old_st = old_statuses[idx] if idx < len(old_statuses) else ""
            new_st = new_statuses[idx] if idx < len(new_statuses) else ""
            old_cm = old_comments[idx] if idx < len(old_comments) else ""
            new_cm = new_comments[idx] if idx < len(new_comments) else ""

            if old_st and new_st and old_st != new_st:
                parts = []
                if dept: parts.append(f"Dept: {dept}")
                parts.append(f"Status: {old_st} → {new_st}")
                notifications.append(_make_notif(
                    notif_type="status_change",
                    asset=name, key=f"{name} / {vname}",
                    json_path=json_path, message="  |  ".join(parts),
                    variant=vname,
                ))

            if old_cm and new_cm and old_cm != new_cm:
                parts = []
                if dept: parts.append(f"Dept: {dept}")
                parts.append(f"Comment: {new_cm}")
                notifications.append(_make_notif(
                    notif_type="comment_change",
                    asset=name, key=f"{name} / {vname}",
                    json_path=json_path, message="  |  ".join(parts),
                    variant=vname,
                ))

    return notifications


# ══════════════════════════════════════════════════════════════════════════════
# DEDUPLICATION
# ══════════════════════════════════════════════════════════════════════════════

_DEDUP_WINDOW_SEC = 600  # 10 minutes


def _notif_sig(n: Dict) -> str:
    """Stable identity signature – same content = same sig."""
    return (
        f"{n.get('type')}::{n.get('asset')}::{n.get('variant')}"
        f"::{n.get('dept')}"
    )


def _dedup(candidates: List[Dict], existing: List[Dict]) -> List[Dict]:
    now = datetime.now()

    existing_sigs: set = set()
    for n in existing:
        try:
            age = (now - datetime.fromisoformat(n["timestamp"])).total_seconds()
        except Exception:
            age = 0
        if age < _DEDUP_WINDOW_SEC:
            existing_sigs.add(_notif_sig(n))

    seen_sigs: set = set()
    result: List[Dict] = []
    for n in candidates:
        sig = _notif_sig(n)
        if sig in existing_sigs:
            logger.debug(f"[dedup] suppressed (on-disk): {sig}")
            continue
        if sig in seen_sigs:
            logger.debug(f"[dedup] suppressed (batch):   {sig}")
            continue
        seen_sigs.add(sig)
        result.append(n)

    return result


# ══════════════════════════════════════════════════════════════════════════════
# MAIN SCAN ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════

def scan_json_for_new_keys(json_files: List[Path]) -> List[Dict]:
    """
    Scan JSON files for changes and emit notifications.

    Decision tree per file
    ──────────────────────
    global seed run (seeded.flag absent)
        → seed ALL files silently, write flag, return []

    file sentinel NOT in snapshot  (file never seen before)
        → seed ALL items in that file silently
        → write file sentinel to snapshot
        → return [] for this file  ← KEY FIX: no notifications for new files

    file sentinel IN snapshot  (file was seen before)
        → for each item:
              item NOT in snapshot  → emit ONE new-item notification, then seed
              item IN snapshot      → diff old vs new, emit change notifications
    """
    with _SCAN_LOCK:
        is_seed      = not SEEDED_FLAG.exists()
        old_snapshot = _load_snapshot()

        if not old_snapshot:
            is_seed = True

        if is_seed:
            logger.info("[notif] Seed run – building snapshot silently.")

        new_snapshot    = dict(old_snapshot)
        all_new_notifs: List[Dict] = []

        for json_file in json_files:
            if not json_file.is_file():
                continue

            try:
                data = json.loads(json_file.read_text(encoding="utf-8"))
            except Exception as exc:
                logger.warning(f"[notif] Bad JSON {json_file}: {exc}")
                continue

            file_key     = _norm_path(json_file)
            sentinel_key = _file_sentinel_key(file_key)

            # ── Has this specific file been fully seeded before? ─────────────
            file_is_seeded = sentinel_key in old_snapshot

            if is_seed or not file_is_seeded:
                # ── Seed this file silently ──────────────────────────────────
                # Store snapshot for every item but emit ZERO notifications.
                # This covers both:
                #   (a) global seed run on first boot
                #   (b) a brand-new JSON file added after initial seed
                for section in ("asset_info", "sequence_info"):
                    blob: Dict[str, Any] = data.get(section) or {}
                    for name, item_data in blob.items():
                        if not isinstance(item_data, dict):
                            continue
                        ik = _item_key(file_key, section, name)
                        if _is_flat(item_data):
                            new_snapshot[ik] = _build_flat_snap(item_data)
                        else:
                            new_snapshot[ik] = _build_asset_snap(item_data)

                # Mark the file as seeded so next scan diffs it normally
                new_snapshot[sentinel_key] = True
                logger.info(
                    f"[notif] {'Seed' if is_seed else 'New file seeded silently'}: "
                    f"{json_file.name}"
                )
                continue   # ← no notifications for this file on this pass

            # ── File is known – diff each item ───────────────────────────────
            for section in ("asset_info", "sequence_info"):
                blob: Dict[str, Any] = data.get(section) or {}

                for name, item_data in blob.items():
                    if not isinstance(item_data, dict):
                        continue

                    ik   = _item_key(file_key, section, name)
                    flat = _is_flat(item_data)

                    new_snap = _build_flat_snap(item_data) if flat else _build_asset_snap(item_data)
                    old_snap = old_snapshot.get(ik)

                    if old_snap is None:
                        # ── Brand-new item in a known file ───────────────────
                        # This is a REAL new asset/shot the user just published.
                        logger.info(
                            f"[notif] New item in known file: "
                            f"{name} ({section}) in {json_file.name}"
                        )
                        notifs = _notify_new_item(name, item_data, str(json_file), section)
                        all_new_notifs.extend(notifs)
                        new_snapshot[ik] = new_snap   # seed it now
                        continue

                    # ── Known item – diff for changes ────────────────────────
                    if flat:
                        notifs = _diff_flat(name, old_snap, new_snap,
                                            str(json_file), section)
                    else:
                        notifs = _diff_asset(name, old_snap, new_snap,
                                             str(json_file))

                    all_new_notifs.extend(notifs)
                    new_snapshot[ik] = new_snap   # always advance snapshot

        # ── Persist snapshot ─────────────────────────────────────────────────
        _save_snapshot(new_snapshot)

        if is_seed:
            SEEDED_FLAG.write_text("seeded", encoding="utf-8")
            logger.info("[notif] Seed complete – future scans will generate notifications.")
            return []

        # ── Dedup + persist notifications ────────────────────────────────────
        if all_new_notifs:
            existing = load_notifications()
            to_save  = _dedup(all_new_notifs, existing)
            if to_save:
                existing.extend(to_save)
                _save_notifications(existing)
                logger.info(
                    f"[notif] {len(to_save)} new notification(s) saved "
                    f"({len(all_new_notifs) - len(to_save)} suppressed)."
                )

        return all_new_notifs


# ══════════════════════════════════════════════════════════════════════════════
# BACKGROUND WATCHER
# ══════════════════════════════════════════════════════════════════════════════

_watcher_started = False
_watcher_lock    = threading.Lock()


def start_background_watcher(get_json_files_fn, interval_seconds: int = 3):
    """
    Start a daemon thread that watches JSON files for mtime changes
    and calls scan_json_for_new_keys when any file changes.
    Safe to call multiple times – only the first call starts a thread.
    """
    global _watcher_started
    with _watcher_lock:
        if _watcher_started:
            return
        _watcher_started = True

    def _watch():
        last_mtimes: Dict[str, float] = _load_mtimes()

        while True:
            try:
                files   = get_json_files_fn()
                changed = []

                for f in files:
                    try:
                        mtime = f.stat().st_mtime
                    except OSError:
                        continue
                    nk = _norm_path(f)
                    if last_mtimes.get(nk) != mtime:
                        changed.append(f)
                    last_mtimes[nk] = mtime

                if changed:
                    time.sleep(1.0)   # let the writer finish flushing
                    scan_json_for_new_keys(changed)
                    _save_mtimes(last_mtimes)

            except Exception as exc:
                logger.warning(f"[watcher] error: {exc}")

            time.sleep(interval_seconds)

    t = threading.Thread(target=_watch, daemon=True, name="notif-watcher")
    t.start()
    logger.info(f"[watcher] started (interval={interval_seconds}s)")