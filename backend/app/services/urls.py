"""Validation and normalisation of source links (white list of platforms)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlsplit

from .errors import UserError

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}
TWITCH_HOSTS = {"twitch.tv", "www.twitch.tv", "m.twitch.tv", "clips.twitch.tv"}
TIKTOK_HOSTS = {"tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"}

YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
TWITCH_VOD = re.compile(r"^\d{5,15}$")
TWITCH_SLUG = re.compile(r"^[A-Za-z0-9_-]{3,100}$")
TWITCH_LOGIN = re.compile(r"^[A-Za-z0-9_]{2,25}$")
TIKTOK_ID = re.compile(r"^\d{8,25}$")
TIKTOK_USER = re.compile(r"^@[A-Za-z0-9._-]{1,40}$")
TIKTOK_SHORT = re.compile(r"^[A-Za-z0-9]{5,20}$")
URL_IN_TEXT = re.compile(r"https?://[^\s<>\"']+", re.I)
TIME_PARAM = re.compile(r"^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$")


@dataclass(frozen=True)
class SourceRef:
    platform: str  # youtube | twitch | tiktok
    kind: str  # video | short | vod | clip
    id: str
    url: str  # normalised URL passed to yt-dlp
    start_hint: float = 0.0


def _bad(msg: str = "Ссылка не поддерживается. Вставьте ссылку на YouTube, Twitch или TikTok.") -> UserError:
    return UserError(msg, code="bad_url")


def _time_hint(value: str | None) -> float:
    if not value:
        return 0.0
    m = TIME_PARAM.match(value.strip())
    if not m or not any(m.groups()):
        return 0.0
    h, mnt, s = (int(g or 0) for g in m.groups())
    return float(h * 3600 + mnt * 60 + s)


def extract_url(text: str) -> str:
    """Take the first link from arbitrary shared text ("Смотри: https://...")."""
    text = (text or "").strip()
    if not text:
        raise _bad("Вставьте ссылку на видео.")
    m = URL_IN_TEXT.search(text)
    if m:
        return m.group(0).rstrip(").,!?;»")
    first = text.split()[0]
    if "." in first and "/" in first:
        return "https://" + first.removeprefix("//")
    raise _bad()


def parse_source_url(raw: str) -> SourceRef:
    url = extract_url(raw)
    if len(url) > 2048:
        raise _bad("Ссылка слишком длинная.")
    try:
        parts = urlsplit(url)
    except ValueError as exc:
        raise _bad() from exc
    if parts.scheme.lower() not in ("http", "https"):
        raise _bad()
    if parts.username or parts.password or parts.port not in (None, 80, 443):
        raise _bad()
    host = (parts.hostname or "").lower().rstrip(".")
    segs = [s for s in parts.path.split("/") if s]
    query = parse_qs(parts.query)

    if host in YOUTUBE_HOSTS:
        return _youtube(host, segs, query)
    if host in TWITCH_HOSTS:
        return _twitch(host, segs, query)
    if host in TIKTOK_HOSTS:
        return _tiktok(host, segs)
    raise _bad()


def _youtube(host: str, segs: list[str], query: dict[str, list[str]]) -> SourceRef:
    vid = None
    kind = "video"
    if host == "youtu.be":
        vid = segs[0] if segs else None
    elif segs[:1] == ["watch"]:
        vid = (query.get("v") or [None])[0]
    elif len(segs) >= 2 and segs[0] in ("shorts", "live", "embed", "v"):
        vid = segs[1]
        kind = "short" if segs[0] == "shorts" else "video"
    if not vid or not YT_ID.match(vid):
        raise _bad("Не удалось распознать ссылку на видео YouTube.")
    url = f"https://www.youtube.com/shorts/{vid}" if kind == "short" else f"https://www.youtube.com/watch?v={vid}"
    hint = _time_hint((query.get("t") or query.get("start") or [None])[0])
    return SourceRef("youtube", kind, vid, url, hint)


def _twitch(host: str, segs: list[str], query: dict[str, list[str]]) -> SourceRef:
    if host == "clips.twitch.tv":
        slug = segs[0] if segs else ""
        if slug == "embed":
            slug = (query.get("clip") or [""])[0]
        if TWITCH_SLUG.match(slug):
            return SourceRef("twitch", "clip", slug, f"https://clips.twitch.tv/{slug}")
        raise _bad("Не удалось распознать ссылку на клип Twitch.")
    if len(segs) >= 2 and segs[0] == "videos" and TWITCH_VOD.match(segs[1]):
        hint = _time_hint((query.get("t") or [None])[0])
        return SourceRef("twitch", "vod", segs[1], f"https://www.twitch.tv/videos/{segs[1]}", hint)
    if len(segs) >= 3 and segs[1] == "clip" and TWITCH_SLUG.match(segs[2]):
        return SourceRef("twitch", "clip", segs[2], f"https://clips.twitch.tv/{segs[2]}")
    if len(segs) == 1 and TWITCH_LOGIN.match(segs[0]):
        raise UserError(
            "Прямые трансляции не поддерживаются. Откройте запись эфира (VOD) или клип и вставьте ссылку на неё.",
            code="live",
        )
    raise _bad("Не удалось распознать ссылку на Twitch. Нужна ссылка на запись (VOD) или клип.")


def _tiktok(host: str, segs: list[str]) -> SourceRef:
    if host in ("vm.tiktok.com", "vt.tiktok.com"):
        code = segs[0] if segs else ""
        if TIKTOK_SHORT.match(code):
            return SourceRef("tiktok", "video", code, f"https://{host}/{code}/")
        raise _bad("Не удалось распознать короткую ссылку TikTok.")
    if len(segs) >= 2 and segs[0] == "t" and TIKTOK_SHORT.match(segs[1]):
        return SourceRef("tiktok", "video", segs[1], f"https://www.tiktok.com/t/{segs[1]}/")
    if len(segs) >= 3 and TIKTOK_USER.match(segs[0]) and segs[1] in ("video", "photo") and TIKTOK_ID.match(segs[2]):
        if segs[1] == "photo":
            raise UserError("Это фото-пост TikTok, а не видео.", code="not_video")
        return SourceRef("tiktok", "video", segs[2], f"https://www.tiktok.com/{segs[0]}/video/{segs[2]}")
    if len(segs) >= 2 and segs[0] == "v":
        vid = segs[1].removesuffix(".html")
        if TIKTOK_ID.match(vid):
            return SourceRef("tiktok", "video", vid, f"https://www.tiktok.com/@_/video/{vid}")
    raise _bad("Не удалось распознать ссылку на видео TikTok.")
