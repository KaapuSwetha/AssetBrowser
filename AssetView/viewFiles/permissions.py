# AssetView/permissions.py
import logging
from typing import Tuple, Optional
import socket
logger = logging.getLogger(__name__)

def get_client_ip(request) -> Optional[str]:
    """Get the real client IP address considering all common proxy headers."""
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0].strip()
        logger.debug(f"IP from X-Forwarded-For: {ip}")
        return ip

    # Try other common headers
    for header in ['HTTP_X_REAL_IP', 'HTTP_CLIENT_IP', 'REMOTE_ADDR']:
        ip = request.META.get(header)
        if ip:
            logger.debug(f"IP from {header}: {ip}")
            return ip

    logger.warning("Could not determine client IP address")
    return None
def get_render_ips() -> list:
    """Resolve Render hostname to IPs at runtime."""
    try:
        hostname = "assetbrowser-1asu.onrender.com"
        _, _, ip_list = socket.gethostbyname_ex(hostname)
        logger.info(f"Resolved Render IPs: {ip_list}")
        return ip_list
    except socket.gaierror as e:
        logger.error(f"Failed to resolve Render hostname: {e}")
        return []

def check_user_permission(request) -> Tuple[bool, Optional[str], Optional[str]]:
    client_ip = get_client_ip(request)

    # Dynamically check if request comes from Render
    if client_ip and client_ip in get_render_ips():
        logger.info(f"Access granted to Render service IP: {client_ip}")
        return True, 'render_service', client_ip


    # Map IP addresses to usernames
    ip_to_username = {
        '192.168.20.224': 'swetha',
        '10.1.0.223': 'neelendra',
        '10.0.0.73': 'neelendra',
        '10.1.0.165': 'subbarao.ch',
        '10.1.0.121': 'yasasvi.c',
        '10.1.0.108': 'adam.s',
        '10.1.0.214': 'naveen.kumar',
        '127.0.0.1': 'localhost',
    }

    # List of users allowed to edit status - FIXED: Added missing comma
    allowed_users = [
        'swetha', 'neelendra', 'localhost',  # Added comma here
        'subbarao.ch', 'yasasvi.c', 'adam.s', 'naveen.kumar'
    ]

    # Get username based on IP address
    username = ip_to_username.get(client_ip)
    logger.info(f"Resolved username: {username}")

    # Check if user is allowed to edit
    can_edit = username in allowed_users if username else False
    logger.info(f"Permission check: Username: {username}, Can edit: {can_edit}")

    return can_edit, username, client_ip