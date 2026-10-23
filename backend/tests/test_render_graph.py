from pathlib import Path

import pytest

from app.render.graph import AssetInfo, SourceInfo, banner_motion, build_render, chroma_filters, video_placement
from app.schemas import Banner, ChromaSettings, ProjectDoc, frame_size

SRC = SourceInfo(Path("/data/original.mp4"), 1920, 1080, 30.0, "30/1", 60.0, True)


def doc(**kw) -> ProjectDoc:
    base = {"aspect": "9:16", "cuts": [{"id": "c1", "start": 0, "end": 10}]}
    base.update(kw)
    return ProjectDoc.model_validate(base)


def test_frame_sizes():
    assert frame_size("9:16", 1080) == (1080, 1920)
    assert frame_size("16:9", 1080) == (1920, 1080)
    assert frame_size("1:1", 720) == (720, 720)
    assert frame_size("4:5", 1080) == (1080, 1350)
    assert frame_size("9:16", 720) == (720, 1280)


def test_single_cut_basic_graph():
    plan = build_render(doc(), SRC, {}, Path("/out.mp4"))
    fc = plan.filter_complex
    assert (plan.width, plan.height) == (1080, 1920)
    assert "[0:v]trim=start=0:end=10,setpts=PTS-STARTPTS[vcat]" in fc
    assert "[0:a]atrim=start=0:end=10,asetpts=PTS-STARTPTS[acat]" in fc
    assert "concat" not in fc
    assert "color=c=0x000000:s=1080x1920" in fc
    assert plan.duration == pytest.approx(10)
    args = plan.args
    assert args[:2] == ["-i", "/data/original.mp4"]
    assert args[args.index("-t") + 1] == "10"
    assert args[args.index("-c:v") + 1] == "libx264"
    assert args[-1] == "/out.mp4"
    assert "-map" in args and "[vout]" in args and "[acat]" in args


def test_multiple_cuts_concat_and_duration():
    d = doc(cuts=[{"id": "a", "start": 1, "end": 3}, {"id": "b", "start": 5, "end": 8.5}])
    plan = build_render(d, SRC, {}, Path("/o.mp4"))
    fc = plan.filter_complex
    assert "[0:v]trim=start=1:end=3,setpts=PTS-STARTPTS[v0]" in fc
    assert "[0:a]atrim=start=5:end=8.5,asetpts=PTS-STARTPTS[a1]" in fc
    assert "[v0][a0][v1][a1]concat=n=2:v=1:a=1[vcat][acat]" in fc
    assert plan.duration == pytest.approx(5.5)


def test_no_audio_source_gets_silence():
    src = SourceInfo(Path("/s.mp4"), 1080, 1920, 25.0, "25/1", 20.0, False)
    plan = build_render(doc(), src, {}, Path("/o.mp4"))
    assert "anullsrc=r=48000:cl=stereo,atrim=duration=10[acat]" in plan.filter_complex
    assert "[0:a]" not in plan.filter_complex


def test_cover_crops_source_to_visible_area():
    # 1920x1080 into 1080x1920 with cover: scale = 1920/1080, visible source width = 1080/1.777 = 607.5
    d = doc(videoTransform={"fit": "cover", "scale": 1, "x": 0, "y": 0})
    p = video_placement(d, SRC, 1080, 1920)
    assert p["scale"] == pytest.approx(1920 / 1080)
    assert p["cw"] == pytest.approx(607.5)
    assert p["cx"] == pytest.approx((1920 - 607.5) / 2)
    plan = build_render(d, SRC, {}, Path("/o.mp4"))
    assert "crop=608:1080:656:0:exact=1,scale=1080:1920" in plan.filter_complex
    assert "overlay=x=0:y=0" in plan.filter_complex


def test_contain_and_offset():
    d = doc(videoTransform={"fit": "contain", "scale": 1, "x": 0, "y": 0.1})
    p = video_placement(d, SRC, 1080, 1920)
    assert p["sw"] == pytest.approx(1080) and p["sh"] == pytest.approx(607.5)
    assert p["y0"] == pytest.approx(960 + 192 - 303.75)
    plan = build_render(d, SRC, {}, Path("/o.mp4"))
    assert "crop=1920:1080:0:0:exact=1,scale=1080:608" in plan.filter_complex


def test_video_moved_out_of_frame():
    d = doc(videoTransform={"fit": "contain", "scale": 1, "x": 1.5, "y": 0})
    plan = build_render(d, SRC, {}, Path("/o.mp4"))
    assert "[vcat]nullsink" in plan.filter_complex


def test_export_fps_and_quality():
    d = doc(export={"quality": "720p", "fps": 60})
    plan = build_render(d, SRC, {}, Path("/o.mp4"))
    assert (plan.width, plan.height) == (720, 1280)
    assert plan.fps == "60"
    assert "fps=60" in plan.filter_complex
    assert plan.args[plan.args.index("-r") + 1] == "60"


