"""Run the trained LightGBM tremor model on a live 2 s IMU window."""
from __future__ import annotations
import json
from pathlib import Path

import lightgbm as lgb
import numpy as np

from windows import FS_DEFAULT, window_features

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"


class TremorModel:
    def __init__(self, model_dir=MODEL_DIR):
        d = Path(model_dir)
        self.booster = lgb.Booster(model_file=str(d / "lgbm.txt"))
        self.cols = json.loads((d / "feature_names.json").read_text())

    def predict_proba(self, imu, fs=FS_DEFAULT, **kw):
        """imu: (n, 6) ax ay az gx gy gz over ~2 s. Returns P(tremor)."""
        f = window_features(imu, fs, **kw)
        x = np.array([[f.get(c, np.nan) for c in self.cols]], dtype=float)
        return float(self.booster.predict(x)[0])
