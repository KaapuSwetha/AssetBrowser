import os
from urllib.parse import quote

# Mapping of Windows drive letters to web-accessible mount points
DRIVE_MAP = {
    "S:": "/media/s_drive",
    "N:": "/media/n_drive",
    "V:": "/media/v_drive",
    "C:": "/media/c_drive",
    # Add more mappings here if needed
}


def convert_preview_path(path):
    """
    Convert a Windows-style drive path to a web-friendly URL path.

    Example:
        Input:  S:\\Assets\\Previews\\image.png
        Output: /media/s_drive/Assets/Previews/image.png

    Spaces are URL-encoded (%20) for web compatibility.

    Args:
        path (str): The original file path.

    Returns:
        str or None: Converted URL path, or None if invalid.
    """
    if not path or not isinstance(path, str):
        return None

    # Normalize backslashes to forward slashes
    normalized_path = path.replace("\\", "/").strip()

    for drive_letter, url_prefix in DRIVE_MAP.items():
        # Case-insensitive check for Windows drive match
        if normalized_path.lower().startswith(drive_letter.lower()):
            # Remove the drive letter and any leading slashes
            relative_path = normalized_path[len(drive_letter):].lstrip("/\\")
            # Use urllib.parse.quote to properly encode the path (handles spaces and special characters)
            encoded_path = quote(relative_path)
            return f"{url_prefix}/{encoded_path}"

    return None
