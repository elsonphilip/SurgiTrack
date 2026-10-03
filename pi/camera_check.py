"""Check fingertip tracking before running a session.

  python camera_check.py --image photo.jpg [--save out.jpg]     # still image (works headless)
  python camera_check.py --camera 0 --mode webcam               # laptop webcam: live window, hand-size ruler; press q to quit
  python camera_check.py --camera 0 --height-cm 14              # overhead Pi camera (HC-SR04 height you pass)
Prints the fingertip in pixels and in trace-area millimetres.
"""
import argparse
import time

import cv2

from camera import FingertipTracker, HandDetector
from scale import CameraGeometry, HandRulerMapper, px_to_trace_mm


def to_mm(det, a, w, h, mapper):
    if det is None:
        return None
    return mapper.to_mm(det, a.height_cm) if mapper else px_to_trace_mm(det.px, a.height_cm, CameraGeometry(width_px=w, height_px=h))


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
    ap.add_argument("--mode", choices=["overhead", "webcam"], default="overhead")
    a = ap.parse_args()
    if a.image:
        frame = cv2.imread(a.image)
        if frame is None:
            raise SystemExit(f"cannot read {a.image}")
        det = HandDetector("image")
        d = det.detect(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        h, w = frame.shape[:2]
        mapper = HandRulerMapper(w, h, smooth=1.0) if a.mode == "webcam" else None
        px = d.px if d else None
        mm = to_mm(d, a, w, h, mapper)
        det.close()
        print("fingertip px:", px, "→ mm:", mm, f"| hand ruler: {d.hand_px:.0f} px" if d else "")
        if a.save:
            cv2.imwrite(a.save, annotate(frame, px, mm))
            print("saved", a.save)
    elif a.camera is not None:
        tr, n, t0 = FingertipTracker(a.camera), 0, time.time()
        w, h = int(tr.cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 640), int(tr.cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 480)
        mapper = HandRulerMapper(w, h) if a.mode == "webcam" else None
        print("press q in the window to quit")
        while True:
            ok, frame = tr.cap.read()
            if not ok:
                break
            d = tr.detector.detect(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            n += 1
            cv2.imshow("SurgiTrack camera check", annotate(frame, d.px if d else None, to_mm(d, a, w, h, mapper)))
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
        print(f"{n / (time.time() - t0):.1f} fps")
        tr.close()
    else:
        ap.error("pass --image or --camera")


if __name__ == "__main__":
    main()
