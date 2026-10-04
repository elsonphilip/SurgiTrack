"""Optional LightGBM tremor screening during sessions. Returns None until a model has been trained (train.py)."""
from __future__ import annotations
from pathlib import Path

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"


def load_screener(model_dir=MODEL_DIR):
    if not (Path(model_dir) / "lgbm.txt").exists():
        return None
    from infer import TremorModel

    model = TremorModel(model_dir)
    return lambda imu_window, fs: model.predict_proba(imu_window, fs)
