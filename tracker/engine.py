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
# Game-mode haptic tiers (multiples of the level tolerance): tick from 75% of it, buzz outside it, burst past 2x.
WARN_DRIFT, MAJOR_DRIFT = 0.75, 2.0
TICK_GAP_S, BURST_GAP_S = 0.5, 0.12
SECTIONS = 4  # a clean quarter of the path earns a success pulse
# Steady-hold task (IMU only, no camera): the tremor index (0-10) must stay under a limit that tightens with level.
HOLD_LIMIT = {1: 4.0, 2: 3.5, 3: 3.0, 4: 2.5, 5: 2.0}
HOLD_LENGTH_S = 30.0   # default length of a steady-hold trial (path trials stay 12 s)
HOLD_STEP_S = 0.1      # re-evaluate the live tremor 10 times a second
HOLD_WARMUP_S = 1.0    # no counting or buzzing in the first second (the filters need to settle)
# Standalone-band input: the sketch (FOR_PI = false) reports its own 4-12 Hz tremor RMS in g. TREMOR_FULL_G maps that to the
# 0-10 index so that the sketch's own limit (0.010 g) is exactly the level-1 hold limit (index 4.0).
TREMOR_FULL_G = 0.025
RAW_CAP = 20000


@dataclass
class Sample:
    t: float                       # seconds (monotonic, any origin)
    imu: tuple                     # ax ay az (g)  gx gy gz (deg/s)
    finger_mm: tuple | None = None  # fingertip on the trace area, mm (None = hand not found)
    finger_new: bool = False       # True when finger_mm is a fresh camera frame
    dist_cm: float | None = None   # HC-SR04 height
    tremor_g: float | None = None  # standalone band: tremor RMS in g measured on the device (imu is then a placeholder)


