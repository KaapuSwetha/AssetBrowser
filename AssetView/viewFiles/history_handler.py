# AssetView/viewFiles/history_handler.py
import logging
from datetime import datetime
from typing import Optional
from datetime import datetime
logger = logging.getLogger(__name__)

def append_history_entry(block, asset_id, previous_status, new_status, 
                         username, ip_address, comment=""):
    entry = {
        "timestamp":       datetime.now().isoformat(timespec="seconds"),
        "asset_id":        asset_id,
        "previous_status": previous_status,
        "new_status":      new_status,
        "comment":         comment,
        "username":        username or "unknown",
        "ip_address":      ip_address or "",
    }
    if "History" not in block or not isinstance(block["History"], list):
        block["History"] = []

    # ── Deduplicate: skip if last entry is identical (same timestamp + content)
    if block["History"]:
        last = block["History"][-1]
        if (last.get("timestamp")       == entry["timestamp"] and
            last.get("previous_status") == entry["previous_status"] and
            last.get("new_status")      == entry["new_status"] and
            last.get("username")        == entry["username"]):
            return  # exact duplicate within the same second — skip

    block["History"].append(entry)
