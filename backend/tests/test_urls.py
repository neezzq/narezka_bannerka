import pytest

from app.services.errors import UserError
from app.services.urls import extract_url, parse_source_url


@pytest.mark.parametrize(
    ("url", "platform", "kind", "vid", "normalized"),
    [
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "video", "dQw4w9WgXcQ",
         "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ("https://youtu.be/dQw4w9WgXcQ?si=abc", "youtube", "video", "dQw4w9WgXcQ",
         "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ("https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1", "youtube", "video", "dQw4w9WgXcQ",
         "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ("https://youtube.com/shorts/abcdefghijk?feature=share", "youtube", "short", "abcdefghijk",
         "https://www.youtube.com/shorts/abcdefghijk"),
        ("youtu.be/dQw4w9WgXcQ", "youtube", "video", "dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ("https://www.twitch.tv/videos/2245678901", "twitch", "vod", "2245678901",
         "https://www.twitch.tv/videos/2245678901"),
        ("https://www.twitch.tv/somestreamer/clip/FunnyClipSlug-AbC123", "twitch", "clip", "FunnyClipSlug-AbC123",
         "https://clips.twitch.tv/FunnyClipSlug-AbC123"),
        ("https://clips.twitch.tv/FunnyClipSlug", "twitch", "clip", "FunnyClipSlug",
         "https://clips.twitch.tv/FunnyClipSlug"),
        ("https://www.tiktok.com/@user.name/video/7301234567890123456?lang=ru", "tiktok", "video",
         "7301234567890123456", "https://www.tiktok.com/@user.name/video/7301234567890123456"),
        ("https://vm.tiktok.com/ZMabc123/", "tiktok", "video", "ZMabc123", "https://vm.tiktok.com/ZMabc123/"),
        ("https://www.tiktok.com/t/ZTabc123/", "tiktok", "video", "ZTabc123", "https://www.tiktok.com/t/ZTabc123/"),
    ],
)
def test_valid_urls(url, platform, kind, vid, normalized):
    ref = parse_source_url(url)
    assert (ref.platform, ref.kind, ref.id, ref.url) == (platform, kind, vid, normalized)


def test_time_hint():
    assert parse_source_url("https://youtu.be/dQw4w9WgXcQ?t=95").start_hint == 95
    assert parse_source_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s").start_hint == 90
    assert parse_source_url("https://www.twitch.tv/videos/2245678901?t=1h2m3s").start_hint == 3723


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
        "https://evil.com/?u=https://youtube.com",
        "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
        "javascript:alert(1)",
        "https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=short",
        "https://www.youtube.com/watch?v=--option-xxx",
        "https://www.youtube.com/channel/UC123",
        "https://www.tiktok.com/@user/photo/7301234567890123456",
        "https://www.twitch.tv/directory",
        "https://127.0.0.1/video.mp4",
        "",
        "просто текст",
    ],
)
def test_invalid_urls(url):
    with pytest.raises(UserError):
        parse_source_url(url)


def test_twitch_live_channel_message():
    with pytest.raises(UserError) as exc:
        parse_source_url("https://www.twitch.tv/somestreamer")
    assert exc.value.code == "live"


def test_extract_url_from_shared_text():
    text = "Смотри, что нашёл: https://youtu.be/dQw4w9WgXcQ?si=x — огонь!"
    assert extract_url(text) == "https://youtu.be/dQw4w9WgXcQ?si=x"
    assert parse_source_url(text).id == "dQw4w9WgXcQ"


def test_url_is_never_an_option():
    # the normalised URL always starts with https:// so it can't be parsed as a CLI flag
    for u in ("youtu.be/dQw4w9WgXcQ", "https://vm.tiktok.com/ZMabc123/"):
        assert parse_source_url(u).url.startswith("https://")
