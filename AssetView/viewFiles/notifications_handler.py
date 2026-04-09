"""
AssetView/viewFiles/notifications_handler.py

Two-file design:
  notifications.json        — shared master list of every notification generated.
                              No user read/dismissed state stored here.
  user_state/<user>.json    — per-user dict:
                              {
                                "read":    {"<notif_id>": true, ...},
                                "deleted": {"<notif_id>": true, ...}
                              }

This means:
  • A new notification appears for ALL users simultaneously.
  • Marking read / dismissing only affects the current user's state file.
  • Other users still see the notification as unread until they act on it.
"""
from __future__ import annotations
import json
import uuid
import logging
import re
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

# ── Storage paths ──────────────────────────────────────────────────────────
_HERE           = Path(__file__).parent
DATA_DIR        = _HERE.parent / "data"
NOTIFICATIONS_F = DATA_DIR / "notifications.json"   # shared master list
SNAPSHOT_F      = DATA_DIR / "json_snapshot.json"   # change-detection snapshot
USER_STATE_DIR  = DATA_DIR / "user_state"           # one JSON file per user

# ── Field classification ───────────────────────────────────────────────────
_VERSIONED_FIELDS = {"PublishdFilePath", "PreviewPath", "FileName", "AssetId", "Alembic", "Usd"}
_STATUS_FIELD     = "Status"
_COMMENT_FIELD    = "PublishComment"
_SKIP_FIELDS      = {"History"}


# ── Bootstrap ─────────────────────────────────────────────────────────────
def _ensure_data():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    USER_STATE_DIR.mkdir(parents=True, exist_ok=True)


