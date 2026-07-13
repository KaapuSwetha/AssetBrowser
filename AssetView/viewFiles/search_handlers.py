from pathlib import Path
from typing import List, Dict
from ..utils import load_json, coerce_scalar, basename_noext, entry_to_path, as_list


def extract_department_from_publish_path(publish_path: str) -> str:
   
    try:
        path = Path(publish_path)
        parts = path.parts
        
        # Look for a folder that ends with '_publish' or contains 'publish'
        for i, part in enumerate(parts):
            if 'publish' in part.lower():
                # The department should be the next part
                if i + 1 < len(parts):
                    return parts[i + 1]
        return ""
    except Exception:
        return ""


def extract_department_from_json_path(json_path: Path) -> str:
    
    try:
        parts = json_path.parts
        # Find the index of 'Asset' or 'Sequence' in the path
        for i, part in enumerate(parts):
            if part in ('Asset', 'Sequence'):
                # The department should be the next part
                if i + 1 < len(parts):
                    return parts[i + 1]
        return ""
    except Exception:
        return ""


def get_department(info: Dict, json_path: Path) -> str:
    """Get department from published file path, fallback to JSON path."""
    # Try to get from published file path first
    pub_path = (info.get("PublishedFilePath") or 
                info.get("PublishdFilePath") or [])
    
    if pub_path:
        # Get the latest published path
        if isinstance(pub_path, list) and pub_path:
            latest_pub = pub_path[-1] if pub_path[-1] else (pub_path[0] if len(pub_path) > 0 else "")
        else:
            latest_pub = pub_path
            
        if latest_pub:
            dept = extract_department_from_publish_path(str(latest_pub))
            if dept:
                return dept
    
    # Fallback to JSON path
    return extract_department_from_json_path(json_path)


def search_assets_data(
        query: str, active_projects: List[str], base_path: Path
) -> List[Dict[str, str]]:
    """Search assets and sequences across all active projects."""
    results: List[Dict[str, str]] = []

    for proj in active_projects:
        for mode in ("Asset", "Sequence"):
            root = base_path / proj / mode
            if not root.exists():
                continue

            for jf in root.rglob("*.json"):
                try:
                    data = load_json(jf)
                except Exception:
                    continue

                blob = (data.get("asset_info") if mode == "Asset"
                        else data.get("sequence_info")) or {}

                for name, info in blob.items():
                    if not info:
                        continue

                    asset_id = info.get("AssetId") or info.get("AssetID") or ""
                    hay = f"{name} {asset_id}".lower()

                    # Check if query matches
                    if query not in hay:
                        continue

                    # Check if asset has variants
                    has_variants = mode == "Asset" and "Variants" in info and info.get("Variants")

                    if has_variants:
                        # If asset has variants, only show the variants
                        variants = info.get("Variants", {})
                        for variant_name, variant_data in variants.items():
                            if not variant_data:
                                continue
                            variant_status = coerce_scalar(variant_data.get("Status")) or ""
                            # Only add if status exists
                            if variant_status:
                                # Get department from variant's published path
                                department = get_department(variant_data, jf)
                                
                                results.append({
                                    "project": proj,
                                    "mode": mode,
                                    "name": name,
                                    "status": variant_status,
                                    "asset_id": str(asset_id),
                                    "path": str(jf),
                                    "variant": variant_name,
                                    "department": department,
                                })
                    else:
                        # No variants, show the main asset
                        status = coerce_scalar(info.get("Status")) or ""
                        # Only add if status exists
                        if status:
                            # Get department from asset's published path
                            department = get_department(info, jf)
                            
                            results.append({
                                "project": proj,
                                "mode": mode,
                                "name": name,
                                "status": status,
                                "asset_id": str(asset_id),
                                "path": str(jf),
                                "variant": "",
                                "department": department,
                            })

    return results


def api_data_search(mode: str, project: str, active_projects: List[str], base_path: Path) -> List[Dict[str, str]]:
    """Get data for API endpoint."""
    if mode not in {"Asset", "Sequence"}:
        raise ValueError("mode must be 'Asset' or 'Sequence'")

    projects = [project] if project else active_projects
    key = "asset_info" if mode == "Asset" else "sequence_info"

    payload: List[Dict[str, str]] = []

    for proj in projects:
        root = base_path / proj / mode
        pattern = f"*_{'asset' if mode == 'Asset' else 'sequence'}_info.json"
        for fp in root.rglob(pattern):
            data = load_json(fp)
            
            for name, meta in (data.get(key) or {}).items():
                pub = as_list(meta.get("PublishedFilePath") or
                              meta.get("PublishdFilePath"))
                latest = entry_to_path(pub[-1]) if pub else ""
                
                # Get department from published path
                department = get_department(meta, fp)
                
                payload.append({
                    "project": proj,
                    "mode": mode,
                    "name": name,
                    "filename": basename_noext(latest),
                    "status": coerce_scalar(meta.get("Status")) or "No Status",
                    "asset_id": (meta.get("Assetid") or meta.get("AssetID") or "")
                    if mode == "Asset" else "",
                    "frame_range": (meta.get("FrameRange") or "")
                    if mode == "Sequence" else "",
                    "json_path": str(fp),
                    "department": department,
                })

    return payload