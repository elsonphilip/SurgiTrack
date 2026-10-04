"""MediaPipe fingertip detection on real photos (downloaded once; skipped if offline or MediaPipe isn't installed)."""
from __future__ import annotations
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
cv2 = pytest.importorskip("cv2")
pytest.importorskip("mediapipe")
from camera import HandDetector, ensure_model  # noqa: E402
from scale import CameraGeometry, px_to_trace_mm  # noqa: E402

THUMBS_UP = "https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/thumbs_up.jpg"


@pytest.fixture(scope="module")
def detector():
    try:
        ensure_model()
        d = HandDetector("image")
    except RuntimeError as e:  # offline / unsupported platform
        pytest.skip(str(e))
    except OSError as e:  # missing system graphics libs (apt install libegl1 libgles2)
        pytest.skip(f"MediaPipe native library unavailable: {e}")
    yield d
    d.close()


@pytest.fixture(scope="module")
def photo(tmp_path_factory):
    path = tmp_path_factory.mktemp("img") / "thumbs_up.jpg"
    try:
        urllib.request.urlretrieve(THUMBS_UP, path)
    except Exception as e:
        pytest.skip(f"sample photo unavailable: {e}")
    return cv2.cvtColor(cv2.imread(str(path)), cv2.COLOR_BGR2RGB)


def test_finds_index_fingertip_on_a_real_photo(detector, photo):
    px = detector.find(photo)
    assert px is not None
    h, w = photo.shape[:2]
    assert 0 <= px[0] <= w and 0 <= px[1] <= h
    # in this photo the curled index finger is right of centre, lower half (see docs: verified visually)
    assert px[0] > w * 0.5 and px[1] > h * 0.5


def test_no_hand_returns_none(detector):
    assert detector.find(np.zeros((480, 640, 3), np.uint8)) is None


def test_pixels_convert_to_trace_millimetres(detector, photo):
    h, w = photo.shape[:2]
    px = detector.find(photo)
    mm = px_to_trace_mm(px, 14.0, CameraGeometry(width_px=w, height_px=h))
    assert all(np.isfinite(mm))
