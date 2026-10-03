import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from paths import accuracy_pct, deviation_mm, load_paths, paths_for_level  # noqa: E402


def test_library_loaded_and_unique():
    p = load_paths()
    assert len(p) >= 25
    assert {1, 2, 3, 4, 5} == {v["level"] for v in p.values()}
    for lvl in range(1, 6):
        assert len(paths_for_level(lvl)) >= 4


def test_points_on_path_have_zero_deviation():
    for pid, p in load_paths().items():
        pts = p["points_mm"]
        assert deviation_mm(pts[::40], pid).max() < 1e-6, pid


def test_offset_point_deviation():
    # straight incision runs along y = 30 mm; a point 1.5 mm off the line is 1.5 mm away
    d = deviation_mm([[60.0, 31.5]], "l1-straight")[0]
    assert abs(d - 1.5) < 0.05


def test_design_paths_match_canvas_geometry():
    s = load_paths()["l1-straight"]["points_mm"]
    assert abs(s[0][0] - 15) < 1e-6 and abs(s[-1][0] - 105) < 1e-6 and abs(s[0][1] - 30) < 1e-6


def test_accuracy_definition():
    assert accuracy_pct([0.5, 1.0, 3.5, 4.0], 3.0) == 50.0
