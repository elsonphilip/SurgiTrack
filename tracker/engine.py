"""Session engine: calibration → run → metrics. Pure logic driven by timestamped samples (no I/O, no sleeping),
so it runs identically on real hardware, the simulator, and in fast tests.

Flow (mirrors the website's Live Session screen):
  idle → begin_calibration() → calib step 0 (wristband on) → 1 (neutral pose) → 2 (hold still 5 s, auto) → 3 (baseline
  locked) → start_run() → run (trace the path; leaving the tolerance band fires the haptic) → done (metrics + raw data)
"""
from __future__ import annotations
import math
import threading
from collections import deque
from dataclasses import dataclass

import numpy as np

import tremor as T
from paths import deviation_mm, load_paths

LEVEL_TOL = {1: 3.0, 2: 2.5, 3: 2.0, 4: 1.5, 5: 1.0}  # mm — must match web/src/lib/scoring.ts (tested)
CAL_SECONDS = 5.0
HAPTIC_MIN_GAP_S = 0.25
RAW_CAP = 20000


@dataclass
class Sample:
    t: float                       # seconds (monotonic, any origin)
    imu: tuple                     # ax ay az (g)  gx gy gz (deg/s)
    finger_mm: tuple | None = None  # fingertip on the trace area, mm (None = hand not found)
    finger_new: bool = False       # True when finger_mm is a fresh camera frame
    dist_cm: float | None = None   # HC-SR04 height


class EngineError(Exception):
    pass


def target_at(path_id, progress):
    """Target point (mm) at progress ∈ [0,1] along a path (points are uniform in the path parameter)."""
    pts = load_paths()[path_id]["points_mm"]
    x = min(max(progress, 0.0), 1.0) * (len(pts) - 1)
    i = min(int(x), len(pts) - 2)
    u = x - i
    return tuple(pts[i] + (pts[i + 1] - pts[i]) * u)


