import logging
from typing import Tuple, Optional

logger = logging.getLogger(__name__)

def get_client_ip(request) -> Optional[str]:
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0].strip()
        return ip
    for header in ['HTTP_X_REAL_IP', 'HTTP_CLIENT_IP', 'REMOTE_ADDR']:
        ip = request.META.get(header)
        if ip:
            return ip
    return None

def check_user_permission(request) -> Tuple[bool, Optional[str], Optional[str]]:
    client_ip = get_client_ip(request)

    ip_to_username = {
        '127.0.0.1':      'localhost',
    }

    allowed_users = [
        'localhost'
    ]

    bare_username = ip_to_username.get(client_ip)

    # --- Default fallback for unmapped IPs ---
    DEFAULT_USERNAME = 'guest'      # or None, if you don't want to name them
    DEFAULT_CAN_EDIT = False        # set True only if you really want unknown IPs to edit

    if bare_username is None:
        bare_username = DEFAULT_USERNAME
        can_edit = DEFAULT_CAN_EDIT
    else:
        can_edit = bare_username in allowed_users

    if bare_username and client_ip:
        username = f"{bare_username}@{client_ip}"
    else:
        username = bare_username

    logger.info(f"Permission check — ip={client_ip} bare={bare_username} "
                f"identity={username} can_edit={can_edit}")
    return can_edit, username, client_ip