"""Pipeline sanity tests on GENERATED signals. This proves the code runs and splits correctly;
it is not training data and says nothing about real-world accuracy."""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import dataset  # noqa: E402
import train  # noqa: E402
from infer import TremorModel  # noqa: E402
from windows import window_features  # noqa: E402

FS = 100.0


def fake_window(rng, tremor, user_noise):
    t = np.arange(int(2 * FS)) / FS
    imu = rng.normal(0, user_noise, (len(t), 6))
    imu[:, 2] += 1.0
    if tremor:
        imu[:, 0] += 0.05 * np.sin(2 * np.pi * rng.uniform(4.5, 9) * t)
        imu[:, 3] += 4 * np.sin(2 * np.pi * 6 * t)
    return imu


def fake_df(n_users=8, per_user=12, seed=0):
    rng = np.random.default_rng(seed)
    rows = []
    for u in range(n_users):
        noise = rng.uniform(0.002, 0.006)
        for i in range(per_user):
            y = i % 2
            rows.append({**window_features(fake_window(rng, y, noise), FS), "y": y, "user": f"u{u}", "session": f"s{u}", "start_s": i})
    return pd.DataFrame(rows)


def test_features_expected_columns():
    f = window_features(fake_window(np.random.default_rng(0), 1, 0.003), FS)
    for k in ["acc_mag_rms", "gyr_mag_std", "jerk_rms", "acc_dom_freq", "acc_hf_energy", "ang_vel_mean", "path_dev_mean"]:
        assert k in f
    assert np.isnan(f["path_dev_mean"])  # no camera data supplied


def test_dominant_freq_tracks_tremor():
    rng = np.random.default_rng(1)
    t = np.arange(int(2 * FS)) / FS
    imu = rng.normal(0, 0.002, (len(t), 6)); imu[:, 2] += 1
    imu[:, 0] += 0.1 * np.sin(2 * np.pi * 7 * t)
    assert abs(window_features(imu, FS)["acc_dom_freq"] - 7) < 1.5


def test_camera_features():
    rng = np.random.default_rng(2)
    imu = fake_window(rng, 0, 0.003)
    cam = np.cumsum(rng.normal(0, 0.1, (len(imu), 2)), axis=0)
    f = window_features(imu, FS, cam=cam, dev_mm=np.abs(rng.normal(1, .5, len(imu))), tol_mm=1.0)
    assert f["hand_vel_mean"] > 0 and 0 <= f["time_outside_frac"] <= 1


def test_run_reports_and_participant_split(tmp_path):
    df = fake_df()
    rep = train.run(df, out_dir=tmp_path)
    assert set(rep["train_participants"]).isdisjoint(rep["test_participants"])
    for m in rep["holdout"].values():
        for k in ("accuracy", "precision", "recall", "f1", "false_positive_rate"):
            assert 0 <= m[k] <= 1
        assert m["inference_ms_per_window"] > 0
    assert set(rep["holdout"]) == {"threshold", "random_forest", "lightgbm"}
    assert rep["grouped_cv"]["lightgbm"]["folds"] >= 2
    # saved model round-trips and scores a window
    p = TremorModel(tmp_path).predict_proba(fake_window(np.random.default_rng(5), 1, 0.003), FS)
    assert 0 <= p <= 1


def test_too_few_participants_refused():
    with pytest.raises(ValueError, match="at least"):
        train.run(fake_df(n_users=3))


def test_dataset_refuses_synthetic(tmp_path):
    (tmp_path / "a.json").write_text(json.dumps({"user": "u1", "label": "steady", "source": "synthetic"}))
    (tmp_path / "a.csv").write_text("t_s,ax,ay,az,gx,gy,gz\n")
    df, skipped = dataset.load_windows(tmp_path)
    assert df.empty and skipped["synthetic"] == 1