def band_index(tremor_g):
    """Tremor RMS in g reported by a standalone band → the 0-10 tremor index."""
    return 10.0 * float(min(1.0, max(0.0, tremor_g / TREMOR_FULL_G)))


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
    def __init__(self, fs=100.0, haptic=None, screener=None, haptic_fx=None):
        self.lock = threading.RLock()
        self.fs = float(fs)
        self.haptic = haptic or (lambda: None)
        # Game mode: tiered haptics (tick / buzz / burst / success). haptic_fx(kind) plays the matching effect.
        self.haptic_fx = haptic_fx or (lambda kind: None)
        self.tiered = False
        self._band, self._trem_now = False, 0.0  # True once the band reports tremor_g (standalone mode, no raw IMU)
        self.task = "path"  # "path" = trace a path with the camera, "hold" = hold the hand steady (IMU only)
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
    def configure(self, level=None, path_id=None, length_s=None, tiered=None, task=None):
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
            if tiered is not None:
                self.tiered = bool(tiered)
            if task is not None:
                if task not in ("path", "hold"):
                    raise EngineError("task must be path or hold")
                self.task = task
            self.version += 1

    def begin_calibration(self):
        with self.lock:
            if self.phase == "run":
                raise EngineError("Stop the current run first")
            self.phase, self.cal_step, self.cal_count = "calib", 0, int(CAL_SECONDS)
            self._cal_t0, self._cal_buf, self._cal_g = None, [], []
            self.version += 1

    def calib_next(self):
        with self.lock:
            if self.phase != "calib":
                raise EngineError("Not calibrating")
            if self.cal_step in (0, 1):
                self.cal_step += 1
                if self.cal_step == 2:
                    self._cal_t0, self._cal_buf, self._cal_g = None, [], []
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
        """Path task: allowed deviation in mm. Hold task: the tremor-index limit."""
        return HOLD_LIMIT[self.level] if self.task == "hold" else LEVEL_TOL[self.level]

    def target_mm(self):
        with self.lock:
            return target_at(self.path_id, self._progress() if self.phase == "run" else 0.0)

    def state(self):
        with self.lock:
            return {"phase": self.phase, "calStep": self.cal_step, "calCount": self.cal_count, "level": self.level,
                    "pathId": self.path_id, "sessionLength": self.length_s, "tolerance": self.tolerance(), "task": self.task,
                    "noise": round(self.sigma_base, 4), "baseline": self.baseline}

    def live(self, s: Sample):
        with self.lock:
            n = self._n
            acc = 100 * self._in / n if n else None
            trem = self._live_tremor()
            return {
                "tremorG": s.tremor_g,
                "t": round(s.t, 3), "phase": self.phase, "imu": [round(v, 4) for v in s.imu],
                "finger": None if s.finger_mm is None else [round(s.finger_mm[0], 3), round(s.finger_mm[1], 3)],
                "dist": s.dist_cm, "dev": None if self._dev_now is None else round(self._dev_now, 3),
                "out": self._out, "acc": None if acc is None else round(acc, 1),
                "trem": round(trem, 1), "smooth": round(self._live_smooth(), 0),
                "pct": round(100 * self._progress()) if self.phase == "run" else 0,
                "time": round(self._elapsed(), 2) if self.phase == "run" else 0.0,
                "pulses": self._pulses, "haptic": s.t < self._haptic_until, "hapticKind": self._fx_kind if s.t < self._haptic_until else None,
                "spec": T.spectrum14(np.array([i[:3] for i in self._imu]), self.fs),
            }

    # ---------- sample stream ----------
    def feed(self, s: Sample):
        """Process one sample. Returns a list of events: ("done", result) / ("error", message)."""
        events = []
        with self.lock:
            self._last = s
            self._imu.append(s.imu)
            if s.tremor_g is not None:
                self._band, self._trem_now = True, band_index(s.tremor_g)
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
        self._last_tick = self._last_burst = -1e9
        self._fx_kind = None
        self._sec = 0
        self._sec_n = self._sec_out = 0
        self.success_pulses = 0
        self._last_hold, self._hold_series, self._band_g = -1e9, [], []
        self._accel, self._raw = [], []
        self._ft, self._fx = [], []
        self._last_screen = 0.0
        self._screen = []
        self._cal_t0, self._cal_buf, self._cal_g = None, [], []

    # Game-mode haptics. These only drive the motor; they never change the recorded metrics.
    def _play(self, kind, t, hold):
        self._fx_kind, self._haptic_until = kind, t + hold
        self.haptic_fx(kind)

    def _tiered_haptics(self, t, d, out, el):
        tol = self.tolerance()
        sec = min(SECTIONS - 1, int(min(el / self.length_s, 0.9999) * SECTIONS))
        if sec != self._sec:
            self._close_section()
            self._sec = sec
        self._sec_n += 1
        self._sec_out += out
        if d > MAJOR_DRIFT * tol:  # major: repeated pulses
            if t - self._last_burst >= BURST_GAP_S:
                self._last_burst = t
                self._play("burst", t, BURST_GAP_S)
        elif out:  # significant: stronger pulse
            if t - self._last_buzz >= HAPTIC_MIN_GAP_S:
                self._last_buzz = t
                self._play("buzz", t, HAPTIC_MIN_GAP_S)
        elif d > WARN_DRIFT * tol:  # slight: tiny pulse
            if t - self._last_tick >= TICK_GAP_S:
                self._last_tick = t
                self._play("tick", t, 0.1)

    def _close_section(self):
        """Success pulse when a whole quarter of the path was flown without leaving the band."""
        if self._sec_n >= 5 and self._sec_out == 0:
            self.success_pulses += 1
            self._play("success", self._last.t, 0.2)
        self._sec_n = self._sec_out = 0

    def _elapsed(self):
        return 0.0 if self._t0 is None else self._last.t - self._t0

    def _progress(self):
        return min(1.0, self._elapsed() / self.length_s)

    def _calibrate(self, s):
        if self._cal_t0 is None:
            self._cal_t0 = s.t
        self._cal_buf.append(s.imu[:3])
        if s.tremor_g is not None:
            self._cal_g.append(s.tremor_g)
        el = s.t - self._cal_t0
        self.cal_count = max(1, math.ceil(CAL_SECONDS - el))
        if el >= CAL_SECONDS:
            if self._cal_g:  # standalone band: no raw IMU, so the baseline is just the resting tremor level it reported
                self.baseline = {"pitch": 0.0, "roll": 0.0, "noiseSigma": round(float(np.mean(self._cal_g)), 5)}
            else:
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
        if len(self._raw) < RAW_CAP and s.tremor_g is None:  # a standalone band has no raw movement to record
            self._raw.append({"t": round(el, 3), "ax": s.imu[0], "ay": s.imu[1], "az": s.imu[2],
                              "gx": s.imu[3], "gy": s.imu[4], "gz": s.imu[5],
                              **({"camX": round(s.finger_mm[0], 3), "camY": round(s.finger_mm[1], 3)} if s.finger_mm else {}),
                              **({"distCm": s.dist_cm} if s.dist_cm is not None else {})})
        if self.task == "hold":
            if el >= HOLD_WARMUP_S and s.t - self._last_hold >= HOLD_STEP_S:
                self._last_hold = s.t
                trem, limit = float(self._live_tremor()), self.tolerance()
                if s.tremor_g is not None:
                    self._band_g.append(s.tremor_g)
                out = trem > limit
                self._n += 1
                self._in += not out
                self._dev_now, self._dev_sum = trem, self._dev_sum + trem
                self._hold_series.append(trem)
                if out and not self._out:
                    self._pulses += 1
                if self.tiered:
                    self._tiered_haptics(s.t, trem, out, el)
                elif out and s.t - self._last_buzz >= HAPTIC_MIN_GAP_S:
                    self._last_buzz, self._haptic_until = s.t, s.t + HAPTIC_MIN_GAP_S
                    self.haptic()
                self._out = out
        elif s.finger_new and s.finger_mm is not None:
            d = float(deviation_mm(s.finger_mm, self.path_id)[0])
            self._dev_now, self._dev_sum, self._n = d, self._dev_sum + d, self._n + 1
            out = d > self.tolerance()
            if not out:
                self._in += 1
            if out and not self._out:
                self._pulses += 1
            if self.tiered:
                self._tiered_haptics(s.t, d, out, el)
            elif out and s.t - self._last_buzz >= HAPTIC_MIN_GAP_S:
                self._last_buzz, self._haptic_until = s.t, s.t + HAPTIC_MIN_GAP_S
                self.haptic()
            self._out = out
            self._ft.append(el)
            self._fx.append(s.finger_mm)
        if self.screener and not self._band and el - self._last_screen >= 1.0 and len(self._imu) == self._imu.maxlen:
            self._last_screen = el
            try:
                self._screen.append(float(self.screener(np.array(self._imu), self.fs)))
            except Exception:
                self.screener = None  # a broken model must never break a session
        if el >= self.length_s:
            if self.tiered:
                self._close_section()
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
        if self.task == "hold":  # steadiness of the tremor level over the hold (see _finish)
            return float(min(100, max(0, 100 - 25 * np.std(self._hold_series)))) if len(self._hold_series) >= 3 else 0.0
        sp, fs = self._speed()
        return T.smoothness(sp, fs) if len(sp) else 0.0

    def _live_tremor(self):
        if self._band:
            return self._trem_now
        if len(self._imu) < T.MIN_SAMPLES:
            return 0.0
        return T.tremor_index(np.array([i[:3] for i in self._imu]), self.fs, self.sigma_base)

    def _finish(self, el):
        if self._n == 0:
            self.phase = "idle"
            self.version += 1
            if self.task == "hold":
                return ("error", "No wristband data during the run — check the USB connection and try again.")
            return ("error", "No hand was tracked during the run — check the camera view and try again.")
        sp, fs = self._speed()
        clip = lambda v, lo, hi: float(min(hi, max(lo, v)))  # noqa: E731
        if self.task == "hold":
            # Accuracy = % of the hold spent under the tremor limit. "Smoothness" = how steady the tremor level stayed
            # (spikes lower it). There is no path, so no deviation in mm. Constants are placeholders like the rest.
            series = np.array(self._hold_series)
            metrics = {
                "accuracy": round(clip(100 * self._in / self._n, 0, 100), 1),
                "avgDeviationMm": 0.0,
                "tremor": round(clip(band_index(float(np.sqrt(np.mean(np.square(self._band_g))))) if self._band_g else T.tremor_index(np.array(self._accel), self.fs, self.sigma_base), 0, 10), 1),
                "smoothness": round(clip(100 - 25 * float(series.std()), 0, 100)),
                "completionTimeS": round(el, 1),
                "hapticPulses": self._pulses,
            }
            result = {"level": self.level, "pathId": "hold", "task": "hold", "metrics": metrics, "baseline": self.baseline, "raw": self._raw}
            if self._screen:
                result["screening"] = {"tremorProbability": round(float(np.mean(self._screen)), 3), "windows": len(self._screen)}
            self.phase = "done"
            self.version += 1
            return ("done", result)
        metrics = {
            "accuracy": round(clip(100 * self._in / self._n, 0, 100), 1),
            "avgDeviationMm": round(self._dev_sum / self._n, 2),
            "tremor": round(clip(T.tremor_index(np.array(self._accel), self.fs, self.sigma_base), 0, 10), 1),
            "smoothness": round(T.smoothness(sp, fs)) if len(sp) else 0,
            "completionTimeS": round(el, 1),
            "hapticPulses": self._pulses,
        }
        result = {"level": self.level, "pathId": self.path_id, "task": "path", "metrics": metrics, "baseline": self.baseline, "raw": self._raw}
        if self._screen:
            result["screening"] = {"tremorProbability": round(float(np.mean(self._screen)), 3), "windows": len(self._screen)}
        self.phase = "done"
        self.version += 1
        return ("done", result)
