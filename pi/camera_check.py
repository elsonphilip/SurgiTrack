"""Check fingertip tracking before running a session.

  python camera_check.py --image photo.jpg [--save out.jpg]     # still image (works headless)
  python camera_check.py --camera 0 [--height-cm 14]            # live window (needs a display); press q to quit
Prints the fingertip in pixels and in trace-area millimetres (using the HC-SR04 height you pass).
"""
import argparse
import time

import cv2

from camera import FingertipTracker, HandDetector
from scale import CameraGeometry, px_to_trace_mm


def annotate(frame_bgr, px, mm):
    out = frame_bgr.copy()
    if px:
        cv2.circle(out, (int(px[0]), int(px[1])), 10, (0, 255, 0), 2)
        cv2.putText(out, f"{px[0]:.0f},{px[1]:.0f}px  {mm[0]:.1f},{mm[1]:.1f}mm", (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    else:
        cv2.putText(out, "no hand", (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image")
    ap.add_argument("--save")
    ap.add_argument("--camera", type=int)
    ap.add_argument("--height-cm", type=float, default=14.0)
    a = ap.parse_args()
    if a.image:
        frame = cv2.imread(a.image)
        if frame is None:
            raise SystemExit(f"cannot read {a.image}")
        det = HandDetector("image")
        px = det.find(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        geom = CameraGeometry(width_px=frame.shape[1], height_px=frame.shape[0])
        mm = px_to_trace_mm(px, a.height_cm, geom) if px else None
        det.close()
        print("fingertip px:", px, "→ mm:", mm)
        if a.save:
            cv2.imwrite(a.save, annotate(frame, px, mm))
            print("saved", a.save)
    elif a.camera is not None:
        tr, n, t0 = FingertipTracker(a.camera), 0, time.time()
        geom = CameraGeometry(tr.cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 640, tr.cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 480)
        print("press q in the window to quit")
        while True:
            ok, frame = tr.cap.read()
            if not ok:
                break
            px = tr.detector.find(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            n += 1
            cv2.imshow("SurgiTrack camera check", annotate(frame, px, px_to_trace_mm(px, a.height_cm, geom) if px else None))
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
        print(f"{n / (time.time() - t0):.1f} fps")
        tr.close()
    else:
        ap.error("pass --image or --camera")


if __name__ == "__main__":
    main()
