import pytest

from app.services.urls import parse_source_url
from app.services.ytdlp import map_error, storyboards, summarize


@pytest.mark.parametrize(
    ("stderr", "code"),
    [
        ("ERROR: [youtube] abc: Private video. Sign in if you've been granted access", "private"),
        ("ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader", "unavailable"),
        ("ERROR: [youtube] abc: The uploader has not made this video available in your country", "geo"),
        ("ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.", "age"),
        ("ERROR: [youtube] abc: Sign in to confirm you’re not a bot", "bot_check"),
        ("ERROR: [youtube] abc: This live event will begin in 3 hours.", "live"),
        ("ERROR: [youtube] abc: Join this channel to get access to members-only content", "members"),
        ("ERROR: Unsupported URL: https://x", "bad_url"),
        ("ERROR: something strange", "download_failed"),
    ],
)
def test_error_mapping(stderr, code):
    err = map_error(stderr)
    assert err.code == code
    assert err.message and err.message[0].isupper()


def test_storyboards_and_summary():
    info = {
        "title": "Тест",
        "duration": 120,
        "formats": [
            {"format_id": "sb2", "format_note": "storyboard", "width": 80, "height": 45, "rows": 10, "columns": 10,
             "fps": 0.5, "fragments": [{"url": "https://i.ytimg.com/sb/x/L2/M0.jpg", "duration": 200}]},
            {"format_id": "sb0", "format_note": "storyboard", "width": 160, "height": 90, "rows": 5, "columns": 5,
             "fps": 0.5, "fragments": [{"url": "https://i.ytimg.com/sb/x/L0/M0.jpg", "duration": 50},
                                       {"url": "https://i.ytimg.com/sb/x/L0/M1.jpg", "duration": 50},
                                       {"url": "https://i.ytimg.com/sb/x/L0/M2.jpg", "duration": 20}]},
        ],
    }
    sb = storyboards(info)
    assert [s["start"] for s in sb] == [0, 50, 100]
    assert sb[0]["tileWidth"] == 160 and sb[0]["interval"] == 2.0 and sb[2]["count"] == 10
    s = summarize(parse_source_url("https://youtu.be/dQw4w9WgXcQ?t=30"), info)
    assert s["player"] == {"type": "youtube", "id": "dQw4w9WgXcQ"}
    assert s["startHint"] == 30 and s["duration"] == 120
    tik = summarize(parse_source_url("https://vm.tiktok.com/ZMabc123/"), {"duration": 15})
    assert tik["player"]["type"] == "video" and tik["storyboard"] == []
