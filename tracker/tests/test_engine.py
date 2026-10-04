from __future__ import annotations
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import scale  # noqa: E402
import tremor as T  # noqa: E402
from engine import LEVEL_TOL, EngineError, Sample, SessionEngine, target_at  # noqa: E402
from paths import load_paths  # noqa: E402
from rig import SimulatedRig, parse_line  # noqa: E402


def run_session(skill, level=3, path_id="l3-zigzag", seed=3, length=12.0, tiered=False, fx=None):
    rig = SimulatedRig(realtime=False, skill=skill, seed=seed)
    buzzes = []
    e = SessionEngine(fs=100.0, haptic=lambda: buzzes.append(1), haptic_fx=(fx.append if fx is not None else None))
    e.configure(level=level, path_id=path_id, length_s=length, tiered=tiered)
    e.begin_calibration(); e.calib_next(); e.calib_next()
    while e.phase == "calib" and e.cal_step == 2:
        e.feed(rig.read(e.target_mm(), False))
    e.calib_next()
    events = []
    while e.phase == "run":
        events += e.feed(rig.read(e.target_mm(), True))
    return e, events, buzzes


def test_tolerances_match_exported_paths():
    for p in load_paths().values():
        assert LEVEL_TOL[p["level"]] == p["tolerance_mm"], p["id"]


def test_calibration_flow_and_baseline():
    rig = SimulatedRig(realtime=False, seed=1)
    e = SessionEngine()
    with pytest.raises(EngineError):
        e.start_run()  # must calibrate first
    e.begin_calibration()
    assert (e.phase, e.cal_step) == (("calib", 0)[0], 0)
    e.calib_next(); assert e.cal_step == 1
    e.calib_next(); assert e.cal_step == 2
    counts = set()
    while e.cal_step == 2:
        e.feed(rig.read(e.target_mm(), False)); counts.add(e.cal_count)
    assert e.cal_step == 3 and {5, 1} <= counts
    assert set(e.baseline) == {"pitch", "roll", "noiseSigma"} and e.baseline["noiseSigma"] > 0
    e.calib_next()
    assert e.phase == "run"


def test_metrics_valid_and_scale_with_skill():
    steady = run_session(0.95)[1][0][1]["metrics"]
    shaky = run_session(0.25)[1][0][1]["metrics"]
    for m in (steady, shaky):
        assert 0 <= m["accuracy"] <= 100 and 0 <= m["tremor"] <= 10 and 0 <= m["smoothness"] <= 100
        assert m["completionTimeS"] == 12.0 and m["avgDeviationMm"] >= 0
    assert shaky["tremor"] > steady["tremor"] + 2
    assert shaky["accuracy"] < steady["accuracy"]
    assert shaky["avgDeviationMm"] > steady["avgDeviationMm"]
    assert shaky["hapticPulses"] > steady["hapticPulses"]


def test_haptic_fires_on_leaving_band_and_is_rate_limited():
    e, events, buzzes = run_session(0.25)
    pulses = events[0][1]["metrics"]["hapticPulses"]
    assert len(buzzes) >= 1 and pulses >= 1
    assert len(buzzes) <= 12 / 0.25 + 1  # never faster than the minimum gap


def test_result_payload_shape():
    e, events, _ = run_session(0.8)
    kind, r = events[0]
    assert kind == "done" and e.phase == "done"
    assert r["pathId"] == "l3-zigzag" and r["level"] == 3 and len(r["raw"]) > 1000
    assert {"t", "ax", "gz", "camX", "camY", "distCm"} <= set(r["raw"][500])


def test_no_hand_is_an_error_not_a_session():
    e = SessionEngine()
    e.configure(path_id="l1-straight", length_s=5)
    e.baseline = {"pitch": 0, "roll": 0, "noiseSigma": 0.003}
    e.start_run()
    events, t = [], 0.0
    while e.phase == "run":
        t += 0.01
        events += e.feed(Sample(t, (0, 0, 1, 0, 0, 0), None, False, 14.0))
    assert events[0][0] == "error" and e.phase == "idle"


def test_configure_validation():
    e = SessionEngine()
    with pytest.raises(EngineError):
        e.configure(path_id="nope")
    with pytest.raises(EngineError):
        e.configure(level=9)
    with pytest.raises(EngineError):
        e.configure(length_s=1)
    e.configure(level=4)
    assert load_paths()[e.path_id]["level"] == 4  # picks a path of that level
    e.configure(path_id="l5-trefoil")
    assert e.level == 5


