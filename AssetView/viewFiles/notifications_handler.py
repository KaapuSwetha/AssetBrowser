from __future__ import annotations
import json
import uuid
import logging
import re
import threading  # ADD THIS
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

_HERE = Path(__file__).parent
DATA_DIR = _HERE.parent / "data"
NOTIFICATIONS_F = DATA_DIR / "notifications.json"
SNAPSHOT_F = DATA_DIR / "json_snapshot.json"
USER_STATE_DIR = DATA_DIR / "user_state"

_SCAN_LOCK = threading.Lock()

_VERSIONED_FIELDS = {"PublishdFilePath", "PreviewPath", "FileName", "AssetId", "Alembic", "Usd"}
_STATUS_FIELD = "Status"
_COMMENT_FIELD = "PublishComment"
_SKIP_FIELDS = {"History", "Variants"}

_TYPE_PRIORITY = {
    "new_version": 0,
    "status_change": 1,
    "comment_change": 2,
    "field_change": 3,
    "new_key": 4,
}

_DEPT_MAP = {
    "03_model": "Model",
    "04_texture": "Surfacing",
    "05_groom": "Groom",
    "06_lookdev": "Surfacing",
    "07_rig": "Rigging",
    "08_previz": "Previz",
    "09_animation": "Animation",
    "10_matchmove": "Matchmove",
    "11_cache": "Cache",
    "12_lighting": "Lighting",
    "14_comp": "Compositing",
    "16_matchmove": "Matchmove",
    "17_crowd": "Crowd",
}
_DEPT_LABEL_MAP = {
    "Modeling":     "Model",         
    "Rigging":      "Rigging",
    "Texturing":    "Surfacing",
    "FX":           "FX",
    "Animation":    "Animation",
    "Matchmove":    "Matchmove",
    "Roto":         "Roto",
    "Lighting":     "Lighting",
    "Compositing":  "Compositing",
    "Environment":  "Layout",       
    "Cache":        "Cache",
    "Previz":       "Previz",
    "Crowd":        "Crowd",
}
def get_user_department(username: str) -> str | None:

    config = _load_dept_config()
    employee_db = config.get("Employee_DB", {})

    for db_dept, members in employee_db.items():
        if username in members:
            db_to_notif = {v: k for k, v in _DEPT_LABEL_MAP.items()}
            return db_to_notif.get(db_dept, db_dept) 
    return None
def _extract_dept(json_path: str) -> str:
    if not json_path:
        return ""
    normalised = json_path.replace("\\", "/").lower()
    for folder, label in _DEPT_MAP.items():
        if f"/{folder}/" in normalised:
            return label
    return ""


def _ensure_data():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    USER_STATE_DIR.mkdir(parents=True, exist_ok=True)


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


def load_notifications() -> List[Dict]:
    return _load_json_safe(NOTIFICATIONS_F, [])


def _save_notifications(notifications: List[Dict]):
    _save_json(NOTIFICATIONS_F, notifications)


def load_snapshot() -> Dict:
    return _load_json_safe(SNAPSHOT_F, {})


def _save_snapshot(snapshot: Dict):
    _save_json(SNAPSHOT_F, snapshot)


def _safe_username(username: str) -> str:
    if not username:
        return "anonymous"
    safe = re.sub(r"[^\w.\-]", "_", username.strip())
    return safe or "anonymous"


def _user_state_path(username: str) -> Path:
    return USER_STATE_DIR / f"{_safe_username(username)}.json"


def _load_user_state(username: str) -> Dict:
    return _load_json_safe(
        _user_state_path(username),
        {"read": {}, "deleted": {}},
    )


def _save_user_state(username: str, state: Dict):
    _save_json(_user_state_path(username), state)

def get_unread_notifications(username: str) -> List[Dict]:
    master     = load_notifications()
    user_state = _load_user_state(username)
    user_read    = user_state.get("read", {})
    user_deleted = user_state.get("deleted", {})

    user_dept = get_user_department(username)

    is_global_viewer = (
        user_dept in _GLOBAL_VIEW_ROLES
        or username in ("localhost", "swetha")
    )

    result = []
    for n in master:
        nid = n.get("id")

       
        if user_deleted.get(nid):
            continue
        if user_read.get(nid):
            continue

        
        if not is_global_viewer:
            notif_dept = n.get("dept", "")

            if notif_dept:
                
                if user_dept is None:
                    continue

                if not _user_can_see_notif(user_dept, notif_dept):
                    continue

        result.append(dict(n))

    return result
def mark_notification_read(notification_id: str, username: str) -> bool:
    state = _load_user_state(username)
    state.setdefault("read", {})[notification_id] = True
    _save_user_state(username, state)
    return True


def mark_all_read(username: str) -> int:
    master = load_notifications()
    state = _load_user_state(username)
    state.setdefault("read", {})
    count = 0
    for n in master:
        nid = n.get("id")
        if not state["read"].get(nid):
            state["read"][nid] = True
            count += 1
    if count:
        _save_user_state(username, state)
    return count