# ── Generic JSON helpers ───────────────────────────────────────────────────
def _load_json_safe(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning(f"[notif] Could not read {path}: {exc}")
        return default


def _save_json(path: Path, obj: Any):
    _ensure_data()
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")


# ── Shared master notification list ───────────────────────────────────────
def load_notifications() -> List[Dict]:
    return _load_json_safe(NOTIFICATIONS_F, [])


def _save_notifications(notifications: List[Dict]):
    _save_json(NOTIFICATIONS_F, notifications)


# ── Snapshot (change detection) ───────────────────────────────────────────
def load_snapshot() -> Dict:
    return _load_json_safe(SNAPSHOT_F, {})


def _save_snapshot(snapshot: Dict):
    _save_json(SNAPSHOT_F, snapshot)


# ── Per-user state helpers ─────────────────────────────────────────────────
def _safe_username(username: str) -> str:
    """Sanitise username so it is safe as a filename."""
    if not username:
        return "anonymous"
    safe = re.sub(r"[^\w.\-]", "_", username.strip())
    return safe or "anonymous"


def _user_state_path(username: str) -> Path:
    return USER_STATE_DIR / f"{_safe_username(username)}.json"


def _load_user_state(username: str) -> Dict:
    """
    Returns { "read": {id: true, ...}, "deleted": {id: true, ...} }
    """
    return _load_json_safe(
        _user_state_path(username),
        {"read": {}, "deleted": {}},
    )


def _save_user_state(username: str, state: Dict):
    _save_json(_user_state_path(username), state)


# ── Public query ───────────────────────────────────────────────────────────
def get_unread_notifications(username: str) -> List[Dict]:
    """
    Return notifications that this user has NOT yet read and NOT deleted.
    The master list is filtered through the user's personal state.
    """
    master       = load_notifications()
    user_state   = _load_user_state(username)
    user_read    = user_state.get("read",    {})
    user_deleted = user_state.get("deleted", {})

    result = []
    for n in master:
        nid = n.get("id")
        if user_deleted.get(nid):
            continue                        # user dismissed — skip
        if user_read.get(nid):
            continue                        # user already read — skip
        result.append(dict(n))              # fresh copy, no shared mutation
    return result


# ── Per-user read / dismiss ────────────────────────────────────────────────
def mark_notification_read(notification_id: str, username: str) -> bool:
    """Mark one notification as read for THIS user only."""
    state = _load_user_state(username)
    state.setdefault("read", {})[notification_id] = True
    _save_user_state(username, state)
    return True


def mark_all_read(username: str) -> int:
    """Mark every notification as read for THIS user only."""
    master = load_notifications()
    state  = _load_user_state(username)
    state.setdefault("read", {})
    count  = 0
    for n in master:
        nid = n.get("id")
        if not state["read"].get(nid):
            state["read"][nid] = True
            count += 1
    if count:
        _save_user_state(username, state)
    return count


def delete_notification(notification_id: str, username: str) -> bool:
    """
    'Delete' a notification for THIS user only.
    The master list stays intact so other users are unaffected.
    """
    state = _load_user_state(username)
    state.setdefault("deleted", {})[notification_id] = True
    state.setdefault("read",    {})[notification_id] = True  # also counts as read
    _save_user_state(username, state)
    return True


# ── Fingerprinting & diffing ───────────────────────────────────────────────
def _as_list(value: Any) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _normalise_val(v: Any) -> str:
    if v is None:
        return ""
    return str(v).strip()


def _variant_fingerprint(variant_data: dict) -> dict:
    fields: Dict[str, list] = {}
    for key, value in variant_data.items():
        if key in _SKIP_FIELDS:
            continue
        fields[key] = _as_list(value)
    return {
        "fields":   fields,
        "top_keys": sorted(variant_data.keys()),
    }


def _diff_field_lists(
    old_vals: list,
    new_vals: list,
    field: str,
    asset_name: str,
    variant_name: str,
    json_path: str,
    notif_type: str,
    title_prefix: str,
) -> List[Dict]:
    notifications: List[Dict] = []

    # Changed entries at existing indexes
    for idx in range(min(len(old_vals), len(new_vals))):
        old_v = _normalise_val(old_vals[idx])
        new_v = _normalise_val(new_vals[idx])
        if old_v != new_v:
            notifications.append(_make_notif(
                notif_type=notif_type,
                asset=asset_name,
                key=f"{variant_name} / {field}",
                json_path=json_path,
                title=f"{title_prefix} changed in {variant_name}",
                message=(
                    f'{asset_name} › {variant_name} [{field}][{idx}]: '
                    f'"{old_v}" → "{new_v}"'
                ),
            ))

    # Newly appended entries
    for idx in range(len(old_vals), len(new_vals)):
        new_v = _normalise_val(new_vals[idx])
        notifications.append(_make_notif(
            notif_type=notif_type,
            asset=asset_name,
            key=f"{variant_name} / {field}",
            json_path=json_path,
            title=f"New {title_prefix.lower()} entry in {variant_name}",
            message=(
                f'{asset_name} › {variant_name} [{field}][{idx}]: '
                f'set to "{new_v}"'
            ),
        ))

    return notifications


def _diff_variant(
    asset_name: str,
    variant_name: str,
    old_fp: dict,
    new_fp: dict,
    json_path: str,
) -> List[Dict]:
    notifications: List[Dict] = []

    if not old_fp:
        return notifications   # first scan — build baseline only

    old_fields: Dict[str, list] = old_fp.get("fields", {})
    new_fields: Dict[str, list] = new_fp.get("fields", {})

    for field in set(old_fields) | set(new_fields):
        if field in _SKIP_FIELDS:
            continue

        old_vals = old_fields.get(field, [])
        new_vals = new_fields.get(field, [])

        if field == _STATUS_FIELD:
            notif_type, title_prefix = "status_change", "Status"
        elif field == _COMMENT_FIELD:
            notif_type, title_prefix = "comment_change", "Comment"
        elif field in _VERSIONED_FIELDS:
            notif_type, title_prefix = "new_version", "Publish"
        else:
            notif_type, title_prefix = "field_change", field

        notifications.extend(_diff_field_lists(
            old_vals=old_vals,
            new_vals=new_vals,
            field=field,
            asset_name=asset_name,
            variant_name=variant_name,
            json_path=json_path,
            notif_type=notif_type,
            title_prefix=title_prefix,
        ))

    # New field keys appearing inside the variant
    old_keys = set(old_fp.get("top_keys", []))
    new_keys = set(new_fp.get("top_keys", []))
    for key_name in new_keys - old_keys:
        if key_name in _SKIP_FIELDS:
            continue
        notifications.append(_make_notif(
            notif_type="new_key",
            asset=asset_name,
            key=key_name,
            json_path=json_path,
            title=f"New field added to {variant_name}",
            message=f'"{key_name}" was added to {asset_name} › {variant_name}',
        ))

    return notifications


# ── Core scanner ───────────────────────────────────────────────────────────
def scan_json_for_new_keys(json_files: List[Path]) -> List[Dict]:
    """
    Walk all JSON files, diff against snapshot, append new notifications to
    the SHARED master list.  Per-user state is never touched here — every user
    will see new notifications on their next poll.
    """
    old_snapshot       = load_snapshot()
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

            asset_names_key = f"{file_key}::{section}::__asset_names__"
            old_asset_names = set(old_snapshot.get(asset_names_key, {}).keys())
            new_snapshot[asset_names_key] = {k: True for k in blob}

            for asset_name, asset_data in blob.items():
                if not isinstance(asset_data, dict):
                    continue

                if old_asset_names and asset_name not in old_asset_names:
                    new_notifications.append(_make_notif(
                        notif_type="new_key",
                        asset=asset_name,
                        key=asset_name,
                        json_path=str(json_file),
                        title="New asset added",
                        message=f'"{asset_name}" was added to {json_file.name}',
                    ))

                variants_dict: dict = {}
                if "Variants" in asset_data and isinstance(asset_data["Variants"], dict):
                    variants_dict = asset_data["Variants"]

                variant_names_key = f"{file_key}::{section}::{asset_name}::variant_names"
                old_variant_names = set(old_snapshot.get(variant_names_key, {}).keys())
                new_snapshot[variant_names_key] = {k: True for k in variants_dict}

                for variant_name, variant_data in variants_dict.items():
                    if not isinstance(variant_data, dict):
                        continue

                    if old_variant_names and variant_name not in old_variant_names:
                        new_notifications.append(_make_notif(
                            notif_type="new_variant",
                            asset=asset_name,
                            key=variant_name,
                            json_path=str(json_file),
                            title="New variant added",
                            message=f'"{variant_name}" was added to {asset_name}',
                        ))

                    fp_key = f"{file_key}::{section}::{asset_name}::variant::{variant_name}"
                    old_fp = old_snapshot.get(fp_key, {})
                    new_fp = _variant_fingerprint(variant_data)
                    new_snapshot[fp_key] = new_fp

                    new_notifications.extend(_diff_variant(
                        asset_name=asset_name,
                        variant_name=variant_name,
                        old_fp=old_fp,
                        new_fp=new_fp,
                        json_path=str(json_file),
                    ))

                top_keys     = {k for k in asset_data if k != "Variants"}
                tk_snap_key  = f"{file_key}::{section}::{asset_name}::topkeys"
                old_top_keys = set(old_snapshot.get(tk_snap_key, {}).keys())
                new_snapshot[tk_snap_key] = {k: True for k in top_keys}

                for key_name in top_keys - old_top_keys:
                    if old_top_keys:
                        new_notifications.append(_make_notif(
                            notif_type="new_key",
                            asset=asset_name,
                            key=key_name,
                            json_path=str(json_file),
                            title="New field added",
                            message=f'"{key_name}" was added to {asset_name}',
                        ))

    _save_snapshot(new_snapshot)

    if new_notifications:
        existing = load_notifications()
        existing.extend(new_notifications)
        _save_notifications(existing)
        logger.info(f"[notif] {len(new_notifications)} new notification(s) added to master list")

    return new_notifications


def _make_notif(*, notif_type, asset, key, json_path, title, message) -> Dict:
    return {
        "id":        str(uuid.uuid4()),
        "type":      notif_type,
        "asset":     asset,
        "key":       key,
        "json_path": json_path,
        "timestamp": datetime.now().isoformat(),
        "title":     title,
        "message":   message,
    }