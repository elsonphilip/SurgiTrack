"""Sensor rigs: where samples come from.

  SimulatedRig — a fake person tracing the path (IMU + fingertip + distance). Lets the whole pipeline run with no
                 hardware. Anything produced from it must be flagged simulated (the server does this).
  HardwareRig  — Arduino serial (BMI270 + HC-SR04) + Pi camera/MediaPipe. NOT yet tested on real hardware.
Both expose  read(target_mm, running) -> Sample  and  buzz().
"""
import math
import queue
import threading
import time

import numpy as np

from engine import Sample


class SimulatedRig:
    def __init__(self, rate_hz=100.0, finger_hz=30.0, skill=0.6, tremor_hz=8.6, seed=0, speed=1.0, realtime=True):
        self.rate, self.finger_hz, self.skill, self.f_tr = rate_hz, finger_hz, float(np.clip(skill, 0, 1)), tremor_hz
        self.speed, self.realtime = speed, realtime
        self.rng = np.random.default_rng(seed)
        self.t, self._next_finger, self.buzzes = 0.0, 0.0, 0
        self._finger = None  # last fingertip position; held between camera frames like the real rig
        self._wall0 = time.perf_counter()

    def buzz(self):
        self.buzzes += 1

    def latest_jpeg(self):
        return None  # the simulator has no camera

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
        if t >= self._next_finger:
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


def parse_line(line):
    """'t_us,ax,ay,az,gx,gy,gz[,dist_cm]' → (t_us, imu6, dist or None); None if malformed."""
    if not line or line.startswith("#"):
        return None
    p = line.strip().split(",")
    if len(p) < 7:
        return None
    try:
        t_us = int(p[0])
        imu = tuple(float(v) for v in p[1:7])
        dist = float(p[7]) if len(p) > 7 and p[7] not in ("", "nan") else None
    except ValueError:
        return None
    return (t_us, imu, dist) if 0 <= t_us < 2**32 else None


class HardwareRig:
    """Arduino stream over USB serial + camera fingertip tracking. Untested on real hardware."""

    def __init__(self, port, tracker=None, mapper=None, baud=460800):
        import serial

        from scale import OverheadMapper

        # serial_for_url accepts real device paths AND pyserial URLs like loop:// (used by the tests)
        self.ser = serial.serial_for_url(port, baudrate=baud, timeout=0.2)
        self.tracker, self.mapper = tracker, mapper or OverheadMapper()
        self.has_camera = tracker is not None
        self._jpeg, self._jpeg_t = None, 0.0
        self.q = queue.Queue(maxsize=4000)
        self._finger, self._finger_new, self._dist, self._t0 = None, False, 14.0, None
        self._stop = False
        threading.Thread(target=self._read_serial, daemon=True).start()
        if tracker:
            threading.Thread(target=self._read_camera, daemon=True).start()

    def _read_serial(self):
        while not self._stop:
            try:
                parsed = parse_line(self.ser.readline().decode("ascii", errors="ignore"))
            except Exception:
                continue
            if parsed:
                try:
                    self.q.put_nowait(parsed)
                except queue.Full:
                    pass

    def _read_camera(self):
        while not self._stop:
            det = self.tracker.read()
            self._finger = None if det is None else self.mapper.to_mm(det, self._dist)
            self._finger_new = True
            now = time.monotonic()
            if now - self._jpeg_t > 0.12:  # ≈8 fps preview for the browser
                self._jpeg, self._jpeg_t = self.tracker.annotated_jpeg(det), now

    def latest_jpeg(self):
        return self._jpeg

    def read(self, target_mm, running):
        t_us, imu, dist = self.q.get(timeout=2.0)
        if dist is not None:
            self._dist = dist
        if self._t0 is None:
            self._t0 = t_us
        new, self._finger_new = self._finger_new, False
        return Sample((t_us - self._t0) / 1e6, imu, self._finger, new, self._dist)

    def buzz(self, effect=47):
        """Ask the Arduino to play a DRV2605L effect (47 = strong buzz)."""
        self.ser.write(f"H{effect}\n".encode())

    def close(self):
        self._stop = True
        self.ser.close()
