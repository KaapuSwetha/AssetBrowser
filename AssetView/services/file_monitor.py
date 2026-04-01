import os
import time
import threading
from pathlib import Path
from django.conf import settings
from django.core.management.base import BaseCommand
from utils.logger import get_logger
import requests

logger = get_logger(__name__)


class AssetFileMonitor:
    """
    Monitors asset_info.json files for creation/modification and triggers WebSocket updates.
    """

    def __init__(self, base_path: str = None):
        self.base_path = Path(base_path or settings.ASSET_BASE_PATH)
        self.watched_files = {}  # file_path -> last_modified_time
        self.running = False
        self.thread = None
        self.check_interval = getattr(settings, 'ASSET_MONITOR_INTERVAL', 5)  # seconds

    def start(self):
        """Start the file monitoring thread."""
        if self.running:
            logger.warning("File monitor is already running")
            return

        self.running = True
        self.thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.thread.start()
        logger.info(f"Started asset file monitor for {self.base_path}")

    def stop(self):
        """Stop the file monitoring thread."""
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)
        logger.info("Stopped asset file monitor")

    def _monitor_loop(self):
        """Main monitoring loop."""
        while self.running:
            try:
                self._scan_for_changes()
            except Exception as e:
                logger.exception(f"Error in file monitor loop: {e}")

            time.sleep(self.check_interval)

    def _scan_for_changes(self):
        """Scan for new or modified asset_info.json files."""
        if not self.base_path.exists():
            return

        current_files = {}

        # Find all asset_info.json files
        for json_file in self.base_path.rglob("*_asset_info.json"):
            try:
                current_mtime = json_file.stat().st_mtime
                file_path = str(json_file)
                current_files[file_path] = current_mtime

                # Check if file is new or modified
                if file_path not in self.watched_files:
                    logger.info(f"New asset file detected: {file_path}")
                    self._trigger_update(file_path)
                elif self.watched_files[file_path] != current_mtime:
                    logger.info(f"Modified asset file detected: {file_path}")
                    self._trigger_update(file_path)

            except (OSError, IOError) as e:
                logger.warning(f"Error checking file {json_file}: {e}")

        # Update watched files (remove deleted files)
        self.watched_files = current_files

    def _trigger_update(self, file_path: str):
        """Trigger WebSocket update for the asset file."""
        try:
            # Get the Django server URL - try to get from settings or use localhost
            server_url = getattr(settings, 'ASSET_BROWSER_URL', 'http://localhost:8000')

            # Call the ping endpoint
            ping_url = f"{server_url}/api/ping-asset-update/"
            response = requests.post(ping_url, json={"path": file_path}, timeout=10)

            if response.status_code == 200:
                logger.info(f"Successfully triggered update for {file_path}")
            else:
                logger.error(f"Failed to trigger update for {file_path}: {response.status_code} - {response.text}")

        except Exception as e:
            logger.exception(f"Error triggering update for {file_path}: {e}")


# Global monitor instance
_monitor_instance = None


def get_file_monitor():
    """Get or create the global file monitor instance."""
    global _monitor_instance
    if _monitor_instance is None:
        _monitor_instance = AssetFileMonitor()
    return _monitor_instance


def start_file_monitor():
    """Start the global file monitor."""
    monitor = get_file_monitor()
    monitor.start()


def stop_file_monitor():
    """Stop the global file monitor."""
    global _monitor_instance
    if _monitor_instance:
        _monitor_instance.stop()
        _monitor_instance = None


class Command(BaseCommand):
    help = 'Monitor asset files for changes and trigger WebSocket updates'

    def add_arguments(self, parser):
        parser.add_argument(
            '--path',
            type=str,
            help='Base path to monitor for asset files',
        )
        parser.add_argument(
            '--interval',
            type=int,
            default=5,
            help='Check interval in seconds (default: 5)',
        )

    def handle(self, *args, **options):
        base_path = options.get('path') or getattr(settings, 'ASSET_BASE_PATH', None)
        if not base_path:
            self.stderr.write("No base path specified. Set ASSET_BASE_PATH in settings or use --path")
            return

        monitor = AssetFileMonitor(base_path)
        monitor.check_interval = options['interval']

        self.stdout.write(f"Starting asset file monitor for {base_path} (interval: {monitor.check_interval}s)")

        try:
            monitor.start()
            # Keep running until interrupted
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            self.stdout.write("Stopping asset file monitor...")
            monitor.stop()
        except Exception as e:
            self.stderr.write(f"Error: {e}")
            monitor.stop()
