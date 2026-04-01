# AssetView/models_review.py
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class Project(models.Model):
    name = models.CharField(max_length=128)
    code = models.CharField(max_length=32, unique=True)

    def __str__(self): return f"{self.code}"


class Shot(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    name = models.CharField(max_length=128)
    seq = models.CharField(max_length=32, blank=True, default="")

    def __str__(self): return f"{self.project.code}:{self.name}"


class Version(models.Model):
    shot = models.ForeignKey(Shot, on_delete=models.CASCADE)
    name = models.CharField(max_length=128)
    STATUS_CHOICES = [
        ("wip", "WIP"),
        ("needs_fix", "Needs Fix"),
        ("approved", "Approved"),
        ("blocked", "Blocked"),
    ]
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="wip")
    publish_comment = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self): return f"{self.shot} {self.name}"


class MediaAsset(models.Model):
    KIND_CHOICES = [("video", "Video"), ("image", "Image"), ("sequence", "Sequence")]
    version = models.ForeignKey(Version, on_delete=models.CASCADE, related_name="media")
    kind = models.CharField(max_length=16, choices=KIND_CHOICES)
    original_path = models.TextField()
    proxy_path = models.TextField(blank=True, default="")  # file or folder for sequence
    poster_path = models.TextField(blank=True, default="")
    width = models.IntegerField(null=True, blank=True)
    height = models.IntegerField(null=True, blank=True)
    duration = models.FloatField(null=True, blank=True)  # seconds (video)
    frame_count = models.IntegerField(null=True, blank=True)  # sequences

    def __str__(self):
        return f"{self.id} {self.kind} {self.version} ({self.original_path})"


class ReviewStatusHistory(models.Model):
    version = models.ForeignKey(Version, on_delete=models.CASCADE, related_name="status_history")
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    old_status = models.CharField(max_length=16)
    new_status = models.CharField(max_length=16)
    comment = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)


class NoteThread(models.Model):
    """Top-level discussion thread (like ShotGrid note) pinned to a version or media+frame/time."""
    version = models.ForeignKey(Version, on_delete=models.CASCADE, related_name="threads")
    media = models.ForeignKey(MediaAsset, on_delete=models.SET_NULL, null=True, blank=True, related_name="threads")
    at_frame = models.IntegerField(null=True, blank=True)  # for sequences/images (frame index)
    at_time = models.FloatField(null=True, blank=True)  # for video (seconds)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class NoteMessage(models.Model):
    thread = models.ForeignKey(NoteThread, on_delete=models.CASCADE, related_name="messages")
    author = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)


class NoteAttachment(models.Model):
    message = models.ForeignKey(NoteMessage, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(upload_to="cache/review_attachments/")
    created_at = models.DateTimeField(auto_now_add=True)


class Annotation(models.Model):
    """Rasterized overlay (PNG) per note; optional."""
    image = models.ImageField(
        upload_to="cache/annotations/",
        null=True, blank=True, default=None
    )
    thread = models.ForeignKey(
        "NoteThread",
        on_delete=models.CASCADE,
        related_name="annotations",
        null=True, blank=True, default=None  # ← important
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class Playlist(models.Model):
    name = models.CharField(max_length=120)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class PlaylistItem(models.Model):
    playlist = models.ForeignKey(Playlist, on_delete=models.CASCADE, related_name="items")
    version = models.ForeignKey(Version, on_delete=models.CASCADE)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return f"{self.playlist.name} — {self.version.code if hasattr(self.version, 'code') else self.version_id}"
