"""Project document schema.

The editable part of a project is a JSON document owned by the client (Zustand)
and validated here. The render pipeline is built *only* from this document, so
every visual parameter of the preview lives in it.

Coordinates of overlays are normalised to the output frame (0..1); sizes in
pixels (font size, outline, ...) refer to the *reference frame* whose short side
is 1080 px (see ``frame_size``)."""

from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Aspect = Literal["9:16", "16:9", "1:1", "4:5"]
Fit = Literal["contain", "cover"]
Quality = Literal["720p", "1080p", "1440p", "2160p"]
Platform = Literal["youtube", "twitch", "tiktok", "upload"]
HexColor = Annotated[str, Field(pattern=r"^#[0-9A-Fa-f]{6}$")]
Id = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]

ASPECT_RATIOS: dict[str, tuple[int, int]] = {"9:16": (9, 16), "16:9": (16, 9), "1:1": (1, 1), "4:5": (4, 5)}
QUALITY_SHORT_SIDE = {"720p": 720, "1080p": 1080, "1440p": 1440, "2160p": 2160}
REFERENCE_SHORT_SIDE = 1080
MAX_TIME = 24 * 3600


def frame_size(aspect: str, short_side: int = REFERENCE_SHORT_SIDE) -> tuple[int, int]:
    """Output frame size for an aspect ratio, e.g. 9:16 @1080 -> 1080x1920."""
    aw, ah = ASPECT_RATIOS[aspect]
    if aw <= ah:
        w = short_side
        h = round(short_side * ah / aw)
    else:
        h = short_side
        w = round(short_side * aw / ah)
    return w + (w % 2), h + (h % 2)


