STATUS_MAP = {
    "act": {
        "label": "Active",
        "color": "text-green-600",
        "icon": "fa-check-circle",
        "description": "Task is active and currently being worked on."
    },
    "anifix": {
        "label": "Animation Issue",
        "color": "text-red-600",
        "icon": "fa-film",
        "description": "Animation-related technical issue."
    },
    "apr": {
        "label": "Approved",
        "color": "text-green-500",
        "icon": "fa-thumbs-up",
        "description": "Final approval given; task is considered complete and correct."
    },
    "astfix": {
        "label": "Asset Issue",
        "color": "text-red-700",
        "icon": "fa-cogs",
        "description": "Problem with referenced assets (e.g., missing or corrupted)."
    },
    "capp": {
        "label": "Client Approve",
        "color": "text-blue-600",
        "icon": "fa-user-check",
        "description": "Client has reviewed and approved this task."
    },
    "cd": {
        "label": "Cache Done",
        "color": "text-green-400",
        "icon": "fa-server",
        "description": "Cache has been completed and is ready for use."
    },
    "cerr": {
        "label": "Cache Error",
        "color": "text-orange-600",
        "icon": "fa-exclamation-triangle",
        "description": "Problem encountered during cache export/generation."
    },
    "cfrm": {
        "label": "Confirmed",
        "color": "text-green-700",
        "icon": "fa-check",
        "description": "Task status verified by supervisor or pipeline manager."
    },
    "clsd": {
        "label": "Closed",
        "color": "text-gray-600",
        "icon": "fa-times-circle",
        "description": "Task is closed and no further action will be taken."
    },
    "cmpt": {
        "label": "Complete",
        "color": "text-teal-600",
        "icon": "fa-check-circle",
        "description": "Artist has marked task complete; awaiting approval or finalization."
    },
    "crtk": {
        "label": "Client Retake",
        "color": "text-orange-600",
        "icon": "fa-redo-alt",
        "description": "Client has requested revisions."
    },
    "dis": {
        "label": "Disabled",
        "color": "text-gray-400",
        "icon": "fa-ban",
        "description": "Task disabled or deprecated in the schedule."
    },
    "dlvr": {
        "label": "Delivered",
        "color": "text-yellow-600",
        "icon": "fa-box",
        "description": "Final output sent to client or next department."
    },
    "fin": {
        "label": "Final",
        "color": "text-blue-700",
        "icon": "fa-flag-checkered",
        "description": "Final version locked; ready for delivery or archive."
    },
    "hfc": {
        "label": "Hold from Client",
        "color": "text-orange-500",
        "icon": "fa-pause-circle",
        "description": "Client has paused the task or asked to hold off."
    },
    "hld": {
        "label": "On Hold",
        "color": "text-indigo-600",
        "icon": "fa-pause",
        "description": "Task paused temporarily (could be internal or external)."
    },
    "intapp": {
        "label": "Internal Approved",
        "color": "text-blue-500",
        "icon": "fa-user-check",
        "description": "Internal team has approved the work before client review."
    },
    "interr": {
        "label": "Internal Error",
        "color": "text-red-600",
        "icon": "fa-bug",
        "description": "Issue flagged internally, requires correction before proceeding."
    },
    "intrev": {
        "label": "Internal Review",
        "color": "text-purple-600",
        "icon": "fa-search",
        "description": "Being reviewed internally for quality or consistency."
    },
    "intrtk": {
        "label": "Internal Retake",
        "color": "text-orange-700",
        "icon": "fa-redo",
        "description": "Team members requested changes before sending for review."
    },
    "ip": {
        "label": "In Progress",
        "color": "text-teal-500",
        "icon": "fa-spinner",
        "description": "Task is currently being worked on."
    },
    "na": {
        "label": "Not Assigned",
        "color": "text-gray-500",
        "icon": "fa-question-circle",
        "description": "No artist or team assigned yet."
    },
    "omt": {
        "label": "Omit",
        "color": "text-red-700",
        "icon": "fa-times",
        "description": "Task is no longer required and intentionally skipped."
    },
    "opn": {
        "label": "Open",
        "color": "text-blue-600",
        "icon": "fa-folder-open",
        "description": "Task is open in the system but unassigned or not in motion."
    },
    "pc": {
        "label": "Pending Cache",
        "color": "text-orange-500",
        "icon": "fa-history",
        "description": "Awaiting cache before proceeding to render or next stage."
    },
    "pcr": {
        "label": "Pending Client Review",
        "color": "text-orange-500",
        "icon": "fa-clock",
        "description": "Sent to client, waiting on their review."
    },
    "pndng": {
        "label": "Pending",
        "color": "text-orange-600",
        "icon": "fa-hourglass-half",
        "description": "Task is assigned but hasn't started yet."
    },
    "recd": {
        "label": "Received",
        "color": "text-green-400",
        "icon": "fa-inbox",
        "description": "Task or file has been received from another department or client."
    },
    "recom": {
        "label": "Render Complete",
        "color": "text-lime-600",
        "icon": "fa-image",
        "description": "Rendering has finished successfully."
    },
    "rerr": {
        "label": "Render Error",
        "color": "text-red-800",
        "icon": "fa-exclamation-triangle",
        "description": "Error encountered during rendering."
    },
    "res": {
        "label": "Resolved",
        "color": "text-green-600",
        "icon": "fa-check-circle",
        "description": "Issue or feedback addressed and resolved."
    },
    "rev": {
        "label": "Pending Review",
        "color": "text-orange-500",
        "icon": "fa-edit",
        "description": "Waiting for feedback from supervisor or director."
    },
    "rip": {
        "label": "Render in Progress",
        "color": "text-yellow-600",
        "icon": "fa-spinner",
        "description": "Task is in the rendering process."
    },
    "vwd": {
        "label": "Viewed",
        "color": "text-blue-500",
        "icon": "fa-eye",
        "description": "Task or media has been viewed, typically by the reviewer."
    },
    "wtg": {
        "label": "Waiting to Start",
        "color": "text-pink-500",
        "icon": "fa-clock",
        "description": "Task is blocked or queued; waiting for prior steps to complete."
    },
}

