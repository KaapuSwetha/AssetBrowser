# utils/logger.py
import logging
import logging.handlers
import os
import sys
import json
import traceback
from pathlib import Path
from typing import Optional, Sequence

# Optional fast JSON formatter
try:
    from pythonjsonlogger import jsonlogger  # type: ignore
    HAS_JSONLOGGER = True
except Exception:
    HAS_JSONLOGGER = False

PROJECT_ROOT = Path(__file__).resolve().parents[1]
LOG_DIR = PROJECT_ROOT / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

_DEFAULTS = {
    "level": logging.INFO,
    "json": True,
    "file_max_bytes": 20 * 1024 * 1024,
    "file_backup_count": 14,
    "file_name": LOG_DIR / "app.json.log",
    "console": True,
    "file": True,
    "mail_on_error": False,
    "admins": [],
    "email_from": "no-reply@localhost",
    "smtp": {},
    "emergency_sentinel": None,
    "emergency_shutdown": False
}


class FallbackJsonFormatter(logging.Formatter):
    def format(self, record):
        out = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "module": record.module,
            "func": record.funcName,
            "line": record.lineno,
            "message": record.getMessage(),
        }
        if record.exc_info:
            out["exception"] = "".join(traceback.format_exception(*record.exc_info))
        extras = {
            k: v for k, v in record.__dict__.items()
            if k not in ("name","msg","args","levelname","levelno","pathname","filename","module","exc_info","exc_text","stack_info","lineno","funcName","created","msecs","relativeCreated","thread","threadName","processName","process")
        }
        if extras:
            out["extra"] = extras
        return json.dumps(out, default=str, ensure_ascii=False)


def _make_json_formatter():
    if HAS_JSONLOGGER:
        fmt = jsonlogger.JsonFormatter('%(levelname)s %(asctime)s %(name)s %(module)s %(message)s')
        return fmt
    else:
        return FallbackJsonFormatter('%(message)s')


def _make_console_handler(level=logging.DEBUG, formatter=None):
    h = logging.StreamHandler(sys.stdout)
    h.setLevel(level)
    h.setFormatter(formatter or _make_json_formatter())
    return h


def _make_rotating_file_handler(filename, level=logging.INFO, max_bytes=None, backup_count=None, formatter=None):
    fh = logging.handlers.RotatingFileHandler(
        filename=str(filename),
        maxBytes=max_bytes or _DEFAULTS["file_max_bytes"],
        backupCount=backup_count or _DEFAULTS["file_backup_count"],
        encoding="utf-8"
    )
    fh.setLevel(level)
    fh.setFormatter(formatter or _make_json_formatter())
    return fh


class EmergencyHandler(logging.Handler):
    def __init__(self, mail_on_error=False, admins: Optional[Sequence[tuple]] = None,
                 email_from: Optional[str] = None, smtp: Optional[dict] = None,
                 sentinel: Optional[str] = None, shutdown=False):
        super().__init__(level=logging.CRITICAL)
        self.mail_on_error = bool(mail_on_error)
        self.admins = admins or []
        self.email_from = email_from or "no-reply@localhost"
        self.smtp = smtp or {}
        self.sentinel = sentinel
        self.shutdown = shutdown

    def emit(self, record):
        try:
            subject = f"[EMERGENCY] {record.levelname} in {record.name}"
            body = f"Time: {self.formatTime(record)}\nLogger: {record.name}\nLevel: {record.levelname}\n\nMessage:\n{record.getMessage()}\n\n"
            if record.exc_info:
                body += "Exception:\n" + "".join(traceback.format_exception(*record.exc_info)) + "\n\n"

            if self.mail_on_error and self.admins:
                try:
                    import smtplib
                    from email.message import EmailMessage
                    msg = EmailMessage()
                    msg["Subject"] = subject
                    msg["From"] = self.email_from
                    msg["To"] = ", ".join([a[1] for a in self.admins])
                    msg.set_content(body)
                    smtp_host = self.smtp.get("host")
                    smtp_port = self.smtp.get("port", 25)
                    use_tls = self.smtp.get("use_tls", False)
                    smtp_user = self.smtp.get("user")
                    smtp_pass = self.smtp.get("password")
                    if smtp_host:
                        if use_tls:
                            s = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
                            s.starttls()
                        else:
                            s = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
                        if smtp_user and smtp_pass:
                            s.login(smtp_user, smtp_pass)
                        s.send_message(msg)
                        s.quit()
                except Exception:
                    sys.stderr.write("EmergencyHandler: failed to send emergency email\n")
                    sys.stderr.write(traceback.format_exc())

            if self.sentinel:
                try:
                    Path(self.sentinel).parent.mkdir(parents=True, exist_ok=True)
                    with open(self.sentinel, "w") as fh:
                        fh.write(f"Emergency triggered by {record.name} at {self.formatTime(record)}\n")
                except Exception:
                    sys.stderr.write("EmergencyHandler: failed to write sentinel\n")
                    sys.stderr.write(traceback.format_exc())

            if self.shutdown:
                sys.stderr.write("EmergencyHandler: terminating process due to critical error.\n")
                os._exit(1)
        except Exception:
            self.handleError(record)


_CONFIGURED = False


def configure_logging(
    level: int = logging.INFO,
    json_output: bool = True,
    log_dir: Optional[Path] = None,
    file_name: Optional[str] = None,
    file_max_bytes: Optional[int] = None,
    file_backup_count: Optional[int] = None,
    console: bool = True,
    file: bool = True,
    mail_on_error: bool = False,
    admins: Optional[Sequence[tuple]] = None,
    email_from: Optional[str] = None,
    smtp_config: Optional[dict] = None,
    emergency_sentinel: Optional[str] = None,
    emergency_shutdown: bool = False,
):
    global _CONFIGURED
    if _CONFIGURED:
        return

    fmt = _make_json_formatter() if json_output else logging.Formatter("[%(asctime)s] %(levelname)s %(name)s %(message)s")
    root = logging.getLogger()
    root.setLevel(level)

    for h in list(root.handlers):
        root.removeHandler(h)

    log_dir = Path(log_dir) if log_dir else LOG_DIR
    log_dir.mkdir(parents=True, exist_ok=True)

    if console:
        ch = _make_console_handler(level=logging.DEBUG if level <= logging.DEBUG else logging.INFO, formatter=fmt)
        root.addHandler(ch)

    if file:
        fname = Path(file_name) if file_name else Path(log_dir) / "app.json.log"
        fh = _make_rotating_file_handler(fname, level=level, max_bytes=file_max_bytes or _DEFAULTS["file_max_bytes"],
                                         backup_count=file_backup_count or _DEFAULTS["file_backup_count"], formatter=fmt)
        root.addHandler(fh)

    eh = EmergencyHandler(mail_on_error, admins, email_from, smtp_config, emergency_sentinel, emergency_shutdown)
    eh.setLevel(logging.CRITICAL)
    eh.setFormatter(fmt)
    root.addHandler(eh)

    root.propagate = False
    _CONFIGURED = True


def get_logger(name: Optional[str] = None) -> logging.Logger:
    return logging.getLogger(name or __name__)
