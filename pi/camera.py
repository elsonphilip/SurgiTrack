"""Fingertip tracking with MediaPipe Hands (landmark 8 = index fingertip).

Works with BOTH MediaPipe APIs:
  * MediaPipe ≥ 0.10.x / 1.x — the "Tasks" HandLandmarker (needs the hand_landmarker.task model file, downloaded
    automatically on first use to ../models/).
  * Older MediaPipe — the legacy `mp.solutions.hands` API (removed in the newest releases).
Optional dependencies, only needed on the Pi:  pip install -r requirements-camera.txt
Verified on still photos with MediaPipe 1.0.1; NOT yet verified with a live Pi camera.
"""
import time
import urllib.request
from pathlib import Path

INDEX_TIP = 8
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"
MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "hand_landmarker.task"


def ensure_model(path=MODEL_PATH, url=MODEL_URL):
    """Return the path to the hand-landmark model, downloading it (≈8 MB) if missing."""
    path = Path(path)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        try:
            urllib.request.urlretrieve(url, tmp)
        except Exception as e:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(f"Could not download the MediaPipe hand model from {url} ({e}). "
                               f"Download it manually and save it as {path}.") from e
        tmp.rename(path)
    return path


class HandDetector:
    """RGB image (H, W, 3 uint8) → (x_px, y_px) of the index fingertip, or None if no hand is found."""

    def __init__(self, mode="video", min_conf=0.5, model_path=None):
        import mediapipe as mp

        self.mp, self.mode, self._last_ms = mp, mode, 0
        if hasattr(mp, "tasks"):
            from mediapipe.tasks.python import BaseOptions, vision

            self.backend = "tasks"
            opts = vision.HandLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=str(ensure_model(model_path or MODEL_PATH))),
                running_mode=vision.RunningMode.VIDEO if mode == "video" else vision.RunningMode.IMAGE,
                num_hands=1, min_hand_detection_confidence=min_conf,
                min_hand_presence_confidence=min_conf, min_tracking_confidence=min_conf,
            )
            self._lm = vision.HandLandmarker.create_from_options(opts)
        elif hasattr(mp, "solutions"):
            self.backend = "solutions"
            self._hands = mp.solutions.hands.Hands(
                static_image_mode=(mode == "image"), max_num_hands=1,
                min_detection_confidence=min_conf, min_tracking_confidence=min_conf)
        else:
            raise RuntimeError("This MediaPipe install has neither the Tasks nor the legacy solutions API.")

    def find(self, rgb):
        h, w = rgb.shape[:2]
        if self.backend == "tasks":
            img = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb)
            if self.mode == "video":
                self._last_ms = max(self._last_ms + 1, int(time.monotonic() * 1000))  # must strictly increase
                res = self._lm.detect_for_video(img, self._last_ms)
            else:
                res = self._lm.detect(img)
            lm = res.hand_landmarks[0][INDEX_TIP] if res.hand_landmarks else None
        else:
            res = self._hands.process(rgb)
            lm = res.multi_hand_landmarks[0].landmark[INDEX_TIP] if res.multi_hand_landmarks else None
        return None if lm is None else (lm.x * w, lm.y * h)

    def close(self):
        if getattr(self, "_closed", False):
            return
        self._closed = True
        (self._lm if self.backend == "tasks" else self._hands).close()


class FingertipTracker:
    """Camera + HandDetector. read() returns the fingertip in pixels, or None."""

    def __init__(self, camera_index=0, width=640, height=480, min_conf=0.5):
        import cv2

        self.cv2 = cv2
        self.cap = cv2.VideoCapture(camera_index)
        if not self.cap.isOpened():
            raise RuntimeError(f"Could not open camera {camera_index}")
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self.detector = HandDetector("video", min_conf)

    def read(self):
        ok, frame = self.cap.read()
        if not ok:
            return None
        return self.detector.find(self.cv2.cvtColor(frame, self.cv2.COLOR_BGR2RGB))

    def close(self):
        self.cap.release()
        self.detector.close()