def test_banners_image_gif_video_inputs_and_order():
    banners = [
        {"id": "b1", "assetId": "img", "x": 0.1, "y": 0.1, "w": 0.3, "h": 0.1, "start": 1, "end": 4},
        {"id": "b2", "assetId": "gif", "x": 0.5, "y": 0.5, "w": 0.2, "h": 0.2, "start": 0, "end": 10,
         "animIn": "none", "animOut": "none"},
        {"id": "b3", "assetId": "vid", "x": 0, "y": 0.7, "w": 1, "h": 0.2, "start": 2, "end": 8, "rotation": 15,
         "opacity": 0.5, "chroma": {"enabled": True, "color": "#00FF00", "similarity": 0.2, "blend": 0.1, "spill": 0.4}},
    ]
    assets = {
        "img": AssetInfo(Path("/a/img.png"), "image", 600, 200),
        "gif": AssetInfo(Path("/a/x.gif"), "gif", 100, 100),
        "vid": AssetInfo(Path("/a/v.mp4"), "video", 1280, 720),
    }
    plan = build_render(doc(banners=banners), SRC, assets, Path("/o.mp4"))
    fc, args = plan.filter_complex, plan.args
    assert ["-loop", "1", "-framerate", "30/1", "-i", "/a/img.png"] == plan.inputs[1]
    assert ["-ignore_loop", "0", "-i", "/a/x.gif"] == plan.inputs[2]
    assert ["-stream_loop", "-1", "-i", "/a/v.mp4"] == plan.inputs[3]
    assert args.count("-i") == 4
    # time shift, size, fade
    assert "[1:v]setpts=PTS-STARTPTS+1/TB" in fc
    assert "scale=324:192:flags=bicubic" in fc  # 0.3*1080 x 0.1*1920
    assert "fade=t=in:st=1:d=0.4:alpha=1" in fc and "fade=t=out:st=3.6:d=0.4:alpha=1" in fc
    # overlays are chained in z-order with time windows
    assert "[base0][bn0]overlay=" in fc and "[base1][bn1]overlay=" in fc and "[base2][bn2]overlay=" in fc
    assert "enable='between(t,1,4)'" in fc
    assert "[base3]scale=out_color_matrix=bt709" in fc
    # video banner: chroma + despill + opacity + rotation
    assert "chromakey=color=0x00FF00:similarity=0.2:blend=0.1" in fc
    assert "despill=type=green:mix=0.5:expand=0:red=0:blue=0:green=-0.4" in fc
    assert "colorchannelmixer=aa=0.5" in fc
    assert "rotate=a=0.261799" in fc


def test_banner_after_end_is_skipped_and_missing_asset_ignored():
    banners = [{"id": "b1", "assetId": "img", "x": 0, "y": 0, "w": 0.2, "h": 0.2, "start": 20, "end": 25},
               {"id": "b2", "assetId": "nope", "x": 0, "y": 0, "w": 0.2, "h": 0.2, "start": 0, "end": 5}]
    plan = build_render(doc(banners=banners), SRC, {"img": AssetInfo(Path("/i.png"), "image", 10, 10)}, Path("/o.mp4"))
    assert "bn0" not in plan.filter_complex and plan.args.count("-i") == 1


def test_slide_and_scale_animation_expressions():
    b = Banner.model_validate({"id": "b", "assetId": "a", "x": 0.2, "y": 0.3, "w": 0.4, "h": 0.1,
                               "start": 1, "end": 5, "animIn": "slide-left", "animOut": "slide-down",
                               "animDuration": 0.5})
    x, y = banner_motion(b, 1080, 1920)
    assert x.startswith("432-overlay_w/2+(-648)*(1-(1-pow(1-clip((t-1)/0.5,0,1),3)))")
    assert "clip((5-t)/0.5,0,1)" in y and y.startswith("672-overlay_h/2+(-768)")
    d = doc(banners=[{"id": "b", "assetId": "a", "x": 0, "y": 0, "w": 0.5, "h": 0.5, "start": 0, "end": 3,
                      "animIn": "scale", "animOut": "none"}])
    plan = build_render(d, SRC, {"a": AssetInfo(Path("/a.png"), "image", 10, 10)}, Path("/o.mp4"))
    assert "scale=w='max(2,540*(1-pow(1-clip((t-0)/0.4,0,1),3)))'" in plan.filter_complex
    assert "eval=frame" in plan.filter_complex


def test_subtitles_are_burned_last():
    plan = build_render(doc(), SRC, {}, Path("/o.mp4"), ass_path=Path("/r/subs.ass"), fonts_dir=Path("/fonts"))
    assert "[base0]ass=filename=/r/subs.ass:fontsdir=/fonts,scale=out_color_matrix=bt709" in plan.filter_complex


def test_chroma_filters_blue_screen():
    f = chroma_filters(ChromaSettings(color="#0047BB", similarity=0.1, blend=0, spill=0.3))
    assert f[3] == "chromakey=color=0x0047BB:similarity=0.1:blend=0"
    assert f[-1].startswith("despill=type=blue") and "green=0:blue=-0.3" in f[-1]
    assert chroma_filters(ChromaSettings(spill=0))[-1] == "format=gbrap"


def test_no_user_strings_in_args():
    """Only numbers and our own paths reach ffmpeg: banner/asset ids are not used in args."""
    d = doc(banners=[{"id": "evil-id", "assetId": "a", "x": 0, "y": 0, "w": 0.1, "h": 0.1, "start": 0, "end": 1}])
    plan = build_render(d, SRC, {"a": AssetInfo(Path("/a.png"), "image", 10, 10)}, Path("/o.mp4"))
    assert "evil" not in " ".join(plan.args)


def test_invalid_doc_rejected():
    with pytest.raises(ValueError):
        ProjectDoc.model_validate({"cuts": [{"id": "a", "start": 0, "end": 5}, {"id": "b", "start": 4, "end": 6}]})
    with pytest.raises(ValueError):
        ProjectDoc.model_validate({"background": "red; rm -rf /"})
    with pytest.raises(ValueError):
        ProjectDoc.model_validate({"banners": [{"id": "x", "assetId": "a", "x": 0, "y": 0, "w": 1, "h": 1,
                                                "start": 3, "end": 2}]})
