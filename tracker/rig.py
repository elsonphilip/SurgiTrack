"""Sensor rigs: where samples come from.

  SimulatedRig — a fake person tracing the path (IMU + fingertip + distance). Lets the whole pipeline run with no
                 hardware. Anything produced from it must be flagged simulated (the server does this).
  HardwareRig  — Arduino serial (BMI270 + HC-SR04) + Pi camera/MediaPipe. NOT yet tested on real hardware.
Both expose  read(target_mm, running) -> Sample  and  buzz().
"""
from __future__ import annotations
import math
import queue
import threading
import time

import numpy as np

from engine import Sample


# DRV2605L library effect ids for each game-mode tier (not yet tried on the real motor).
HAPTIC_EFFECTS = {"tick": 24, "buzz": 47, "burst": 14, "success": 10}

class CameraFeed:
    """Background thread: camera tracker → mapper → latest fingertip in trace-area mm, plus a preview JPEG for the browser."""

    def __init__(self, tracker, mapper, dist_fn=lambda: 14.0):
        self.tracker, self.mapper, self.dist_fn = tracker, mapper, dist_fn
        self.finger, self._new, self.jpeg, self._jpeg_t = None, False, None, 0.0
        self._stop = False
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self):
        while not self._stop:
            det = self.tracker.read()
            self.finger = None if det is None else self.mapper.to_mm(det, self.dist_fn())
            self._new = True
            now = time.monotonic()
            if now - self._jpeg_t > 0.12:  # ≈8 fps preview
                self.jpeg, self._jpeg_t = self.tracker.annotated_jpeg(det), now

    def take(self):
        """(latest fingertip or None, True if it is a fresh camera frame since the last call)."""
        new, self._new = self._new, False
        return self.finger, new

    def close(self):
        """Stop the thread and release the camera (idempotent). Needed for a clean exit: MediaPipe can hang at shutdown."""
        if self._stop:
            return
        self._stop = True
        self._thread.join(timeout=2)
        try:
            self.tracker.close()
        except Exception:
            pass


class SimulatedRig:
    """Fake wristband (IMU + distance). The fingertip is simulated too — unless you pass a camera tracker + mapper, in
    which case your REAL hand (laptop webcam) drives the path tracing and only the IMU is fake."""

    def __init__(self, rate_hz=100.0, finger_hz=30.0, skill=0.6, tremor_hz=8.6, seed=0, speed=1.0, realtime=True,
                 tracker=None, mapper=None):
        self.rate, self.finger_hz, self.skill, self.f_tr = rate_hz, finger_hz, float(np.clip(skill, 0, 1)), tremor_hz
        self.speed, self.realtime = speed, realtime
        self.rng = np.random.default_rng(seed)
        self.t, self._next_finger, self.buzzes = 0.0, 0.0, 0
        self.fx = []  # game-mode haptic kinds played, newest last
        self._finger = None  # last fingertip position; held between camera frames like the real rig
        self._wall0 = time.perf_counter()
        self.has_camera = tracker is not None
        self.cam = CameraFeed(tracker, mapper) if tracker is not None else None

    def buzz(self):
        self.buzzes += 1

    def play(self, kind):
        self.fx.append(kind)

    def latest_jpeg(self):
        return self.cam.jpeg if self.cam else None

    def close(self):
        if self.cam:
            self.cam.close()

    def read(self, target_mm, running):
        dt = 1.0 / self.rate
        if self.realtime:  # pace to wall-clock so a human can watch it
            ahead = self.t / self.speed - (time.perf_counter() - self._wall0)
            if ahead > 0:
                time.sleep(ahead)
        self.t += dt
        t, rng = self.t, self.rng
        wobble = 1.0 - self.skill
        burst = 3.0 if math.sin(t * 0.8) > 0.8 else 1.0
        amp_g = 0.002 + (0.03 * wobble * burst if running else 0.0)  # tremor acceleration amplitude, g
        ph = 2 * math.pi * self.f_tr * t
        imu = (
            rng.normal(0, 0.003) + amp_g * math.sin(ph),
            rng.normal(0, 0.003) + amp_g * math.cos(ph + 0.6),
            0.998 + rng.normal(0, 0.003),
            rng.normal(0, 0.2) + 40 * amp_g * math.sin(ph),
            rng.normal(0, 0.2) + 40 * amp_g * math.cos(ph),
            rng.normal(0, 0.2),
        )
        new = False
        if self.cam is not None:  # real hand from the camera
            self._finger, new = self.cam.take()
        elif t >= self._next_finger:
            self._next_finger = t + 1.0 / self.finger_hz
            new = True
            tx, ty = target_mm
            if running:
                drift = wobble * 2.0
                tr_mm = wobble * 0.5 * burst
                slip = wobble * 9.0 * math.exp(-((math.fmod(t, 12.0) - 6.7) / 0.5) ** 2)  # one wander per ~12 s
                self._finger = (tx + drift * math.sin(t * 0.9) + tr_mm * math.sin(ph) + slip + rng.normal(0, 0.05),
                          ty + drift * math.cos(t * 1.1) + tr_mm * math.cos(ph + 0.6) + 0.6 * slip + rng.normal(0, 0.05))
            else:
                self._finger = (tx + rng.normal(0, 0.05), ty + rng.normal(0, 0.05))
        return Sample(t, imu, self._finger, new, 14.2 + float(rng.normal(0, 0.15)))


