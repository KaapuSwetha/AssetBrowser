from django.contrib import admin
from .models_review import Project, Shot, Version, MediaAsset, ReviewStatusHistory, NoteThread, NoteMessage, NoteAttachment, Annotation

admin.site.register(Project)
admin.site.register(Shot)
admin.site.register(Version)
admin.site.register(MediaAsset)
admin.site.register(ReviewStatusHistory)
admin.site.register(NoteThread)
admin.site.register(NoteMessage)
admin.site.register(NoteAttachment)
admin.site.register(Annotation)
