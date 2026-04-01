from __future__ import annotations

import datetime as dt
import re
#
# DATE_IN_PATH = re.compile(r"(?P<d>\d{1,2})[-_](?P<m>\d{1,2})[-_](?P<y>\d{2,4})")
#
#
# def path_date(p: str) -> dt.datetime | None:
#     m = DATE_IN_PATH.search((p or "").replace("\\", "/"))
#     if not m: return None
#     d, mo, y = int(m.group("d")), int(m.group("m")), int(m.group("y"))
#     if y < 100: y += 2000
#     try:
#         return dt.datetime(y, mo, d)
#     except Exception:
#         return None
# print(path_date(r'Y:\AssetBrowser_bkp\new_IMP\07112025\v001\AssetBrowser\AssetView\apps.py'))

# from __future__ import annotations
#
# import datetime as dt
# import re
#
# # Allow -, _, or no separator
# DATE_IN_PATH = re.compile(r"(?P<d>\d{1,2})[-_]?(\d{1,2})[-_]?(\d{2,4})")
#
# def path_date(p: str) -> dt.datetime | None:
#     m = DATE_IN_PATH.search((p or "").replace("\\", "/"))
#     if not m:
#         return None
#     d, mo, y = map(int, m.groups())
#     if y < 100:
#         y += 2000
#     try:
#         return dt.datetime(y, mo, d)
#     except Exception:
#         return None
#
# def pretty(dtobj: dt.datetime | None) -> str:
#     return dtobj.strftime("%d %b %Y, %I:%M %p") if dtobj else "—"
import re
import datetime
import os
from typing import Any, Dict, Mapping, List

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
    """Map a status string to its badge metadata dict."""
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
    working = data if inplace else (data.copy() if isinstance(data, dict) else list(data) if isinstance(data, list) else data)

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

# ---- demo ----
test = status_badge('Internal Approved')
print(test)
multi_level_status = {
    'data_type': 'Asset',
    'rows': [
        {'FileName': 'AKT_chr_bull_mod', 'AssetId': 'hhs_hyd_AKT_00676', 'FrameRange': '', 'Status': 'Internal Approved'},
        {'FileName': 'AKT_chr_bull_mod', 'AssetId': 'hhs_hyd_AKT_00677', 'FrameRange': '', 'Status': 'Internal Approved'},
        {'FileName': 'AKT_chr_bull_mod', 'AssetId': 'hhs_hyd_AKT_00678', 'FrameRange': '', 'Status': 'Internal Approved'},
        {'FileName': 'AKT_chr_bull_mod', 'AssetId': 'hhs_hyd_AKT_00680', 'FrameRange': '', 'Status': 'Internal Approved'},
        {'FileName': 'AKT_chr_bull_mod', 'AssetId': 'hhs_hyd_AKT_00698', 'FrameRange': '', 'Status': 'Internal Approved'},
        {'FileName': 'AKT_chr_bull_mod', 'AssetId': 'hhs_hyd_AKT_00702', 'FrameRange': '', 'Status': 'Internal Approved'},
        {'FileName': 'AKT_chr_bull_mod', 'AssetId': 'hhs_hyd_AKT_00705', 'FrameRange': '', 'Status': 'Internal Retake'},
        {'FileName': 'AKT_chr_bull_mod', 'AssetId': 'hhs_hyd_AKT_00706', 'FrameRange': '', 'Status': 'Internal Approved'}
    ]
}

tes2 = apply_status_badges(multi_level_status)  # non-destructive
print(tes2)

# If you ever want to mutate in place:
print(apply_status_badges(multi_level_status, inplace=True))


import os

print(os.listdir(r'N:\AKT\04_Publish'))