class Model(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


Time = Annotated[float, Field(ge=0, le=MAX_TIME)]


class Range(Model):
    start: Time
    end: Time


class Cut(Model):
    id: Id
    start: Time
    end: Time

    @model_validator(mode="after")
    def _order(self) -> Cut:
        if self.end - self.start < 0.05:
            raise ValueError("cut is too short")
        return self


class VideoTransform(Model):
    scale: float = Field(1.0, ge=0.1, le=5)
    x: float = Field(0.0, ge=-2, le=2)
    y: float = Field(0.0, ge=-2, le=2)
    fit: Fit = "cover"


class ChromaSettings(Model):
    enabled: bool = True
    color: HexColor = "#00FF00"
    similarity: float = Field(0.12, ge=0.0, le=1.0)
    blend: float = Field(0.08, ge=0.0, le=1.0)
    spill: float = Field(0.5, ge=0.0, le=1.0)


class Word(Model):
    text: str = Field(max_length=200)
    start: Time
    end: Time


class Line(Model):
    id: Id
    words: list[Word] = Field(max_length=200)


class BoxStyle(Model):
    enabled: bool = False
    color: HexColor = "#000000"
    opacity: float = Field(0.6, ge=0, le=1)
    radius: float = Field(16, ge=0, le=200)
    paddingX: float = Field(24, ge=0, le=200)
    paddingY: float = Field(10, ge=0, le=200)


class SubtitlePosition(Model):
    preset: Literal["top", "center", "bottom", "custom"] = "bottom"
    x: float = Field(0.5, ge=0, le=1)
    y: float = Field(0.78, ge=0, le=1)


class SubtitleStyle(Model):
    preset: str = Field("classic", max_length=40)
    fontFamily: str = Field("montserrat", max_length=40, pattern=r"^[a-z0-9-]+$")
    fontWeight: int = Field(900, ge=100, le=900)
    fontSize: float = Field(72, ge=12, le=300)
    color: HexColor = "#FFFFFF"
    highlightColor: HexColor = "#A6E22E"
    outlineColor: HexColor = "#000000"
    outlineWidth: float = Field(6, ge=0, le=40)
    shadowColor: HexColor = "#000000"
    shadowOpacity: float = Field(0.0, ge=0, le=1)
    shadowOffset: float = Field(4, ge=0, le=60)
    box: BoxStyle = Field(default_factory=BoxStyle)
    position: SubtitlePosition = Field(default_factory=SubtitlePosition)
    wordsPerScreen: int = Field(3, ge=1, le=12)
    uppercase: bool = False
    animation: Literal["none", "fade", "pop", "slide"] = "pop"
    karaoke: bool = True
    wordPop: bool = False


class Subtitles(Model):
    enabled: bool = True
    language: str = Field("auto", max_length=8, pattern=r"^[a-z]{2,3}$|^auto$")
    words: list[Word] = Field(default_factory=list, max_length=20000)
    lines: list[Line] = Field(default_factory=list, max_length=5000)
    style: SubtitleStyle = Field(default_factory=SubtitleStyle)


Anim = Literal["none", "fade", "slide-left", "slide-right", "slide-up", "slide-down", "scale"]


class TextSpec(Model):
    """A text banner: the browser draws it into the banner's PNG, the server only keeps
    the spec so the text stays editable (the render uses the PNG like any banner)."""

    content: str = Field("", max_length=1000)
    preset: str = Field("classic", max_length=40)
    font: str = Field("montserrat", max_length=40, pattern=r"^[a-z0-9-]+$")
    weight: int = Field(900, ge=100, le=900)
    color: HexColor = "#FFFFFF"
    align: Literal["left", "center", "right"] = "center"
    outline: float = Field(0.08, ge=0, le=0.3)  # stroke width, in font sizes
    outlineColor: HexColor = "#000000"
    shadow: bool = False
    box: bool = False
    boxColor: HexColor = "#000000"
    boxOpacity: float = Field(0.6, ge=0, le=1)
    uppercase: bool = False
    # PNG metrics: font px it was drawn with and its height, to keep the size on re-render
    renderFont: float = Field(160, gt=0, le=2000)
    renderHeight: float = Field(200, gt=0, le=20000)


class Banner(Model):
    id: Id
    assetId: Id
    x: float = Field(ge=-2, le=3)
    y: float = Field(ge=-2, le=3)
    w: float = Field(gt=0, le=5)
    h: float = Field(gt=0, le=5)
    rotation: float = Field(0, ge=-360, le=360)
    opacity: float = Field(1, ge=0, le=1)
    start: Time = 0
    end: Time = 5
    animIn: Anim = "fade"
    animOut: Anim = "fade"
    animDuration: float = Field(0.4, ge=0.05, le=3)
    chroma: ChromaSettings | None = None
    text: TextSpec | None = None

    @model_validator(mode="after")
    def _order(self) -> Banner:
        if self.end <= self.start:
            raise ValueError("banner end must be after start")
        return self


class ExportSettings(Model):
    quality: Quality = "1080p"
    fps: Literal["source", 30, 60] = "source"


class ProjectDoc(Model):
    """Client-owned part of the project."""

    aspect: Aspect = "9:16"
    background: HexColor = "#000000"
    videoTransform: VideoTransform = Field(default_factory=VideoTransform)
    cuts: list[Cut] = Field(default_factory=list, max_length=500)
    subtitles: Subtitles = Field(default_factory=Subtitles)
    banners: list[Banner] = Field(default_factory=list, max_length=50)
    videoChroma: ChromaSettings | None = None
    export: ExportSettings = Field(default_factory=ExportSettings)

    @field_validator("cuts")
    @classmethod
    def _cuts_ordered(cls, cuts: list[Cut]) -> list[Cut]:
        cuts = sorted(cuts, key=lambda c: c.start)
        for a, b in zip(cuts, cuts[1:], strict=False):
            if b.start < a.end - 1e-3:
                raise ValueError("cuts must not overlap")
        return cuts


class ProjectPatch(Model):
    doc: ProjectDoc
    title: str | None = Field(None, max_length=300)
    baseRevision: int | None = None


ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
