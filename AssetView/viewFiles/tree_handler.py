# AssetView/tree_handlers.py
import re
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Any
from django.template.loader import render_to_string
from django.http import HttpResponse
from ..utils import load_json

_num = re.compile(r"(\d+)")

def nkey(s: str):
    """Natural sort key that sorts numeric groups numerically."""
    return tuple(int(t) if t.isdigit() else t for t in _num.split(s))

def build_category_branch(project: str, base_path: Path) -> str:
    """Render Asset tree: Category → Department → Items."""
    if not base_path.exists():
        return "<div class='px-3 py-2 text-ink-500'>No assets</div>"

    grouped = defaultdict(lambda: defaultdict(list))  # cat -> dept -> [items]

    for jf in base_path.rglob("*_asset_info.json"):
        parts = jf.stem.split("_")
        if len(parts) < 4 or parts[0] != project:
            continue

        category = parts[1]
        department = "_".join(parts[2:-2])

        data = load_json(jf)
        for asset_name, asset_data in (data.get("asset_info") or {}).items():
            variants = asset_data.get("Variants")

            if variants:
                # Add each variant as a separate item
                for variant_name in sorted(variants.keys()):
                    grouped[category][department].append({
                        "name": f"{asset_name}/{variant_name}",
                        "asset": asset_name,
                        "variant": variant_name,
                        "path": str(jf),
                        "mode": "Asset"
                    })
            else:
                # Assets without variants
                grouped[category][department].append({
                    "name": asset_name,
                    "asset": asset_name,
                    "variant": None,
                    "path": str(jf),
                    "mode": "Asset"
                })

    if not grouped:
        return "<div class='px-3 py-2 text-ink-500'>No assets</div>"

    def nat_num(s: str):
        m = re.match(r"^(\d+)", s)
        return (int(m.group(1)) if m else 10**9, s.lower())

    sections: List[str] = []
    for category in sorted(grouped.keys(), key=str.lower):
        depts = []
        for dept, items in sorted(grouped[category].items(),
                                  key=lambda kv: nat_num(kv[0])):
            items_sorted = sorted(items, key=lambda it: it["name"].lower())
            depts.append({"name": dept, "items": items_sorted})
        sections.append(
            render_to_string(
                "AssetView/partials/_category_branch.html",
                {"project": project, "category": category, "depts": depts},
            )
        )

    return "".join(sections)

def build_sequence_branch(project: str, base_path: Path) -> str:
    """Render Sequence tree: Sequence → Shot → Departments (files)."""
    if not base_path.exists():
        return "<div class='px-3 py-2 text-ink-500'>No sequences</div>"

    # sequences[seq_name][shot_name] = [{"dept": "...", "name": "...", ...}]
    sequences: Dict[str, Dict[str, List[Dict[str, str]]]] = {}

    for jf in base_path.rglob("*_sequence_info.json"):
        parts = jf.stem.split("_")
        # Expect: PROJECT_<dept parts>_<seq parts>_sequence_info
        if len(parts) < 5 or parts[0] != project:
            continue

        dept = "_".join(parts[1:3])
        try:
            seq_end = parts.index("sequence")
            seq_name = "_".join(parts[3:seq_end]) or "UNKNOWN_SEQ"
        except ValueError:
            seq_name = "_".join(parts[3:]) or "UNKNOWN_SEQ"

        data = load_json(jf)
        shot_map = (data.get("sequence_info") or {})
        if not shot_map:
            continue

        bucket = sequences.setdefault(seq_name, {})
        for shot in shot_map.keys():
            bucket.setdefault(shot, [])
            bucket[shot].append(
                {"dept": dept, "name": shot, "path": str(jf), "mode": "Sequence"}
            )

    if not sequences:
        return "<div class='px-3 py-2 text-ink-500'>No sequences</div>"

    html_sections: List[str] = []
    for seq_name in sorted(sequences.keys(), key=nkey):
        shots = []
        for shot_name in sorted(sequences[seq_name].keys(), key=nkey):
            depts = sorted(sequences[seq_name][shot_name],
                         key=lambda d: nkey(d["dept"]))
            shots.append({"name": shot_name, "depts": depts})
        html_sections.append(
            render_to_string(
                "AssetView/partials/_sequence_branch.html",
                {"project": project, "seq": seq_name, "shots": shots},
            )
        )

    return "".join(html_sections)
