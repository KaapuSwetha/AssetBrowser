# tasks/email_tasks.py
from celery import shared_task
from utils.logger import get_logger
from utils.email_utils import send_email

logger = get_logger(__name__)

@shared_task(name="notifications.send_status_email")
def send_status_email(project, asset_name, new_status, comment, recipients, cc=None, bcc=None):
    """
    Send a status-update email to relevant departments.
    Uses utils.email_utils.send_email for rendering and delivery.
    """
    try:
        if not recipients:
            logger.warning("No recipients provided for status email: %s/%s", project, asset_name)
            return

        subject = f"[{project}] {asset_name} → {new_status}"
        context = {
            "project": project,
            "asset_name": asset_name,
            "new_status": new_status,
            "comment": comment or "",
        }

        # Example: use a Django template if available, fallback to plain text.
        template = "emails/status_update.html"  # create this template if desired
        html_content = None
        text_content = (
            f"{asset_name} in project '{project}' was marked as '{new_status}'.\n"
            + (f"\nComment:\n{comment}" if comment else "")
        )

        send_email(
            subject=subject,
            to=recipients,
            template_name=template,
            context=context,
            text_content=text_content,
            async_send=False,  # Celery already runs this asynchronously
            cc=cc,
            bcc=bcc,
        )

        logger.info("Status update email dispatched for %s/%s to %s", project, asset_name, recipients)
    except Exception as e:
        logger.exception("send_status_email failed for %s/%s: %s", project, asset_name, e)
