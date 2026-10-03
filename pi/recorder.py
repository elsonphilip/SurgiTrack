"""Record a labeled session to data/raw/ as CSV + JSON metadata.

  python recorder.py --port /dev/ttyACM0 --user u01 --task steady_hold --label steady --seconds 30
  python recorder.py --simulate --out /tmp/test   # fake data; refuses to write into data/raw
"""
import argparse
import csv
import json
import time
from pathlib import Path

from sources import FIELDS, serial_source, simulated_source

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"


def record(source, seconds, path):
    n = 0
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(FIELDS)
        start = None
        for row in source:
            if start is None:
                start = row[0]
            w.writerow(row)
            n += 1
            if row[0] - start >= seconds:
                break
    return n


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port")
    p.add_argument("--simulate", action="store_true")
    p.add_argument("--user", default="u00")
    p.add_argument("--task", default="steady_hold")
    p.add_argument("--label", default="unlabeled",
                   help="steady | fatigued | caffeine | simulated_tremor | clinical_tremor | ...")
    p.add_argument("--seconds", type=float, default=30)
    p.add_argument("--out", help="output dir (required with --simulate)")
    a = p.parse_args()

    if a.simulate:
        if not a.out or Path(a.out).resolve() == RAW_DIR:
            p.error("--simulate needs --out pointing somewhere other than data/raw")
        out_dir, source, src_kind = Path(a.out), simulated_source(), "synthetic"
    else:
        if not a.port:
            p.error("--port required (or use --simulate)")
        out_dir, source, src_kind = RAW_DIR, serial_source(a.port), "device"

    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    stem = f"{a.user}_{a.task}_{a.label}_{stamp}"
    n = record(source, a.seconds, out_dir / f"{stem}.csv")
    meta = {"user": a.user, "task": a.task, "label": a.label, "source": src_kind,
            "seconds": a.seconds, "n_samples": n, "nominal_rate_hz": 200,
            "sensor": "BMI270", "units": {"accel": "g", "gyro": "deg/s"}, "recorded": stamp}
    (out_dir / f"{stem}.json").write_text(json.dumps(meta, indent=2))
    print(f"Wrote {n} samples to {out_dir / (stem + '.csv')}")


if __name__ == "__main__":
    main()
