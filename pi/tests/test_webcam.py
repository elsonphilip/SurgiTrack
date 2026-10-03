"""Laptop-webcam path: real MediaPipe on a synthetic video of a hand moving by a known amount, then the full
HardwareRig (virtual serial port + replayed video) → Sample. Skipped if MediaPipe / the sample photo aren't available."""
import sys
import threading
import time
import urllib.request
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
cv2 = pytest.importorskip("cv2")
pytest.importorskip("mediapipe")
from camera import FingertipTracker, ensure_model  # noqa: E402
from scale import HandRulerMapper  # noqa: E402

PHOTO = "https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/thumbs_up.jpg"
FRAMES, STEP_PX = 40, 4


@pytest.fixture(scope="module")
def video(tmp_path_factory):
    d = tmp_path_factory.mktemp("vid")
    try:
        ensure_model()
        urllib.request.urlretrieve(PHOTO, d / "hand.jpg")
    except Exception as e:
        pytest.skip(f"model/photo unavailable: {e}")
    photo = cv2.imread(str(d / "hand.jpg"))
    path = str(d / "move.avi")
    out = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"MJPG"), 30, (640, 480))
    for k in range(FRAMES):
        frame = np.full((480, 640, 3), 128, np.uint8)
        x0 = 40 + STEP_PX * k  # the whole photo slides right by STEP_PX each frame
        frame[30:30 + photo.shape[0], x0:x0 + photo.shape[1]] = photo
        out.write(frame)
    out.release()
    return path


def test_tracker_follows_known_motion(video):
    tr = FingertipTracker(video)
    dets = []
    for _ in range(FRAMES):
        d = tr.read()
        dets.append(d)
    tr.close()
    assert sum(d is not None for d in dets) >= FRAMES * 0.9, "hand should be found in nearly every frame"
    found = [(k, d) for k, d in enumerate(dets) if d is not None]
    k0, d0 = found[0]
    for k, d in found:
        expected_dx = STEP_PX * (k - k0)
        assert abs((d.px[0] - d0.px[0]) - expected_dx) < 8, f"frame {k}: tracked dx off by more than 8 px"
        assert abs(d.px[1] - d0.px[1]) < 8
    assert d0.hand_px > 20 and len(d0.landmarks) == 21


def test_hand_ruler_converts_motion_to_millimetres(video):
    tr = FingertipTracker(video)
    dets = [d for d in (tr.read() for _ in range(FRAMES)) if d is not None]
    tr.close()
    mapper = HandRulerMapper(640, 480, mirror_x=True, smooth=1.0)  # no smoothing: exact per-frame scale
    mm = [mapper.to_mm(d, None) for d in dets]
    assert mm[-1][0] < mm[0][0], "mirrored mapping: hand moving right in the image moves the cursor left"
    mapper_nm = HandRulerMapper(640, 480, mirror_x=False, smooth=1.0)
    mm2 = [mapper_nm.to_mm(d, None) for d in dets]
    assert mm2[-1][0] > mm2[0][0]
    s = mapper_nm.mm_per_px
    assert 0.1 < s < 3.0  # sane scale from a real hand
    moved_px = dets[-1].px[0] - dets[0].px[0]
    assert abs((mm2[-1][0] - mm2[0][0]) - moved_px * s) < 0.1 * abs(moved_px * s) + 1


def test_hardware_rig_end_to_end_with_virtual_serial_and_video(video):
    from rig import HardwareRig

    tr = FingertipTracker(video)
    rig = HardwareRig("loop://", tracker=tr, mapper=HandRulerMapper(640, 480, smooth=0.3))
    stop = threading.Event()

    def arduino():  # pretend to be the wristband firmware (200 Hz, with the distance field)
        t = 0
        while not stop.is_set():
            rig.ser.write(f"{t},0.001,-0.002,0.998,0.1,0.0,-0.1,14.2\n".encode())
            t += 5000
            time.sleep(0.005)

    threading.Thread(target=arduino, daemon=True).start()
    try:
        samples = [rig.read((0, 0), False) for _ in range(300)]
    finally:
        stop.set()
        rig.close()
    assert samples[10].imu[2] == pytest.approx(0.998) and samples[10].dist_cm == pytest.approx(14.2)
    with_finger = [s for s in samples if s.finger_mm is not None]
    assert with_finger, "camera thread never delivered a fingertip"
    assert any(s.finger_new for s in samples)
    assert all(np.isfinite(s.finger_mm).all() and abs(s.finger_mm[0]) < 2000 and abs(s.finger_mm[1]) < 2000 for s in with_finger)
    xs = [s.finger_mm[0] for s in with_finger]
    assert xs[-1] < xs[0], "hand slides right in the video; mirrored webcam mapping moves the cursor left"
    assert rig.latest_jpeg() is None or rig.latest_jpeg()[:2] == b"\xff\xd8"  # a real JPEG
