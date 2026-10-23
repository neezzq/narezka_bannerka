from pathlib import Path

from app.render.ass import ass_alpha, ass_color, ass_time, build_ass, rounded_rect
from app.schemas import Cut, Line, SubtitleStyle

FONTS = Path(__file__).resolve().parents[2] / "frontend" / "public" / "fonts"
CUTS = [Cut(id="c", start=0, end=30)]
LINES = [
    Line(id="l1", words=[{"text": "Привет", "start": 0.2, "end": 0.6}, {"text": "это", "start": 0.7, "end": 0.9},
                         {"text": "тест", "start": 1.0, "end": 1.5}]),
]


def events(ass: str) -> list[str]:
    return [line for line in ass.splitlines() if line.startswith("Dialogue:")]


def test_colour_helpers():
    assert ass_color("#A6E22E") == "&H2EE2A6&"
    assert ass_alpha(1) == "&H00&" and ass_alpha(0) == "&HFF&"
    assert ass_time(83.456) == "0:01:23.46"
    assert ass_time(3723.5) == "1:02:03.50"


def test_header_uses_reference_frame_and_internal_font():
    style = SubtitleStyle(fontFamily="montserrat", fontWeight=900, fontSize=72, animation="none", karaoke=False)
    ass = build_ass(LINES, CUTS, style, (1080, 1920), FONTS)
    assert "PlayResX: 1080" in ass and "PlayResY: 1920" in ass
    assert "ScaledBorderAndShadow: yes" in ass and "WrapStyle: 2" in ass
    # Montserrat assRatio 1.562: em 72px -> ASS size 112.46
    assert "Style: Text,BK Montserrat 900,112.46," in ass
    evs = events(ass)
    assert len(evs) == 1  # 3 words fit one page, no karaoke -> one event
    assert "{\\an5\\q2\\pos(540,1497.6)}Привет это тест" in evs[0]
    assert evs[0].startswith("Dialogue: 1,0:00:00.20,0:00:01.50,Text")


def test_karaoke_slices_and_highlight():
    style = SubtitleStyle(karaoke=True, highlightColor="#FFE600", animation="none", wordsPerScreen=3)
    evs = events(build_ass(LINES, CUTS, style, (1080, 1920), FONTS))
    assert len(evs) == 3  # one per active word
    assert "{\\1c&H00E6FF&}Привет{\\1c&HFFFFFF&}" in evs[0]
    assert "{\\1c&H00E6FF&}тест" in evs[2]
    assert evs[1].split(",")[1] == "0:00:00.70"


def test_pop_animation_and_word_pop():
    style = SubtitleStyle(animation="pop", karaoke=False, wordPop=True)
    evs = events(build_ass(LINES, CUTS, style, (1080, 1920), FONTS))
    assert "\\fscx60\\fscy60\\t(0,200,\\fscx100\\fscy100)" in evs[0]
    assert "\\fade(255,0,0,0,200,200,200)" in evs[0]
    assert "\\t(0,100,\\fs" in evs[0]  # active word grows
    # second slice starts 0.5 s into the page: no line animation left
    assert "\\fade" not in evs[1] and "\\fscx60" not in evs[1]


def test_slide_uses_move():
    style = SubtitleStyle(animation="slide", karaoke=False, position={"preset": "custom", "x": 0.5, "y": 0.5})
    ev = events(build_ass(LINES, CUTS, style, (1080, 1920), FONTS))[0]
    assert "\\move(540,1000,540,960,0,200)" in ev


def test_box_is_a_rounded_drawing_below_text():
    style = SubtitleStyle(animation="none", karaoke=False, box={"enabled": True, "color": "#A6E22E", "opacity": 1,
                                                                  "radius": 18, "paddingX": 26, "paddingY": 12})
    evs = events(build_ass(LINES, CUTS, style, (1080, 1920), FONTS))
    box = [e for e in evs if ",Box," in e]
    assert len(box) == 1 and box[0].startswith("Dialogue: 0,")
    assert "\\p1}m 18 0 l " in box[0] and "{\\p0}" in box[0]
    assert "\\1c&H2EE2A6&\\1a&H00&" in box[0]


def test_long_lines_are_fitted_into_the_frame():
    long = [Line(id="l", words=[{"text": "Оченьдлинноеслово", "start": 0, "end": 1},
                                {"text": "ещёоднодлинное", "start": 1, "end": 2}])]
    style = SubtitleStyle(fontFamily="unbounded", fontSize=110, animation="none", karaoke=False)
    ev = events(build_ass(long, CUTS, style, (1080, 1920), FONTS))[0]
    assert "\\fscx" in ev
    scale = float(ev.split("\\fscx")[1].split("\\")[0])
    assert 20 < scale < 100


def test_cuts_shift_subtitles():
    cuts = [Cut(id="a", start=0, end=0.65), Cut(id="b", start=0.95, end=30)]
    style = SubtitleStyle(animation="none", karaoke=False, wordsPerScreen=1)
    evs = events(build_ass(LINES, cuts, style, (1080, 1920), FONTS))
    texts = [e.rsplit("}", 1)[1] for e in evs]
    assert texts == ["Привет", "тест"]  # "это" (0.7-0.9) was cut out
    assert evs[1].split(",")[1] == "0:00:00.70"  # 1.0 - 0.95 + 0.65


def test_text_is_escaped():
    lines = [Line(id="l", words=[{"text": "{\\b1}hack", "start": 0, "end": 1}])]
    ev = events(build_ass(lines, CUTS, SubtitleStyle(animation="none", karaoke=False), (1080, 1920), FONTS))[0]
    assert "(/b1)hack" in ev


def test_rounded_rect_path():
    assert rounded_rect(100, 40, 0) == "m 0 0 l 100 0 100 40 0 40"
    assert rounded_rect(100, 40, 50).startswith("m 20 0")  # radius clamped to h/2
