"""Camera pixels → millimetres on the 120 × 60 mm trace area.

The HC-SR04 gives the camera's height above the work surface. With a pinhole camera looking straight down:
    mm_per_px = 2 · height_mm · tan(hfov / 2) / width_px
The trace area's centre is assumed to sit at the image centre (adjust `center_px` after mounting; see docs/HARDWARE.md).
Needs checking on the real rig — the FOV below is the Pi Camera v2's published horizontal FOV.
"""
import math
from dataclasses import dataclass

TRACE_MM = (120.0, 60.0)


@dataclass
class CameraGeometry:
    width_px: int = 640
    height_px: int = 480
    hfov_deg: float = 62.2  # Raspberry Pi Camera Module v2
    mirror_x: bool = False  # set True if the image is mirrored relative to the paper
    center_px: tuple | None = None  # pixel that maps to the middle of the trace area (default: image centre)


def mm_per_px(height_cm, geom: CameraGeometry):
    return 2 * (height_cm * 10.0) * math.tan(math.radians(geom.hfov_deg) / 2) / geom.width_px


def px_to_trace_mm(px, height_cm, geom: CameraGeometry = CameraGeometry()):
    """(x_px, y_px) → (x_mm, y_mm) in trace-area coordinates (origin top-left, +y down)."""
    cx, cy = geom.center_px or (geom.width_px / 2, geom.height_px / 2)
    s = mm_per_px(height_cm, geom)
    dx = (px[0] - cx) * (-1 if geom.mirror_x else 1)
    return (TRACE_MM[0] / 2 + dx * s, TRACE_MM[1] / 2 + (px[1] - cy) * s)


class OverheadMapper:
    """Pi camera looking straight down at the paper; height from the HC-SR04 (see px_to_trace_mm)."""

    def __init__(self, geom: CameraGeometry = None):
        self.geom = geom or CameraGeometry()

    def to_mm(self, det, dist_cm):
        return px_to_trace_mm(det.px, dist_cm if dist_cm else 14.0, self.geom)


class HandRulerMapper:
    """Laptop webcam facing the user — no height sensor, so the HAND is the ruler.

    The wrist → middle-finger-knuckle distance of an average adult hand is ≈ 95 mm (HAND_REF_MM). Its size in pixels
    gives mm-per-pixel at the hand's current distance from the camera, smoothed over about a second. The image centre
    maps to the middle of the 120 × 60 mm trace area. mirror_x flips left/right so moving your hand right moves the
    cursor right (a user-facing camera sees you mirrored).
    Approximate by design: foreshortening (tilting the hand) and non-average hands add error. Keep the hand roughly
    square to the camera; measure with a ruler to check (docs/HARDWARE.md).
    """

    HAND_REF_MM = 95.0

    def __init__(self, width_px=640, height_px=480, mirror_x=True, ref_mm=HAND_REF_MM, smooth=0.05, default_mm_per_px=0.5):
        self.w, self.h, self.mirror, self.ref, self.alpha = width_px, height_px, mirror_x, ref_mm, smooth
        self.mm_per_px = default_mm_per_px

    def to_mm(self, det, dist_cm=None):
        if det.hand_px > 20:  # ignore degenerate detections
            self.mm_per_px += self.alpha * (self.ref / det.hand_px - self.mm_per_px)
        dx = (det.px[0] - self.w / 2) * (-1 if self.mirror else 1)
        return (TRACE_MM[0] / 2 + dx * self.mm_per_px, TRACE_MM[1] / 2 + (det.px[1] - self.h / 2) * self.mm_per_px)
