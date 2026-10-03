"""Sample sources. Each yields (t_s, ax, ay, az, gx, gy, gz) tuples."""
import math
import time

FIELDS = ["t_s", "ax", "ay", "az", "gx", "gy", "gz"]


def serial_source(port, baud=460800):
    """Read the Arduino stream. Skips '#' comment lines and malformed lines."""
    import serial

    t0_us = None
    with serial.Serial(port, baud, timeout=1) as ser:
        while True:
            line = ser.readline().decode("ascii", errors="ignore").strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split(",")
            if len(parts) < 7:  # 7 fields (IMU) or 8 (IMU + HC-SR04 distance); extra fields are ignored here
                continue
            try:
                t_us = int(parts[0])
                vals = [float(p) for p in parts[1:7]]
            except ValueError:
                continue
            if t_us < 0 or (t_us >> 32):  # guard against garbage
                continue
            if t0_us is None:
                t0_us = t_us
            yield ((t_us - t0_us) / 1e6, *vals)


def simulated_source(rate_hz=200, tremor_hz=0.0, tremor_amp_g=0.0, seed=0):
    """FAKE data for testing the pipeline without hardware. Never save into data/raw."""
    import random

    rng = random.Random(seed)
    t = 0.0
    dt = 1.0 / rate_hz
    while True:
        tr = tremor_amp_g * math.sin(2 * math.pi * tremor_hz * t)
        yield (
            t,
            tr + rng.gauss(0, 0.003),
            rng.gauss(0, 0.003),
            1.0 + rng.gauss(0, 0.003),
            rng.gauss(0, 0.2),
            rng.gauss(0, 0.2),
            rng.gauss(0, 0.2),
        )
        t += dt
        time.sleep(dt)