def test_cannot_reconfigure_mid_run():
    e = SessionEngine()
    e.baseline = {"pitch": 0, "roll": 0, "noiseSigma": 0.003}
    e.start_run()
    with pytest.raises(EngineError):
        e.configure(level=2)


def test_target_at_endpoints():
    s = load_paths()["l1-straight"]["points_mm"]
    assert np.allclose(target_at("l1-straight", 0), s[0]) and np.allclose(target_at("l1-straight", 1), s[-1])
    mid = target_at("l1-straight", 0.5)
    assert abs(mid[0] - 60) < 0.1 and abs(mid[1] - 30) < 0.1


def test_tremor_index_monotonic_and_clipped():
    fs, t = 100.0, np.arange(300) / 100.0
    rng = np.random.default_rng(0)
    idx = []
    for amp in (0.0, 0.01, 0.03, 1.0):
        a = rng.normal(0, 0.003, (300, 3)); a[:, 0] += amp * np.sin(2 * np.pi * 7 * t)
        idx.append(T.tremor_index(a, fs, 0.003))
    assert idx == sorted(idx) and idx[0] < 1 and idx[-1] == 10.0
    assert T.band_rms(np.zeros((10, 3)), fs) == 0.0  # too short → 0, no crash


def test_suggest_k_maps_worst_case_to_ten():
    k = T.suggest_k([0.05, 0.06, 0.07], 0.003)
    assert abs(0.07 / (k * 0.003)) < 1.2


def test_smoothness_prefers_smooth_motion():
    fs, t = 30.0, np.arange(120) / 30.0
    smooth = np.sin(np.pi * t / t.max()) ** 2
    jerky = smooth + np.random.default_rng(0).normal(0, 0.15, len(t))
    assert T.smoothness(np.abs(smooth), fs) > T.smoothness(np.abs(jerky), fs)


def test_pixel_scale():
    g = scale.CameraGeometry()
    assert abs(scale.mm_per_px(14.2, g) - 0.2) < 0.02 * 10  # ~0.2 mm/px at 14 cm
    cx, cy = scale.px_to_trace_mm((320, 240), 14.2, g)
    assert abs(cx - 60) < 1e-6 and abs(cy - 30) < 1e-6
    x_right = scale.px_to_trace_mm((420, 240), 14.2, g)[0]
    assert x_right > 60
    assert scale.px_to_trace_mm((420, 240), 14.2, scale.CameraGeometry(mirror_x=True))[0] < 60


def test_parse_line():
    assert parse_line("123,0.1,0.2,0.98,1,2,3") == (123, (0.1, 0.2, 0.98, 1.0, 2.0, 3.0), None)
    assert parse_line("123,0.1,0.2,0.98,1,2,3,14.5")[2] == 14.5
    assert parse_line("# comment") is None and parse_line("1,2,3") is None and parse_line("x,1,2,3,4,5,6") is None


def test_tiered_haptics_do_not_change_the_measurements():
    plain = run_session(0.5)[1][0][1]["metrics"]
    fx = []
    tiered = run_session(0.5, tiered=True, fx=fx)[1][0][1]["metrics"]
    assert tiered == plain  # game mode only drives the motor
    assert fx


def test_tiered_haptics_cover_the_tiers_and_rate_limits():
    fx = []
    run_session(0.2, tiered=True, fx=fx)
    assert {"tick", "buzz"} <= set(fx)
    # a sloppy run never buzzes faster than the burst gap allows
    assert len(fx) <= 12 / 0.12 + 5


def test_clean_sections_earn_success_pulses():
    fx = []
    e, events, _ = run_session(1.0, level=1, path_id="l1-straight", tiered=True, fx=fx)
    assert fx.count("success") == e.success_pulses >= 1
    fx2 = []
    run_session(0.0, level=3, path_id="l3-zigzag", tiered=True, fx=fx2)
    assert fx2.count("success") <= fx.count("success")


def test_standard_mode_is_untouched():
    fx = []
    run_session(0.3, fx=fx)
    assert fx == []  # tiers only fire when the site asks for game mode
