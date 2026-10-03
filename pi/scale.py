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