PRIORITY_MAP = {
    "high": {"label": "High", "icon": "fa-arrow-up", "color": "text-red-500", "description": "Urgent priority"},
    "mid": {"label": "Medium", "icon": "fa-minus", "color": "text-yellow-500", "description": "Moderate priority"},
    "low": {"label": "Low", "icon": "fa-arrow-down", "color": "text-green-500", "description": "Low priority"},
    "none": {"label": "None", "icon": "fa-circle", "color": "text-gray-400", "description": "No priority set"},
}

LOCATION_MAP = {
    "hyd": {"label": "Hyderabad", "icon": "fa-map-marker-alt", "color": "text-pink-400", "description": "Hyderabad Location"},
    "chn": {"label": "Chennai", "icon": "fa-map-marker-alt", "color": "text-purple-400", "description": "Chennai Location"},
    "blr": {"label": "Bangalore", "icon": "fa-map-marker-alt", "color": "text-blue-400", "description": "Bangalore Location"},
}

PROJECT_STATUS_MAP = {
    "active": {
        "label": "Active",
        "icon": "fa-check-circle",
        "color": "text-green-400",
        "description": "Project is in progress"
    },
    "inactive": {
        "label": "Inactive",
        "icon": "fa-times-circle",
        "color": "text-red-400",
        "description": "Project is on hold"
    },
    "pending": {
        "label": "Pending",
        "icon": "fa-clock",
        "color": "text-yellow-400",
        "description": "Project has not started"
    },
    "completed": {
        "label": "Completed",
        "icon": "fa-check",
        "color": "text-blue-400",
        "description": "Project is done"
    }
}

PROJECT_TYPE_MAP = {
    "tv": {
        "label": "TV Series",
        "icon": "fa-tv",
        "color": "text-yellow-400",
        "description": "Template for episodic television production"
    },
    "movie": {
        "label": "Movie",
        "icon": "fa-film",
        "color": "text-red-400",
        "description": "Template for feature-length film production"
    },
    "game": {
        "label": "Game",
        "icon": "fa-gamepad",
        "color": "text-green-400",
        "description": "Template for interactive game development"
    },
}
