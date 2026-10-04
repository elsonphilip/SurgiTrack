"""Tremor/steadiness features from an IMU window.

Input: array of shape (n, 3) accel in g (or any consistent unit) sampled at fs Hz.
Gravity/posture is removed by high-passing, so features reflect movement, not orientation.
"""
from __future__ import annotations
import numpy as np
from scipy.signal import butter, filtfilt, welch

BANDS = {"low_4_6": (4.0, 6.0), "high_6_12": (6.0, 12.0)}


def highpass(x, fs, cutoff=1.0, order=2):
    b, a = butter(order, cutoff / (fs / 2), btype="high")
    return filtfilt(b, a, x, axis=0)


def band_power(freqs, psd, lo, hi):
    m = (freqs >= lo) & (freqs < hi)
    return float(np.trapezoid(psd[m], freqs[m])) if m.any() else 0.0


def extract_features(accel, fs):
    accel = np.asarray(accel, dtype=float)
    if accel.ndim != 2 or accel.shape[1] != 3:
        raise ValueError("accel must have shape (n, 3)")
    if len(accel) < int(2 * fs):
        raise ValueError("need at least 2 seconds of data")

    a = highpass(accel, fs)
    mag = np.linalg.norm(a, axis=1)  # orientation-independent movement magnitude

    freqs, psd = welch(a, fs=fs, nperseg=min(len(a), int(2 * fs)), axis=0)
    psd_total = psd.sum(axis=1)  # sum over axes

    # jerk = derivative of acceleration
    jerk = np.diff(a, axis=0) * fs
    jerk_rms = float(np.sqrt(np.mean(np.sum(jerk**2, axis=1))))

    search = (freqs >= 3.0) & (freqs <= 15.0)
    dom = float(freqs[search][np.argmax(psd_total[search])]) if search.any() else 0.0

    out = {
        "rms": float(np.sqrt(np.mean(mag**2))),
        "jerk_rms": jerk_rms,
        "dominant_freq_hz": dom,
    }
    for name, (lo, hi) in BANDS.items():
        out[f"power_{name}"] = band_power(freqs, psd_total, lo, hi)
    return out


def baseline_noise(accel, fs):
    """Features of a still window; subtract/normalize against these later."""
    return extract_features(accel, fs)
