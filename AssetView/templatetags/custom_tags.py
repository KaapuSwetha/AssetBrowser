# AssetView/templatetags/custom_tags.py

from django import template
import re
register = template.Library()

@register.filter
def get_item(dictionary, key):
    return dictionary.get(key, "")


@register.filter
def zip(a, b):
    return zip(a, b)


@register.filter
def format_display_name(value):
    """
    Convert camelCase or PascalCase strings to spaced display names.
    Examples:
    - AssetId -> Asset Id
    - PreviewPath -> Preview Path
    - PublishdFilePath -> Publishd File Path
    - WorkfilePath -> Workfile Path
    - TextureSourcePath -> Texture Source Path
    - DecimatedMesh -> Decimated Mesh
    """
    if not value:
        return value

    # Handle special cases first
    display_name_mapping = {
        'AssetId': 'Asset Id',
        'PreviewPath': 'Preview Path',
        'PublishdFilePath': 'Publishd File Path',
        'WorkfilePath': 'Workfile Path',
        'TextureSourcePath': 'Texture Source Path',
        'DecimatedMesh': 'Decimated Mesh',
        'AdditionalMaps': 'Additional Maps',
        'PublishComment': 'Publish Comment',
        'USD': 'USD',
        'Alembic': 'Alembic',
        'Status': 'Status',
        'User': 'User',
    }

    # Check if we have a predefined mapping
    if value in display_name_mapping:
        return display_name_mapping[value]

    # For other cases, use regex to add spaces before capital letters
    # This handles camelCase/PascalCase conversion
    result = re.sub(r'(?<!^)(?=[A-Z])', ' ', value)

    # Clean up multiple spaces
    result = re.sub(r'\s+', ' ', result).strip()

    return result