def delete_notification(notification_id: str, username: str) -> bool:
    state = _load_user_state(username)
    state.setdefault("deleted", {})[notification_id] = True
    state.setdefault("read", {})[notification_id] = True
    _save_user_state(username, state)
    return True


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
        "fields": fields,
        "top_keys": sorted(k for k in variant_data.keys() if k not in _SKIP_FIELDS),
    }


def _context_message(asset_name: str, new_fp: dict, json_path: str = "") -> str:
    fields = new_fp.get("fields", {})

    def _latest(key: str) -> str:
        for v in reversed(fields.get(key, [])):
            s = _normalise_val(v)
            if s:
                return s
        return ""

    asset_id = _latest("AssetId")
    status = _latest("Status")
    comment = _latest("PublishComment")
    dept = _extract_dept(json_path)

    parts = [f"Asset: {asset_name}"]
    if dept:
        parts.append(f"Dept: {dept}")
    if asset_id:
        parts.append(f"ID: {asset_id}")
    if status:
        parts.append(f"Status: {status}")
    if comment:
        parts.append(f"Comment: {comment}")

    return "  |  ".join(parts)


def _is_duplicate(
        new_notif: Dict,
        existing: List[Dict],
        window_seconds: int = 60,
) -> bool:
    
    for n in existing:
        if (
                n.get("type") == new_notif.get("type")
                and n.get("asset") == new_notif.get("asset")
                and n.get("key") == new_notif.get("key")
                and n.get("json_path") == new_notif.get("json_path")
        ):
            try:
                t_old = datetime.fromisoformat(n["timestamp"])
                t_new = datetime.fromisoformat(new_notif["timestamp"])
                if abs((t_new - t_old).total_seconds()) < window_seconds:
                    return True
            except Exception:
                pass
    return False


def _diff_field_lists(
    old_vals, new_vals, field, asset_name,
    variant_name, json_path, notif_type,
    title_prefix, new_fp, variant: str = "",
) -> List[Dict]:
    notifications: List[Dict] = []
    context = _context_message(asset_name, new_fp)

    for idx in range(min(len(old_vals), len(new_vals))):
        if _normalise_val(old_vals[idx]) != _normalise_val(new_vals[idx]):
            notifications.append(_make_notif(
        notif_type=notif_type,
        asset=asset_name,
        key=f"{variant_name} / {field}",
        json_path=json_path,
        message=context,
        variant=variant,
    ))
    for idx in range(len(old_vals), len(new_vals)):
        if _normalise_val(new_vals[idx]):
            notifications.append(_make_notif(
                notif_type=notif_type,
                asset=asset_name,
                key=f"{variant_name} / {field}",
                json_path=json_path,
                message=context,
            ))

    return notifications


def _diff_variant(
    asset_name, variant_name, old_fp, new_fp, json_path, variant: str = "",
) -> List[Dict]:
    if not old_fp:
        return []

    old_fields: Dict[str, list] = old_fp.get("fields", {})
    new_fields: Dict[str, list] = new_fp.get("fields", {})

    changed_groups: List[tuple] = []

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

        field_notifs = _diff_field_lists(
            old_vals=old_vals, new_vals=new_vals, field=field,
            asset_name=asset_name, variant_name=variant_name,
            json_path=json_path, notif_type=notif_type,
            title_prefix=title_prefix, new_fp=new_fp,
            variant=variant,
        )

        if field_notifs:
            changed_groups.append((field, notif_type, field_notifs))

    old_keys = set(old_fp.get("top_keys", []))
    new_keys = set(new_fp.get("top_keys", []))
    key_notifs: List[Dict] = []
    for key_name in new_keys - old_keys:
        if key_name in _SKIP_FIELDS:
            continue
        key_notifs.append(_make_notif(
        notif_type="new_key",
        asset=asset_name,
        key=key_name,
        json_path=json_path,
        message=_context_message(asset_name, new_fp, json_path),
        variant=variant,
    ))

    if not changed_groups:
        return key_notifs

    if len(changed_groups) == 1:
        _field, _type, notifs = changed_groups[0]
        return notifs + key_notifs

    best_type = sorted(
        [t for _, t, _ in changed_groups],
        key=lambda x: _TYPE_PRIORITY.get(x, 99),
    )[0]

    summary = _make_notif(
        notif_type=best_type,
        asset=asset_name,
        key=variant_name,
        json_path=json_path,
        message=_context_message(asset_name, new_fp, json_path),
        variant=variant,
    )
    return [summary] + key_notifs


