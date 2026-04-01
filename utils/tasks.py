# utils/tasks.py
from __future__ import annotations
from celery import shared_task, Task
from celery.utils.log import get_task_logger
from django.core.mail import EmailMultiAlternatives, get_connection
from django.template.loader import render_to_string
from django.conf import settings
from utils.logger import get_logger
from django.utils.html import strip_tags
import os

task_logger = get_task_logger(__name__)
logger = get_logger(__name__)


class BaseEmailTask(Task):
    autoretry_for = (Exception,)
    max_retries = getattr(settings, "CELERY_EMAIL_MAX_RETRIES", 5)
    retry_backoff = True
    retry_backoff_max = getattr(settings, "CELERY_EMAIL_RETRY_BACKOFF_MAX", 600)
    retry_jitter = True

    def on_failure(self, exc, task_id, args, kwargs, einfo):
        logger.error("Email task failed task_id=%s exc=%s", task_id, exc, exc_info=einfo)
        super().on_failure(exc, task_id, args, kwargs, einfo)


@shared_task(bind=True, base=BaseEmailTask, name="utils.tasks.send_email_task", acks_late=True)
def send_email_task(self, subject, to, template_name=None, context=None, from_email=None,
                    cc=None, bcc=None, attachments=None, html_content=None, text_content=None, reply_to=None):
    context = context or {}
    from_email = from_email or getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@localhost")
    html_body = html_content
    if not html_body and template_name:
        html_body = render_to_string(template_name, context)
    text_body = text_content or (strip_tags(html_body) if html_body else "")

    if isinstance(to, str):
        to = [to]

    try:
        msg = EmailMultiAlternatives(subject=subject, body=text_body, from_email=from_email, to=to, cc=cc or [],
                                     bcc=bcc or [], reply_to=reply_to or [])
        if html_body:
            msg.attach_alternative(html_body, "text/html")

        if attachments:
            for a in attachments:
                if isinstance(a, str) and os.path.exists(a):
                    msg.attach_file(a)
                elif isinstance(a, (list, tuple)) and len(a) >= 2:
                    filename, content = a[0], a[1]
                    mimetype = a[2] if len(a) > 2 else None
                    if mimetype:
                        msg.attach(filename, content, mimetype)
                    else:
                        msg.attach(filename, content)
                else:
                    logger.warning("Unsupported attachment format: %s", type(a))

        conn = get_connection()
        msg.connection = conn
        msg.send(fail_silently=False)
        task_logger.info("Email sent subject=%s to=%s", subject, to)
        return True
    except Exception as exc:
        task_logger.exception("Error sending email: %s", exc)
        raise self.retry(exc=exc)