class SessionEngine:
    def __init__(self, fs=100.0, haptic=None, screener=None):
        self.lock = threading.RLock()
        self.fs = float(fs)
        self.haptic = haptic or (lambda: None)
        self.screener = screener
        self.level, self.path_id, self.length_s = 1, "l1-straight", 12.0
        self.phase, self.cal_step, self.cal_count = "idle", 0, 5
        self.baseline = None
        self.sigma_base = T.DEFAULT_SIGMA
        self.version = 0
        self._imu = deque(maxlen=int(2 * fs))
        self._last = Sample(0.0, (0, 0, 1, 0, 0, 0))
        self._reset_run()

    # ---------- configuration / commands ----------
    def configure(self, level=None, path_id=None, length_s=None):
        with self.lock:
            if self.phase == "run":
                raise EngineError("Can't change settings during a run")
            paths = load_paths()
            if level is not None:
                if level not in LEVEL_TOL:
                    raise EngineError("level must be 1–5")
                self.level = level
                if path_id is None and paths[self.path_id]["level"] != level:
                    path_id = next(p["id"] for p in paths.values() if p["level"] == level)
            if path_id is not None:
                if path_id not in paths:
                    raise EngineError(f"unknown path {path_id}")
                self.path_id = path_id
                self.level = paths[path_id]["level"]
            if length_s is not None:
                if not 5 <= length_s <= 40:
                    raise EngineError("session length must be 5–40 s")
                self.length_s = float(length_s)
            self.version += 1

    def begin_calibration(self):
        with self.lock:
            if self.phase == "run":
                raise EngineError("Stop the current run first")
            self.phase, self.cal_step, self.cal_count = "calib", 0, int(CAL_SECONDS)
            self._cal_t0, self._cal_buf = None, []
            self.version += 1

    def calib_next(self):
        with self.lock:
            if self.phase != "calib":
                raise EngineError("Not calibrating")
            if self.cal_step in (0, 1):
                self.cal_step += 1
                if self.cal_step == 2:
                    self._cal_t0, self._cal_buf = None, []
                self.version += 1
            elif self.cal_step == 3:
                self.start_run()

    def start_run(self):
        with self.lock:
            if self.baseline is None:
                raise EngineError("Calibrate first")
            self._reset_run()
            self.phase = "run"
            self.version += 1

    def stop(self):
        with self.lock:
            self.phase = "idle"
            self._reset_run()
            self.version += 1

    # ---------- queries ----------
    def tolerance(self):
        return LEVEL_TOL[self.level]

    def target_mm(self):
        with self.lock:
            return target_at(self.path_id, self._progress() if self.phase == "run" else 0.0)

    def state(self):
        with self.lock:
            return {"phase": self.phase, "calStep": self.cal_step, "calCount": self.cal_count, "level": self.level,
                    "pathId": self.path_id, "sessionLength": self.length_s, "tolerance": self.tolerance(),
                    "noise": round(self.sigma_base, 4), "baseline": self.baseline}

    def live(self, s: Sample):
        with self.lock:
            n = self._n
            acc = 100 * self._in / n if n else None
            trem = self._live_tremor()
            return {
                "t": round(s.t, 3), "phase": self.phase, "imu": [round(v, 4) for v in s.imu],
                "finger": None if s.finger_mm is None else [round(s.finger_mm[0], 3), round(s.finger_mm[1], 3)],
                "dist": s.dist_cm, "dev": None if self._dev_now is None else round(self._dev_now, 3),
                "out": self._out, "acc": None if acc is None else round(acc, 1),
                "trem": round(trem, 1), "smooth": round(self._live_smooth(), 0),
                "pct": round(100 * self._progress()) if self.phase == "run" else 0,
                "time": round(self._elapsed(), 2) if self.phase == "run" else 0.0,
                "pulses": self._pulses, "haptic": s.t < self._haptic_until,
                "spec": T.spectrum14(np.array([i[:3] for i in self._imu]), self.fs),
            }

    # ---------- sample stream ----------
    def feed(self, s: Sample):
        """Process one sample. Returns a list of events: ("done", result) / ("error", message)."""
        events = []
        with self.lock:
            self._last = s
            self._imu.append(s.imu)
            if self.phase == "calib" and self.cal_step == 2:
                self._calibrate(s)
            elif self.phase == "run":
                events += self._run(s)
        return events

    # ---------- internals ----------
    def _reset_run(self):
        self._t0 = None
        self._n = self._in = 0
        self._dev_sum = 0.0
        self._dev_now = None
        self._out = False
        self._pulses = 0
        self._haptic_until = -1.0
        self._last_buzz = -1e9
        self._accel, self._raw = [], []
        self._ft, self._fx = [], []
        self._last_screen = 0.0
        self._screen = []
        self._cal_t0, self._cal_buf = None, []

    def _elapsed(self):
        return 0.0 if self._t0 is None else self._last.t - self._t0

    def _progress(self):
        return min(1.0, self._elapsed() / self.length_s)

    def _calibrate(self, s):
        if self._cal_t0 is None:
            self._cal_t0 = s.t
        self._cal_buf.append(s.imu[:3])
        el = s.t - self._cal_t0
        self.cal_count = max(1, math.ceil(CAL_SECONDS - el))
        if el >= CAL_SECONDS:
            a = np.array(self._cal_buf)
            g = a.mean(axis=0)
            self.sigma_base = T.noise_floor(a, self.fs)
            self.baseline = {
                "pitch": round(math.degrees(math.atan2(-g[0], math.hypot(g[1], g[2]))), 2),
                "roll": round(math.degrees(math.atan2(g[1], g[2])), 2),
                "noiseSigma": round(self.sigma_base, 5),
            }
            self.cal_step, self.cal_count = 3, 0
            self.version += 1

    def _run(self, s):
        events = []
        if self._t0 is None:
            self._t0 = s.t
        el = s.t - self._t0
        self._accel.append(s.imu[:3])
        if len(self._raw) < RAW_CAP:
            self._raw.append({"t": round(el, 3), "ax": s.imu[0], "ay": s.imu[1], "az": s.imu[2],
                              "gx": s.imu[3], "gy": s.imu[4], "gz": s.imu[5],
                              **({"camX": round(s.finger_mm[0], 3), "camY": round(s.finger_mm[1], 3)} if s.finger_mm else {}),
                              **({"distCm": s.dist_cm} if s.dist_cm is not None else {})})
        if s.finger_new and s.finger_mm is not None:
            d = float(deviation_mm(s.finger_mm, self.path_id)[0])
            self._dev_now, self._dev_sum, self._n = d, self._dev_sum + d, self._n + 1
            out = d > self.tolerance()
            if not out:
                self._in += 1
            if out and not self._out:
                self._pulses += 1
            if out and s.t - self._last_buzz >= HAPTIC_MIN_GAP_S:
                self._last_buzz, self._haptic_until = s.t, s.t + HAPTIC_MIN_GAP_S
                self.haptic()
            self._out = out
            self._ft.append(el)
            self._fx.append(s.finger_mm)
        if self.screener and el - self._last_screen >= 1.0 and len(self._imu) == self._imu.maxlen:
            self._last_screen = el
            try:
                self._screen.append(float(self.screener(np.array(self._imu), self.fs)))
            except Exception:
                self.screener = None  # a broken model must never break a session
        if el >= self.length_s:
            events.append(self._finish(el))
        return events

    def _speed(self):
        if len(self._ft) < 8:
            return np.array([]), 0.0
        t, x = np.array(self._ft), np.array(self._fx)
        fs = 1.0 / max(float(np.median(np.diff(t))), 1e-3)
        sp = np.linalg.norm(np.diff(x, axis=0), axis=1) * fs
        if len(sp) >= 3:  # light smoothing: camera landmark jitter is not hand jerk
            sp = np.convolve(sp, np.ones(3) / 3, mode="same")
        return sp, fs

    def _live_smooth(self):
        sp, fs = self._speed()
        return T.smoothness(sp, fs) if len(sp) else 0.0

    def _live_tremor(self):
        if len(self._imu) < T.MIN_SAMPLES:
            return 0.0
        return T.tremor_index(np.array([i[:3] for i in self._imu]), self.fs, self.sigma_base)

    def _finish(self, el):
        if self._n == 0:
            self.phase = "idle"
            self.version += 1
            return ("error", "No hand was tracked during the run — check the camera view and try again.")
        sp, fs = self._speed()
        clip = lambda v, lo, hi: float(min(hi, max(lo, v)))  # noqa: E731
        metrics = {
            "accuracy": round(clip(100 * self._in / self._n, 0, 100), 1),
            "avgDeviationMm": round(self._dev_sum / self._n, 2),
            "tremor": round(clip(T.tremor_index(np.array(self._accel), self.fs, self.sigma_base), 0, 10), 1),
            "smoothness": round(T.smoothness(sp, fs)) if len(sp) else 0,
            "completionTimeS": round(el, 1),
            "hapticPulses": self._pulses,
        }
        result = {"level": self.level, "pathId": self.path_id, "metrics": metrics, "baseline": self.baseline, "raw": self._raw}
        if self._screen:
            result["screening"] = {"tremorProbability": round(float(np.mean(self._screen)), 3), "windows": len(self._screen)}
        self.phase = "done"
        self.version += 1
        return ("done", result)
