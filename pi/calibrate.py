"""5-second still calibration: records baseline orientation (mean accel) and noise floor."""
import json
import sys
import time

import numpy as np

from features import baseline_noise


def run_calibration(source, fs, seconds=5.0, settle=1.0):
    samples = []
    start = None
    for t, ax, ay, az, *_ in source:
        if start is None:
            start = t
        if t - start < settle:  # discard the first moment while the hand settles
            continue
        samples.append((ax, ay, az))
        if t - start >= settle + seconds:
            break
    arr = np.array(samples)
    gravity = arr.mean(axis=0)
    return {
        "baseline_accel": gravity.tolist(),
        "baseline_noise": baseline_noise(arr, fs),
        "n_samples": len(arr),
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }


if __name__ == "__main__":
    from sources import serial_source

    port, out = sys.argv[1], sys.argv[2]
    print("Hold your hand still in a neutral position...")
    cal = run_calibration(serial_source(port), fs=200)
    json.dump(cal, open(out, "w"), indent=2)
    print("Saved", out)
