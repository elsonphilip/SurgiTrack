"""Sanity checks on synthetic signals with known answers (not training data)."""
from __future__ import annotations
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from features import extract_features  # noqa: E402

FS = 200


def make(freq=0.0, amp=0.0, seconds=10, seed=1):
    rng = np.random.default_rng(seed)
    t = np.arange(seconds * FS) / FS
    a = rng.normal(0, 0.002, (len(t), 3))
    a[:, 2] += 1.0  # gravity
    a[:, 0] += amp * np.sin(2 * np.pi * freq * t)
    return a


def test_dominant_frequency_found():
    f = extract_features(make(5.0, 0.05), FS)
    assert abs(f["dominant_freq_hz"] - 5.0) < 0.6
    assert f["power_low_4_6"] > f["power_high_6_12"]


def test_high_band_tremor():
    f = extract_features(make(9.0, 0.05), FS)
    assert f["power_high_6_12"] > f["power_low_4_6"]


def test_steady_has_less_power_than_tremor():
    steady = extract_features(make(), FS)
    shaky = extract_features(make(5.0, 0.05), FS)
    assert shaky["rms"] > 5 * steady["rms"]


def test_gravity_ignored():
    a = make()
    b = a.copy()
    b[:, 2] += 0.5  # different posture offset
    assert abs(extract_features(a, FS)["rms"] - extract_features(b, FS)["rms"]) < 1e-3
