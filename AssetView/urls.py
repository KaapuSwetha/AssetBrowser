from django.conf import settings
from django.conf.urls.static import static
from django.urls import path
from . import views
from .session_heartbeat import session as session_views
from .session_heartbeat import update_status as upd_views
from . import views_review_htmx as rv

app_name = "AssetView"

urlpatterns = [
    path("", views.asset_browser, name="asset_browser"),
    path("session/heartbeat/", session_views.session_heartbeat, name="session-heartbeat"),
    path("tree/", views.get_project_tree, name="get_project_tree"),
    path("tree/category/", views.get_category_branch, name="get_category_branch"),
    path("tree/sequence/", views.get_sequence_branch, name="get_sequence_branch"),

    path("versions/", views.get_asset_versions, name="get_asset_versions"),
    path("metadata/", views.get_file_metadata, name="get_file_metadata"),
    path("sequence-clips/", views.get_sequence_clips, name="get_sequence_clips"),
    path("search/", views.search_assets, name="search_assets"),

    path("status-form/", views.status_form, name="status_form"),
    path("status-form/close/", views.status_form_close, name="status_form_close"),
    # path("status/update/", views.update_asset_status, name="update_asset_status"),

    path("preview/convert/", views.convert_preview, name="convert_preview"),
    path("review/preview/by-path/", rv.preview_by_path, name="review-preview-by-path"),
    path("review/preview/<int:media_id>/", rv.preview_by_media_id, name="review-preview-by-id"),

    path("review/playlist/create/", rv.playlist_create, name="review-playlist-create"),
    path("review/playlist/<int:playlist_id>/panel/", rv.playlist_panel, name="review-playlist-panel"),
    path("review/playlist/<int:playlist_id>/add/", rv.playlist_add_item, name="review-playlist-add"),
    path("review/playlist/<int:playlist_id>/play/", rv.playlist_play, name="review-playlist-play"),

    path("review/compare/", rv.compare_view, name="review-compare"),

    path("api/data/", views.api_data, name="api_data"),
    path("api/ping-asset-update/", upd_views.ping_asset_update, name="ping-asset-update"),
    path("update-status/", views.update_asset_status, name="update_asset_status"),
    path("merge-output/cancel/<str:job_id>/", views.cancel_merge_job, name="cancel_merge_job"),
    path("status-history/", views.get_asset_history, name="status_history"),
    path('update-preview-status/', views.update_preview_status, name='update_preview_status'),
    path('save-annotation/', views.save_annotation, name='save_annotation'),
    path('row-metadata/', views.get_row_metadata, name='get_row_metadata'),
    path('merge-sequence-clips/',        views.merge_sequence_clips,        name='merge_sequence_clips'),
    path('merge-sequence-clips/status/', views.merge_sequence_clips_status, name='merge_sequence_clips_status'),
    path('merge-sbs-clips/',        views.merge_sbs_clips,             name='merge_sbs_clips'),
    path('merge-sbs-clips/status/', views.merge_sequence_clips_status,  name='merge_sbs_clips_status'),
    path("merge-output/<str:job_id>/", views.serve_merge_output, name="serve_merge_output"),
]

urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)

if settings.DEBUG:
    urlpatterns += static("/media/s_drive/", document_root="S:/")
    urlpatterns += static("/media/n_drive/", document_root="N:/")
    urlpatterns += static("/media/v_drive/", document_root="V:/")
    urlpatterns += static("/media/x_drive/", document_root="X:/")
    urlpatterns += static("/media/y_drive/", document_root="Y:/")