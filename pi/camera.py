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
from dataclasses import dataclass
from pathlib import Path

INDEX_TIP = 8
WRIST, MIDDLE_MCP = 0, 9  # their pixel distance is the "hand ruler" used for the laptop-webcam scale
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


@dataclass
class Detection:
    px: tuple            # index fingertip, pixels
    hand_px: float       # wrist → middle-finger knuckle distance in pixels (a ~95 mm ruler)
    landmarks: list      # all 21 landmarks as (x_px, y_px), for drawing


class HandDetector:
    """RGB image (H, W, 3 uint8) → Detection, or None if no hand is found."""

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

    def detect(self, rgb):
        h, w = rgb.shape[:2]
        if self.backend == "tasks":
            img = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb)
            if self.mode == "video":
                self._last_ms = max(self._last_ms + 1, int(time.monotonic() * 1000))  # must strictly increase
                res = self._lm.detect_for_video(img, self._last_ms)
            else:
                res = self._lm.detect(img)
            lms = res.hand_landmarks[0] if res.hand_landmarks else None
        else:
            res = self._hands.process(rgb)
            lms = res.multi_hand_landmarks[0].landmark if res.multi_hand_landmarks else None
        if lms is None:
            return None
        pts = [(p.x * w, p.y * h) for p in lms]
        d = ((pts[MIDDLE_MCP][0] - pts[WRIST][0]) ** 2 + (pts[MIDDLE_MCP][1] - pts[WRIST][1]) ** 2) ** 0.5
        return Detection(pts[INDEX_TIP], d, pts)

    def find(self, rgb):
        """Fingertip (x_px, y_px) or None — convenience wrapper around detect()."""
        det = self.detect(rgb)
        return None if det is None else det.px

    def close(self):
        if getattr(self, "_closed", False):
            return
        self._closed = True
        (self._lm if self.backend == "tasks" else self._hands).close()


class FingertipTracker:
    """Camera (or video file) + HandDetector. read() returns a Detection, or None if no hand / no frame.

    camera_index: 0 = the laptop's built-in webcam (macOS asks for Camera permission the first time),
    or a path to a video file to replay a recording.
    """

    def __init__(self, camera_index=0, width=640, height=480, min_conf=0.5):
        import cv2

        self.cv2 = cv2
        self.cap = cv2.VideoCapture(camera_index)
        if not self.cap.isOpened():
            raise RuntimeError(f"Could not open camera {camera_index!r}. On macOS: System Settings → Privacy & Security → "
                               "Camera → allow your terminal app, then retry.")
        self._file = not isinstance(camera_index, int)
        if self._file:  # replaying a video file: pace it at its own frame rate and loop forever (handy for demos/tests)
            self._frame_s = 1.0 / (self.cap.get(cv2.CAP_PROP_FPS) or 30.0)
            self._next = time.monotonic()
        else:
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self.detector = HandDetector("video", min_conf)
        self.last_frame = None
        self.mirror_preview = False  # selfie-style preview (set for a user-facing webcam)

    def read(self):
        if self._file:
            wait = self._next - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._next = max(self._next, time.monotonic() - self._frame_s) + self._frame_s
        ok, frame = self.cap.read()
        if not ok and self._file:  # end of file → loop
            self.cap.set(self.cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = self.cap.read()
        if not ok:
            time.sleep(0.02)  # camera unplugged: don't spin the CPU
            return None
        self.last_frame = frame
        return self.detector.detect(self.cv2.cvtColor(frame, self.cv2.COLOR_BGR2RGB))

    def annotated_jpeg(self, det=None, size=(320, 240), quality=60):
        """Latest frame (mirrored like a selfie view) with the hand skeleton + fingertip drawn, as JPEG bytes."""
        cv2 = self.cv2
        if self.last_frame is None:
            return None
        img = self.last_frame.copy()
        if det is not None:
            for x, y in det.landmarks:
                cv2.circle(img, (int(x), int(y)), 3, (200, 220, 160), -1)
            cv2.circle(img, (int(det.px[0]), int(det.px[1])), 10, (113, 133, 61), 3)
        if self.mirror_preview:
            img = cv2.flip(img, 1)
        img = cv2.resize(img, size)
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
        return buf.tobytes() if ok else None

    def close(self):
        self.cap.release()
        self.detector.close()
