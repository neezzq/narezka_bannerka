"""Shared fixtures: the same JSON is checked by frontend/src/lib/timeline.test.ts,
so preview and export agree on cut mapping and subtitle paging."""

import json
from pathlib import Path

import pytest

from app.render import timeline as tl
from app.schemas import Cut, Line, SubtitleStyle

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "fixtures" / "timeline.json"
CASES = json.loads(FIXTURES.read_text())


@pytest.mark.parametrize("case", CASES["mapping"], ids=lambda c: c["name"])
def test_mapping(case):
    cuts = [Cut.model_validate(c) for c in case["cuts"]]
    for src, expected in case["points"]:
        out = tl.source_to_output(cuts, src)
        assert (out is None and expected is None) or out == pytest.approx(expected)
    assert tl.output_duration(cuts) == pytest.approx(case["duration"])


@pytest.mark.parametrize("case", CASES["pages"], ids=lambda c: c["name"])
def test_pages(case):
    cuts = [Cut.model_validate(c) for c in case["cuts"]]
    lines = [Line.model_validate(x) for x in case["lines"]]
    style = SubtitleStyle.model_validate(case["style"])
    pages = tl.build_pages(lines, cuts, style)
    got = [{"text": p.text, "start": p.start, "end": p.end} for p in pages]
    assert len(got) == len(case["expected"])
    for g, e in zip(got, case["expected"], strict=True):
        assert g["text"] == e["text"]
        assert g["start"] == pytest.approx(e["start"], abs=1e-3)
        assert g["end"] == pytest.approx(e["end"], abs=1e-3)
