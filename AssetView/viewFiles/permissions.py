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
        '192.168.20.224': 'swetha',
        '10.1.0.223':     'neelendra',
        '10.0.0.73':      'neelendra',
        '10.1.0.165':     'subbarao.ch',
        '10.1.0.121':     'yasasvi.c',
        '10.1.0.108':     'adam.s',
        '10.1.0.214':     'naveen.kumar',
        '127.0.0.1':      'localhost',
    }

    allowed_users = [
        'swetha', 'neelendra', 'localhost',
        'subbarao.ch', 'yasasvi.c', 'adam.s', 'naveen.kumar',
    ]

    bare_username = ip_to_username.get(client_ip)
    can_edit = bare_username in allowed_users if bare_username else False

    # Build composite identity so each physical user gets their own
    # notification-state file while still resolving to the same department.
    # get_user_department() strips the @IP suffix automatically.
    if bare_username and client_ip:
        username = f"{bare_username}@{client_ip}"   # e.g. "swetha@192.168.20.224"
    else:
        username = bare_username                     # None for unknown IPs

    logger.info(f"Permission check — ip={client_ip} bare={bare_username} "
                f"identity={username} can_edit={can_edit}")
    return can_edit, username, client_ip