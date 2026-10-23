import pytest

from app.services.errors import UserError
from app.services.timecode import format_timecode, parse_range, parse_timecode, validate_range


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("0", 0.0),
        ("45", 45.0),
        ("83", 83.0),
        ("1:23", 83.0),
        ("01:23", 83.0),
        ("1:23.5", 83.5),
        ("1:23,5", 83.5),
        ("0:05", 5.0),
        ("1:02:03", 3723.0),
        ("01:02:03.25", 3723.25),
        ("  2:10 ", 130.0),
        ("12.5", 12.5),
        ("90:00", 5400.0),  # minutes may exceed 59 without hours
    ],
)
def test_parse_timecode(text, expected):
    assert parse_timecode(text) == pytest.approx(expected)


@pytest.mark.parametrize("text", ["", "abc", "1:60", "1:75:00", "1::2", "-5", "1:2:3:4", "1:23:"])
def test_parse_timecode_invalid(text):
    with pytest.raises(UserError):
        parse_timecode(text)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("1:23-2:10", (83.0, 130.0)),
        ("1:23 - 2:10", (83.0, 130.0)),
        ("1:23–2:10", (83.0, 130.0)),
        ("1:23—2:10", (83.0, 130.0)),
        ("0:05..0:15", (5.0, 15.0)),
        ("1:00:00-1:02:30", (3600.0, 3750.0)),
        ("10 до 20", (10.0, 20.0)),
    ],
)
def test_parse_range(text, expected):
    assert parse_range(text) == pytest.approx(expected)


@pytest.mark.parametrize("text", ["1:23", "2:10-1:23", "1:23-1:23", "a-b", "1-2-3"])
def test_parse_range_invalid(text):
    with pytest.raises(UserError):
        parse_range(text)


def test_format_timecode():
    assert format_timecode(0) == "0:00"
    assert format_timecode(83.4) == "1:23"
    assert format_timecode(83.46, fraction=True) == "1:23.5"
    assert format_timecode(3723) == "1:02:03"
    assert format_timecode(59.96, fraction=True) == "1:00.0"
    assert format_timecode(-3) == "0:00"


def test_roundtrip():
    for t in (0, 1, 59, 60, 61, 599, 3599, 3600, 7322):
        assert parse_timecode(format_timecode(t)) == t


def test_validate_range():
    assert validate_range(10, 70, 600, 180) == (10, 70)
    assert validate_range(590, 700, 600, 180) == (590, 600)  # clamped to duration
    with pytest.raises(UserError, match="лимита"):
        validate_range(0, 200, 600, 180)
    with pytest.raises(UserError):
        validate_range(50, 40, 600, 180)
    with pytest.raises(UserError):
        validate_range(700, 710, 600, 180)
    with pytest.raises(UserError, match="коротк"):
        validate_range(10, 10.2, 600, 180)
