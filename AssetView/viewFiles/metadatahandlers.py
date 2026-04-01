# AssetView/metadatahandlers.py
from pathlib import Path
from typing import Dict, Any, List
from django.template.loader import render_to_string
from ..utils import (
    as_list, entry_to_path, basename_noext, load_json,
    coerce_scalar, status_badge, age_badge, pretty, web_path,
    path_date,
)


class Row(Dict):
    """TypedDict for table rows."""
    FileName: str
    AssetId: str
    FrameRange: str
    Status: str


def get_asset_rows(path: Path, mode: str, name: str, variant: str = "") -> List[Row]:
    """Get rows for an asset/shot with variant support."""
    data = load_json(path)
    node = (data.get("asset_info") if mode == "Asset"
            else data.get("sequence_info")) or {}
    asset_data = node.get(name) or {}

    # Handle variant-based assets if variant is specified
    if variant and "Variants" in asset_data:
        if variant in asset_data["Variants"]:
            asset_data = asset_data["Variants"][variant]
        else:
            # If variant doesn't exist, use default
            asset_data = asset_data["Variants"].get("default", {})

    fn = as_list(asset_data.get("PublishdFilePath"))
    asset_ids = as_list(asset_data.get("AssetId"))
    frame_range = as_list(asset_data.get("FrameRange"))
    statuses = as_list(asset_data.get("Status"))

    rows: List[Row] = []

    # We need to create a row for each version
    max_versions = max(len(fn), len(asset_ids), len(frame_range), len(statuses))

    for i in range(max_versions):
        # Get data for this version
        filename = basename_noext(fn[i]) if i < len(fn) else ""

        if mode == "Asset":
            asset_id = asset_ids[i] if i < len(asset_ids) else ""
            frame_range_val = ""
        else:
            asset_id = ""
            frame_range_val = frame_range[i] if i < len(frame_range) else ""

        status = statuses[i] if i < len(statuses) else ""

        # If we don't have a filename but have other data, create placeholder
        if not filename and (asset_id or frame_range_val or status):
            filename = f"Version_{i + 1}"

        row = Row({
            "FileName": filename,
            "AssetId": asset_id,
            "FrameRange": frame_range_val,
            "Status": status,
        })

        rows.append(row)

    return rows


