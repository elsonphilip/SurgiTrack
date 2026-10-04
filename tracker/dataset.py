"""Build a labeled window dataset from data/raw/*.csv (+ .json metadata written by recorder.py).

Only REAL device recordings are used (meta "source" == "device"). Synthetic/simulated data is refused.
Labels → binary target. Edit POSITIVE/NEGATIVE to change what counts as "tremor"; any other label
(e.g. fatigued, caffeine) is skipped unless you add it to one of the sets.
"""
from __future__ import annotations
import json
from pathlib import Path

import pandas as pd

from windows import FS_DEFAULT, segment

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"
POSITIVE = {"simulated_tremor", "clinical_tremor"}
NEGATIVE = {"steady"}


def load_windows(raw_dir=RAW_DIR, fs=FS_DEFAULT):
    rows, skipped = [], {"synthetic": 0, "unlabeled_or_other": 0}
    for meta_path in sorted(Path(raw_dir).glob("*.json")):
        meta = json.loads(meta_path.read_text())
        if meta.get("source") != "device":
            skipped["synthetic"] += 1
            continue
        label = meta.get("label")
        if label not in POSITIVE | NEGATIVE:
            skipped["unlabeled_or_other"] += 1
            continue
        csv = meta_path.with_suffix(".csv")
        if not csv.exists():
            continue
        df = pd.read_csv(csv)
        for start, feats in segment(df, fs=meta.get("nominal_rate_hz", fs)):
            rows.append({**feats, "y": int(label in POSITIVE), "user": meta["user"],
                         "session": meta_path.stem, "start_s": start})
    return pd.DataFrame(rows), skipped


def feature_columns(df):
    return [c for c in df.columns if c not in {"y", "user", "session", "start_s"}]
