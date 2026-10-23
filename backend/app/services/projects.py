"""Project document helpers: defaults, serialisation for the client."""

from __future__ import annotations

from typing import Any

from ..db import Asset, Project
from ..schemas import ProjectDoc
from .quality import quality_class
from .storage import media_url, new_id


def default_doc(width: int, height: int, duration: float) -> dict[str, Any]:
    vertical = height > width
    # export in the downloaded quality when it is above 1080p
    quality = {2160: "2160p", 1440: "1440p"}.get(quality_class(width, height), "1080p")
    doc = ProjectDoc(
        aspect="9:16" if vertical else "16:9",
        cuts=[{"id": new_id(6), "start": 0.0, "end": round(duration, 3)}] if duration > 0 else [],
        export={"quality": quality},
    )
    return doc.model_dump(mode="json")


def merged_doc(project: Project) -> dict[str, Any]:
    """Stored doc validated against the current schema (fills new fields)."""
    try:
        return ProjectDoc.model_validate(project.doc or {}).model_dump(mode="json")
    except Exception:  # noqa: BLE001 - old/broken doc: start from defaults, keep media
        media = project.media or {}
        return default_doc(media.get("width", 0), media.get("height", 0), media.get("duration", 0))


def project_public(project: Project, jobs: list[dict] | None = None) -> dict[str, Any]:
    media = project.media
    return {
        "id": project.id,
        "title": project.title,
        "platform": project.platform,
        "sourceUrl": project.source_url,
        "sourceRange": {"start": project.source_start, "end": project.source_end},
        "status": project.status,
        "error": project.error,
        "media": media,
        "revision": project.revision,
        "createdAt": project.created_at.isoformat() + "Z",
        "updatedAt": project.updated_at.isoformat() + "Z",
        "jobs": jobs or [],
        **merged_doc(project),
    }


def project_summary(project: Project) -> dict[str, Any]:
    media = project.media or {}
    return {
        "id": project.id,
        "title": project.title,
        "platform": project.platform,
        "status": project.status,
        "duration": round(project.source_end - project.source_start, 2),
        "posterUrl": media.get("posterUrl"),
        "aspect": (project.doc or {}).get("aspect", "9:16"),
        "updatedAt": project.updated_at.isoformat() + "Z",
    }


def asset_public(a: Asset) -> dict[str, Any]:
    return {
        "id": a.id,
        "kind": a.kind,
        "status": a.status,
        "error": a.error,
        "name": a.name,
        "width": a.width,
        "height": a.height,
        "duration": a.duration,
        "url": media_url(a.preview_file_id),
        "thumbUrl": media_url(a.thumb_file_id),
        "gif": a.meta if a.kind == "gif" else None,
        "createdAt": a.created_at.isoformat() + "Z",
    }
