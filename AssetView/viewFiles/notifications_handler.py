"""
AssetView/viewFiles/notifications_handler.py
Detects new keys/variants added to JSON files and manages persistent notifications.
"""
from __future__ import annotations
import json
import uuid
import logging
from pathlib import Path
from datetime import datetime
from typing import List, Dict

logger = logging.getLogger(__name__)

# ── Storage paths (sibling `data/` folder next to viewFiles/) ──────────────
_HERE = Path(__file__).parent
DATA_DIR        = _HERE.parent / "data"
NOTIFICATIONS_F = DATA_DIR / "notifications.json"
SNAPSHOT_F      = DATA_DIR / "json_snapshot.json"


def _ensure_data():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


# ── Low-level I/O ──────────────────────────────────────────────────────────
def _load_json_safe(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning(f"[notif] Could not read {path}: {exc}")
        return default


def _save_json(path: Path, obj):
    _ensure_data()
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")


# ── Public helpers ─────────────────────────────────────────────────────────
def load_notifications() -> List[Dict]:
    return _load_json_safe(NOTIFICATIONS_F, [])


def _save_notifications(notifications: List[Dict]):
    _save_json(NOTIFICATIONS_F, notifications)


def load_snapshot() -> Dict:
    return _load_json_safe(SNAPSHOT_F, {})


def _save_snapshot(snapshot: Dict):
    _save_json(SNAPSHOT_F, snapshot)


# ── Core scanner ───────────────────────────────────────────────────────────
def scan_json_for_new_keys(json_files: List[Path]) -> List[Dict]:
    """
    Compare current JSON variant/key state against the stored snapshot.
    Returns a list of brand-new notification dicts (already persisted).
    """
    old_snapshot = load_snapshot()
    new_snapshot: Dict = {}
    new_notifications: List[Dict] = []

    for json_file in json_files:
        if not json_file.is_file():
            continue

        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning(f"[notif] Bad JSON {json_file}: {exc}")
            continue

        file_key = str(json_file)

        for section in ("asset_info", "sequence_info"):
            blob = data.get(section) or {}

            for asset_name, asset_data in blob.items():
                if not isinstance(asset_data, dict):
                    continue

                # ── 1. Variant keys ────────────────────────────────────────
                variants: Dict[str, bool] = {}
                if "Variants" in asset_data and isinstance(asset_data["Variants"], dict):
                    variants = {k: True for k in asset_data["Variants"]}

                snap_key = f"{file_key}::{section}::{asset_name}::variants"
                old_variants = old_snapshot.get(snap_key, {})
                new_snapshot[snap_key] = variants

                for variant_name in variants:
                    if variant_name not in old_variants and old_variants:
                        # Only fire for truly new keys (skip first-ever scan)
                        new_notifications.append(_make_notif(
                            notif_type="new_variant",
                            asset=asset_name,
                            key=variant_name,
                            json_path=str(json_file),
                            title=f"New variant added",
                            message=f'"{variant_name}" was added to {asset_name}',
                        ))

                # ── 2. Top-level keys (non-Variants) ──────────────────────
                top_keys = {k for k in asset_data if k != "Variants"}
                tk_snap_key = f"{file_key}::{section}::{asset_name}::topkeys"
                old_top_keys: set = set(old_snapshot.get(tk_snap_key, {}).keys())
                new_snapshot[tk_snap_key] = {k: True for k in top_keys}

                for key_name in top_keys - old_top_keys:
                    if old_top_keys:           # skip first-ever scan
                        new_notifications.append(_make_notif(
                            notif_type="new_key",
                            asset=asset_name,
                            key=key_name,
                            json_path=str(json_file),
                            title=f"New field added",
                            message=f'"{key_name}" was added to {asset_name}',
                        ))

    _save_snapshot(new_snapshot)

    if new_notifications:
        existing = load_notifications()
        existing.extend(new_notifications)
        _save_notifications(existing)

    return new_notifications


def _make_notif(*, notif_type, asset, key, json_path, title, message) -> Dict:
    return {
        "id":        str(uuid.uuid4()),
        "type":      notif_type,
        "asset":     asset,
        "key":       key,
        "json_path": json_path,
        "timestamp": datetime.now().isoformat(),
        "read":      False,
        "title":     title,
        "message":   message,
    }


# ── Read/dismiss helpers ───────────────────────────────────────────────────
def get_unread_notifications() -> List[Dict]:
    return [n for n in load_notifications() if not n.get("read")]


def mark_notification_read(notification_id: str) -> bool:
    notifications = load_notifications()
    found = False
    for n in notifications:
        if n.get("id") == notification_id:
            n["read"] = True
            found = True
    if found:
        _save_notifications(notifications)
    return found


def mark_all_read() -> int:
    notifications = load_notifications()
    count = sum(1 for n in notifications if not n.get("read"))
    for n in notifications:
        n["read"] = True
    if count:
        _save_notifications(notifications)
    return count


def delete_notification(notification_id: str) -> bool:
    notifications = load_notifications()
    before = len(notifications)
    notifications = [n for n in notifications if n.get("id") != notification_id]
    if len(notifications) < before:
        _save_notifications(notifications)
        return True
    return False