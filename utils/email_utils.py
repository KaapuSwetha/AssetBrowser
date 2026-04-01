# utils/email_utils.py
import threading
from django.conf import settings
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from utils.logger import get_logger

logger = get_logger(__name__)


def _import_task():
    try:
        from utils.tasks import send_email_task
        return send_email_task
    except Exception:
        return None


def _sync_send(subject, html_body, text_body, to, from_email, cc=None, bcc=None, attachments=None, reply_to=None):
    from django.core.mail import EmailMultiAlternatives, get_connection
    try:
        if isinstance(to, str):
            to = [to]
        msg = EmailMultiAlternatives(subject=subject, body=text_body or "", from_email=from_email, to=to, cc=cc or [],
                                     bcc=bcc or [], reply_to=reply_to or [])
        if html_body:
            msg.attach_alternative(html_body, "text/html")
        if attachments:
            for a in attachments:
                if isinstance(a, str):
                    msg.attach_file(a)
                elif isinstance(a, (list, tuple)) and len(a) >= 2:
                    filename, content = a[0], a[1]
                    mimetype = a[2] if len(a) > 2 else None
                    if mimetype:
                        msg.attach(filename, content, mimetype)
                    else:
                        msg.attach(filename, content)
        conn = get_connection()
        msg.connection = conn
        msg.send(fail_silently=False)
        logger.info("Sync email sent to %s subject=%s", to, subject)
        return True
    except Exception:
        logger.exception("Sync send failed")
        return False


def send_email(subject, to, template_name=None, context=None, from_email=None, cc=None, bcc=None, attachments=None,
               html_content=None, text_content=None, async_send=True, reply_to=None):
    from_email = from_email or getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@localhost")
    context = context or {}

    html_body = html_content
    if not html_body and template_name:
        try:
            html_body = render_to_string(template_name, context)
        except Exception:
            logger.exception("Template render failed")
            html_body = None

    text_body = text_content or (strip_tags(html_body) if html_body else "")

    if async_send:
        send_task = _import_task()
        if send_task and getattr(settings, "CELERY_BROKER_URL", None):
            try:
                send_task.apply_async(args=(subject, to), kwargs={
                    "template_name": template_name,
                    "context": context,
                    "from_email": from_email,
                    "cc": cc,
                    "bcc": bcc,
                    "attachments": attachments,
                    "html_content": html_body,
                    "text_content": text_body,
                    "reply_to": reply_to,
                })
                logger.debug("Scheduled email via Celery subject=%s to=%s", subject, to)
                return True
            except Exception:
                logger.exception("Failed to schedule Celery task; falling back to threaded send")

        t = threading.Thread(target=_sync_send,
                             args=(subject, html_body, text_body, to, from_email, cc, bcc, attachments, reply_to),
                             daemon=True)
        t.start()
        logger.debug("Started background thread to send email subject=%s to=%s", subject, to)
        return True

    return _sync_send(subject, html_body, text_body, to, from_email, cc, bcc, attachments, reply_to)