def parse_line(line, time_unit="us"):
    """'t,ax,ay,az,gx,gy,gz[,dist_cm]' → (t_us, imu6, dist or None); None if malformed. time_unit: "us" or "ms"."""
    if not line or line.startswith("#"):
        return None
    p = line.strip().split(",")
    if len(p) < 7:
        return None
    try:
        t_us = int(p[0]) * (1000 if time_unit == "ms" else 1)
        imu = tuple(float(v) for v in p[1:7])
        dist = float(p[7]) if len(p) > 7 and p[7] not in ("", "nan") else None
    except ValueError:
        return None
    return (t_us, imu, dist) if 0 <= t_us < 2**32 else None


class HardwareRig:
    """Arduino stream over USB serial + camera fingertip tracking. Untested on real hardware."""

    def __init__(self, port, tracker=None, mapper=None, baud=460800, time_unit="us", protocol="repo"):
        import serial

        from scale import OverheadMapper

        # serial_for_url accepts real device paths AND pyserial URLs like loop:// (used by the tests)
        self.ser = serial.serial_for_url(port, baudrate=baud, timeout=0.2)
        self.tracker, self.mapper = tracker, mapper or OverheadMapper()
        self.time_unit, self.protocol = time_unit, protocol  # protocol "trainer" = the standalone sketch: B = buzz, D = double click
        self.has_camera = tracker is not None
        self.q = queue.Queue(maxsize=4000)
        self._dist, self._t0 = 14.0, None
        self._stop = False
        threading.Thread(target=self._read_serial, daemon=True).start()
        self.cam = CameraFeed(tracker, self.mapper, lambda: self._dist) if tracker else None

    def _read_serial(self):
        while not self._stop:
            try:
                parsed = parse_line(self.ser.readline().decode("ascii", errors="ignore"), self.time_unit)
            except Exception:
                continue
            if parsed:
                try:
                    self.q.put_nowait(parsed)
                except queue.Full:
                    pass

    def latest_jpeg(self):
        return self.cam.jpeg if self.cam else None

    def read(self, target_mm, running):
        t_us, imu, dist = self.q.get(timeout=2.0)
        if dist is not None:
            self._dist = dist
        if self._t0 is None:
            self._t0 = t_us
        finger, new = self.cam.take() if self.cam else (None, False)
        return Sample((t_us - self._t0) / 1e6, imu, finger, new, self._dist)

    def buzz(self, effect=47):
        """Ask the Arduino to play a DRV2605L effect (47 = strong buzz)."""
        if self.protocol == "trainer":
            self.ser.write(b"B\n")
        else:
            self.ser.write(f"H{effect}\n".encode())

    def play(self, kind):
        """Game-mode haptics: tick / buzz / burst / success (DRV2605L effect ids: verify on the real motor)."""
        if self.protocol == "trainer":  # the standalone sketch only knows B (buzz) and D (double click)
            self.ser.write(b"D\n" if kind == "success" else b"B\n")
        else:
            self.buzz(HAPTIC_EFFECTS[kind])

    def close(self):
        self._stop = True
        if self.cam:
            self.cam.close()
        self.ser.close()
