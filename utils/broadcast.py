# utils/broadcast.py
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from utils.logger import get_logger

logger = get_logger(__name__)

def broadcast_notification(payload: dict):
    """
    Send notification payload to all WebSocket clients in the 'notifications' group.
    Expected consumer method: NotificationsConsumer.notify()
    """
    try:
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            "notifications",
            {
                "type": "notify",  # MUST match the consumer method name
                "data": {
                    "action": "notification",
                    **payload,
                },
            },
        )
        logger.debug("Broadcasted notification: %s", payload.get("name") or payload)
    except Exception as e:
        logger.exception("broadcast_notification failed: %s", e)
