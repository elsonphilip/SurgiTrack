"""Segment a recording into windows and extract features for the classifier.

Pipeline: raw IMU (+ optional camera path columns) → high-pass filter → 2 s windows → feature vector.

Expected columns (as written by recorder.py): t_s|t, ax, ay, az, gx, gy, gz.
Optional camera/path columns (NaN-filled if absent, LightGBM handles NaN natively):
  camX, camY  fingertip position in mm   → hand velocity, smoothness
  dev_mm      distance from target path  → path deviation, time outside tolerance
"""
from __future__ import annotations
import numpy as np
from scipy.signal import butter, filtfilt, welch

FS_DEFAULT = 200.0
WIN_S = 2.0
STEP_S = 1.0

IMU_COLS = ["ax", "ay", "az", "gx", "gy", "gz"]


def _hp(x, fs, cutoff=1.0):
    b, a = butter(2, cutoff / (fs / 2), btype="high")
    return filtfilt(b, a, x, axis=0)


def _band(freqs, psd, lo, hi):
    m = (freqs >= lo) & (freqs < hi)
    return float(np.trapezoid(psd[m], freqs[m])) if m.any() else 0.0


def _stats(prefix, x):
    """x: (n, 3) high-passed signal → mean/std/RMS of magnitude + per-axis std."""
    mag = np.linalg.norm(x, axis=1)
    out = {
        f"{prefix}_mag_mean": float(mag.mean()),
        f"{prefix}_mag_std": float(mag.std()),
        f"{prefix}_mag_rms": float(np.sqrt(np.mean(mag**2))),
    }
    for i, ax in enumerate("xyz"):
        out[f"{prefix}_{ax}_std"] = float(x[:, i].std())
    return out


def _spectral(prefix, x, fs):
    mag_axes = x - x.mean(axis=0)
    freqs, psd = welch(mag_axes, fs=fs, nperseg=min(len(x), int(fs)), axis=0)
    p = psd.sum(axis=1)
    search = (freqs >= 3) & (freqs <= 15)
    dom = float(freqs[search][np.argmax(p[search])]) if search.any() else 0.0
    broad = _band(freqs, p, 0.5, 30.0) + 1e-12
    tremor = _band(freqs, p, 4.0, 12.0)
    pn = p[(freqs >= 0.5) & (freqs <= 30)]
    pn = pn / (pn.sum() + 1e-12)
    entropy = float(-(pn * np.log(pn + 1e-12)).sum() / np.log(len(pn) + 1e-12)) if len(pn) > 1 else 0.0
    band_p = p[(freqs >= 4) & (freqs < 12)]
    sharp = float(band_p.max() / (band_p.mean() + 1e-12)) if len(band_p) else 0.0
    return {
        f"{prefix}_dom_freq": dom,
        f"{prefix}_power_4_6": _band(freqs, p, 4.0, 6.0),
        f"{prefix}_power_6_12": _band(freqs, p, 6.0, 12.0),
        f"{prefix}_hf_energy": _band(freqs, p, 12.0, 30.0),
        f"{prefix}_tremor_ratio": tremor / broad,
        f"{prefix}_spec_entropy": entropy,
        f"{prefix}_peak_sharpness": sharp,
    }


def _ldlj(speed, fs):
    """Log dimensionless jerk of a speed profile (more negative = less smooth)."""
    if len(speed) < 5 or speed.max() <= 1e-9:
        return np.nan
    dt = 1.0 / fs
    jerk = np.gradient(np.gradient(speed, dt), dt)
    T = len(speed) * dt
    return float(-np.log(np.trapezoid(jerk**2, dx=dt) * T**3 / (speed.max() ** 2) + 1e-12))


def window_features(imu, fs=FS_DEFAULT, cam=None, dev_mm=None, tol_mm=None):
    """Feature dict for one window. imu: (n, 6) [ax ay az gx gy gz]; cam: (n, 2) mm or None."""
    imu = np.asarray(imu, dtype=float)
    acc, gyr = _hp(imu[:, :3], fs), _hp(imu[:, 3:6], fs)
    f = {}
    f.update(_stats("acc", acc))
    f.update(_stats("gyr", gyr))
    f["ang_vel_mean"] = float(np.linalg.norm(imu[:, 3:6], axis=1).mean())  # raw angular speed, deg/s
    jerk = np.diff(acc, axis=0) * fs
    jm = np.linalg.norm(jerk, axis=1)
    f["jerk_rms"] = float(np.sqrt(np.mean(jm**2)))
    f["jerk_max"] = float(jm.max())
    f.update(_spectral("acc", acc, fs))
    f.update(_spectral("gyr", gyr, fs))

    nan = float("nan")
    if cam is not None and not np.isnan(cam).any():
        cam = np.asarray(cam, dtype=float)
        v = np.linalg.norm(np.diff(cam, axis=0), axis=1) * fs  # mm/s
        f["hand_vel_mean"], f["hand_vel_std"] = float(v.mean()), float(v.std())
        f["smoothness_ldlj"] = _ldlj(v, fs)
    else:
        f["hand_vel_mean"] = f["hand_vel_std"] = f["smoothness_ldlj"] = nan
    if dev_mm is not None and not np.isnan(dev_mm).any():
        d = np.asarray(dev_mm, dtype=float)
        f["path_dev_mean"], f["path_dev_max"] = float(d.mean()), float(d.max())
        f["time_outside_frac"] = float((d > tol_mm).mean()) if tol_mm else nan
    else:
        f["path_dev_mean"] = f["path_dev_max"] = f["time_outside_frac"] = nan
    return f


def segment(df, fs=FS_DEFAULT, win_s=WIN_S, step_s=STEP_S, tol_mm=None):
    """Yield (start_s, feature dict) for each full window of a recording DataFrame."""
    n, step = int(win_s * fs), int(step_s * fs)
    imu = df[IMU_COLS].to_numpy(float)
    cam = df[["camX", "camY"]].to_numpy(float) if {"camX", "camY"} <= set(df.columns) else None
    dev = df["dev_mm"].to_numpy(float) if "dev_mm" in df.columns else None
    tcol = "t_s" if "t_s" in df.columns else "t"
    t = df[tcol].to_numpy(float)
    for s in range(0, len(df) - n + 1, step):
        sl = slice(s, s + n)
        yield float(t[s]), window_features(
            imu[sl], fs, None if cam is None else cam[sl], None if dev is None else dev[sl], tol_mm
        )