def scan_json_for_new_keys(json_files: List[Path]) -> List[Dict]:
    
    with _SCAN_LOCK:  
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

                asset_names_key = f"{file_key}::{section}::__asset_names__"
                new_snapshot[asset_names_key] = {k: True for k in blob}

                for asset_name, asset_data in blob.items():
                    if not isinstance(asset_data, dict):
                        continue

                    new_root_fp = _variant_fingerprint(asset_data)

                    root_fp_key = f"{file_key}::{section}::{asset_name}::__root__"
                    old_root_fp = old_snapshot.get(root_fp_key, {})
                    new_snapshot[root_fp_key] = new_root_fp
                    has_variants = bool(
                        asset_data.get("Variants")
                        and isinstance(asset_data["Variants"], dict)
                    )

                    if new_root_fp.get("fields") and not has_variants:
                        new_notifications.extend(_diff_variant(
                            asset_name=asset_name,
                            variant_name=asset_name,
                            old_fp=old_root_fp,
                            new_fp=new_root_fp,
                            json_path=str(json_file),
                        ))

                    variants_dict: dict = {}
                    if has_variants:
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
                                message=_context_message(
                                    asset_name, _variant_fingerprint(variant_data)
                                ),variant=variant_name,
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
                             variant=variant_name,
                        ))

                    top_keys = {k for k in asset_data if k not in _SKIP_FIELDS | {"History"}}
                    tk_snap_key = f"{file_key}::{section}::{asset_name}::topkeys"
                    old_top_keys = set(old_snapshot.get(tk_snap_key, {}).keys())
                    new_snapshot[tk_snap_key] = {k: True for k in top_keys}

                    for key_name in top_keys - old_top_keys:
                        if old_top_keys:
                            new_notifications.append(_make_notif(
                                notif_type="new_key",
                                asset=asset_name,
                                key=key_name,
                                json_path=str(json_file),
                                message=_context_message(asset_name, new_root_fp),
                            ))

        merged_snapshot = {**old_snapshot, **new_snapshot}
        _save_snapshot(merged_snapshot)

        if new_notifications:
            existing = load_notifications()
            deduped = [
                n for n in new_notifications
                if not _is_duplicate(n, existing)
            ]

            if deduped:
                existing.extend(deduped)
                _save_notifications(existing)
                logger.info(
                    f"[notif] {len(deduped)} new notification(s) added "
                    f"({len(new_notifications) - len(deduped)} duplicate(s) suppressed)"
                )

        return new_notifications

import re as _re
def _make_notif(*, notif_type, asset, key, json_path, message, variant: str = "") -> Dict:
    dept = _extract_dept(json_path)   
    return {
        "id": str(uuid.uuid4()),
        "type": notif_type,
        "asset": asset,
        "key": key,
        "json_path": json_path,
        "dept": dept,               
        "variant": variant,       
        "timestamp": datetime.now().isoformat(),
        "message": message,
    }

import time as _time_mod
import os

_watcher_started = False
_watcher_lock = threading.Lock()


def start_background_watcher(get_json_files_fn, interval_seconds: int = 3):
    
    global _watcher_started
    with _watcher_lock:
        if _watcher_started:
            return
        _watcher_started = True

    def _watch():
        last_mtimes: dict = {}
        while True:
            try:
                files = get_json_files_fn()
                changed = []
                for f in files:
                    try:
                        mtime = f.stat().st_mtime
                    except OSError:
                        continue
                    if last_mtimes.get(str(f)) != mtime:
                        last_mtimes[str(f)] = mtime
                        changed.append(f)

                if changed:
                    scan_json_for_new_keys(changed)

            except Exception as exc:
                logger.warning(f"[watcher] error: {exc}")

            _time_mod.sleep(interval_seconds)

    t = threading.Thread(target=_watch, daemon=True)
    t.start()
    logger.info("[watcher] background file watcher started (interval=%ds)", interval_seconds)

import json
from pathlib import Path


_CONFIG_PATH = DATA_DIR / "department_config.json"
_GLOBAL_VIEW_ROLES = {"TD", "Superviser", "Production",  "EP"}


def _load_dept_config() -> dict:
    try:
        return json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning(f"[notif] Could not load dept config: {exc}")
        return {}
def _build_user_watchlist(user_dept: str) -> set:
    config     = _load_dept_config()
    dependency = config.get("Department_Dependency", {})
    label_to_db: dict = {label: db for db, label in _DEPT_LABEL_MAP.items()}
    user_db    = label_to_db.get(user_dept, user_dept)
    user_label = _DEPT_LABEL_MAP.get(user_db, user_db)
    user_forms = {user_dept, user_db, user_label, 
              user_dept.lower(), user_db.lower(), user_label.lower()}
    watchlist: set = set(user_forms)

    for source_db, dependents in dependency.items():
        dep_aliases: set = set()
        for d in dependents:
            dep_aliases.add(d)
            dep_aliases.add(d.lower())                      # ← add lowercase form
            dep_aliases.add(d.capitalize())                 # ← add capitalized form
            dep_aliases.add(_DEPT_LABEL_MAP.get(d, d))     # ← existing lookup
        if user_forms & dep_aliases:
            source_label = _DEPT_LABEL_MAP.get(source_db, source_db)
            watchlist.add(source_db)
            watchlist.add(source_label)
            watchlist.add(source_db.lower())               # ← also normalize source

    return watchlist
def _user_can_see_notif(user_dept: str, notif_dept: str) -> bool:
    
    return notif_dept in _build_user_watchlist(user_dept)