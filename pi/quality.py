"""Sanity-check a recording before it goes into the training set."""
import numpy as np
import pandas as pd

MIN_RATE_HZ = 150.0   # firmware streams ~200 Hz
MAX_GAP_S = 0.1


def check_recording(csv_path):
    df = pd.read_csv(csv_path)
    problems = []
    n = len(df)
    if n < 50:
        return {"n": n, "rate_hz": 0.0, "max_gap_s": 0.0, "gravity_g": 0.0, "problems": ["almost no data — is the stream running?"], "ok": False}
    t = df["t_s"].to_numpy(float)
    dur = t[-1] - t[0]
    rate = (n - 1) / dur if dur > 0 else 0.0
    gaps = np.diff(t)
    max_gap = float(gaps.max())
    accel, gyro = df[["ax", "ay", "az"]].to_numpy(float), df[["gx", "gy", "gz"]].to_numpy(float)
    gravity = float(np.linalg.norm(accel.mean(axis=0)))
    if np.isnan(accel).any() or np.isnan(gyro).any():
        problems.append("contains NaN values")
    if rate < MIN_RATE_HZ:
        problems.append(f"sample rate is {rate:.0f} Hz (expected ~200) — serial too slow or the Arduino is dropping samples")
    if max_gap > MAX_GAP_S:
        problems.append(f"gap of {max_gap * 1000:.0f} ms in the stream — samples were lost")
    if not 0.8 <= gravity <= 1.2:
        problems.append(f"accelerometer averages {gravity:.2f} g (expected ≈1 g) — wrong units/scale or sensor fault")
    for name, col in zip(["ax", "ay", "az", "gx", "gy", "gz"], np.hstack([accel, gyro]).T):
        if float(np.std(col)) < 1e-6:
            problems.append(f"{name} never changes — sensor axis stuck, check wiring")
    return {"n": n, "rate_hz": round(rate, 1), "max_gap_s": round(max_gap, 4), "gravity_g": round(gravity, 3),
            "problems": problems, "ok": not problems}