def get_row_metadata_data(
        path: str, name: str, mode: str, variant: str = "",
        filename: str = "", index: str = ""
) -> Dict[str, Any]:
    """Get metadata for a specific row."""
    fp = Path(path)
    if not fp.exists():
        raise FileNotFoundError("JSON not found")

    # Get the full asset/shot data
    data = load_json(fp)
    merged = {**(data.get("asset_info") or {}),
              **(data.get("sequence_info") or {})}
    item = merged.get(name, {})

    # Navigate to variant data if present
    if variant and "Variants" in item:
        if variant in item["Variants"]:
            item = item["Variants"][variant]
        else:
            item = item["Variants"].get("default", {})

    # Extract lists
    pub_paths = as_list(item.get("PublishdFilePath"))
    statuses = as_list(item.get("Status"))
    frame_ranges = as_list(item.get("FrameRange"))
    frame_rates = as_list(item.get("FrameRate"))
    side_by_sides = as_list(item.get("SideBySide"))
    preview_paths = as_list(item.get("PreviewPath"))
    work_file_paths = as_list(item.get("WorkFilePath"))
    users = as_list(item.get("User"))
    publish_comments = as_list(item.get("PublishComment"))

    # Asset-only fields
    asset_ids = as_list(item.get("AssetId")) if mode == "Asset" else []
    alembic_paths = as_list(item.get("Alembic")) if mode == "Asset" else []
    usd_paths = as_list(item.get("Usd")) if mode == "Asset" else []
    additional_maps = as_list(item.get("AdditionalMaps")) if mode == "Asset" else []
    texture_source_paths = as_list(item.get("TextureSourcePath")) if mode == "Asset" else []
    decimated_meshes = as_list(item.get("DecimatedMesh")) if mode == "Asset" else []

    # Determine which version to show
    version_index = None

    # Try to use index first
    if index and index.isdigit():
        idx = int(index)
        if 0 <= idx < len(pub_paths):
            version_index = idx

    # If no index or invalid index, try filename matching
    if version_index is None and filename:
        for idx, pub_path in enumerate(pub_paths):
            pub_filename = basename_noext(pub_path)
            if pub_filename == filename:
                version_index = idx
                break

    # Fallback to first version
    if version_index is None and pub_paths:
        version_index = 0

    # Get publish path and date
    full_path = ""
    if version_index is not None and version_index < len(pub_paths):
        publish_path = pub_paths[version_index]
        full_path = entry_to_path(publish_path)
        dtobj = path_date(full_path)
        date_badge = {
            "text": pretty(dtobj),
            "badge_class": age_badge(dtobj),
            "title": full_path
        }
    else:
        date_badge = {
            "text": "—",
            "badge_class": "bg-slate-600 text-white",
            "title": ""
        }

    # Status
    if version_index is not None and version_index < len(statuses):
        st_text = statuses[version_index]
    elif statuses:
        st_text = statuses[0]
    else:
        st_text = "No Status"

    st_badge = status_badge(st_text)

    # Build metadata based on mode
    meta = {}

    if mode == "Sequence":
        # Sequence mode metadata
        meta["FrameRange"] = (frame_ranges[version_index]
                              if version_index is not None and version_index < len(frame_ranges)
                              else frame_ranges[0] if frame_ranges else "None")
        meta["FrameRate"] = (frame_rates[version_index]
                             if version_index is not None and version_index < len(frame_rates)
                             else frame_rates[0] if frame_rates else "None")
        meta["PreviewPath"] = (preview_paths[version_index]
                               if version_index is not None and version_index < len(preview_paths)
                               else preview_paths[0] if preview_paths else "None")
        meta["PublishComment"] = (publish_comments[version_index]
                                  if version_index is not None and version_index < len(publish_comments)
                                  else publish_comments[0] if publish_comments else "None")
        meta["PublishdFilePath"] = full_path or "None"
        meta["SideBySide"] = (side_by_sides[version_index]
                              if version_index is not None and version_index < len(side_by_sides)
                              else side_by_sides[0] if side_by_sides else "None")
        meta["Status"] = st_text
        meta["User"] = (users[version_index]
                        if version_index is not None and version_index < len(users)
                        else users[0] if users else "None")
        meta["WorkFilePath"] = (work_file_paths[version_index]
                                if version_index is not None and version_index < len(work_file_paths)
                                else work_file_paths[0] if work_file_paths else "None")
        meta["Date"] = date_badge["text"]

    elif mode == "Asset":
        # Asset mode metadata
        meta["AdditionalMaps"] = (additional_maps[version_index]
                                  if version_index is not None and version_index < len(additional_maps)
                                  else additional_maps[0] if additional_maps else "None")
        meta["Alembic"] = (alembic_paths[version_index]
                           if version_index is not None and version_index < len(alembic_paths)
                           else alembic_paths[0] if alembic_paths else "None")
        meta["AssetId"] = (asset_ids[version_index]
                           if version_index is not None and version_index < len(asset_ids)
                           else asset_ids[0] if asset_ids else "None")
        meta["DecimatedMesh"] = (decimated_meshes[version_index]
                                 if version_index is not None and version_index < len(decimated_meshes)
                                 else decimated_meshes[0] if decimated_meshes else "None")
        meta["FileName"] = (basename_noext(pub_paths[version_index])
                            if version_index is not None and version_index < len(pub_paths)
                            else filename or name)
        meta["PreviewPath"] = (preview_paths[version_index]
                               if version_index is not None and version_index < len(preview_paths)
                               else preview_paths[0] if preview_paths else "None")
        meta["PublishComment"] = (publish_comments[version_index]
                                  if version_index is not None and version_index < len(publish_comments)
                                  else publish_comments[0] if publish_comments else "None")
        meta["PublishdFilePath"] = full_path or "None"
        meta["Status"] = st_text
        meta["TextureSourcePath"] = (texture_source_paths[version_index]
                                     if version_index is not None and version_index < len(texture_source_paths)
                                     else texture_source_paths[0] if texture_source_paths else "None")
        meta["Usd"] = (usd_paths[version_index]
                       if version_index is not None and version_index < len(usd_paths)
                       else usd_paths[0] if usd_paths else "None")
        meta["User"] = (users[version_index]
                        if version_index is not None and version_index < len(users)
                        else users[0] if users else "None")
        meta["WorkFilePath"] = (work_file_paths[version_index]
                                if version_index is not None and version_index < len(work_file_paths)
                                else work_file_paths[0] if work_file_paths else "None")
        meta["Date"] = date_badge["text"]

    # Handle preview media
    media = {"type": "none", "src": "", "original_path": ""}
    if meta.get("PreviewPath") and meta["PreviewPath"] != "None":
        preview = meta["PreviewPath"]
        ext = Path(preview).suffix.lower()
        if ext in {".mov", ".mp4", ".m4v", ".webm", ".avi"}:
            media = {"type": "video", "src": web_path(preview), "original_path": preview}
        elif ext in {".exr", ".hdr"}:
            media = {"type": "image", "src": f"/preview/convert/?path={preview}", "original_path": preview}
        else:
            media = {"type": "image", "src": web_path(preview), "original_path": preview}

    return {
        "meta": meta,
        "status_badge": st_badge,
        "date_badge": date_badge,
        "media": media
    }