"""Compare tremor detectors on held-out PARTICIPANTS and save the LightGBM model.

  python train.py                 # uses real recordings in ../data/raw
  python train.py --out ../models

Models compared (same features, same split):
  1. Threshold baseline   — single feature (accel tremor-band power ratio), threshold tuned on train
  2. Random Forest
  3. LightGBM
Reported on a participant-held-out test set (~20% of people) AND grouped cross-validation:
accuracy, precision, recall, F1, false-positive rate, inference time per window.
Never splits random windows: windows from one person never appear in both train and test.
"""
import argparse
import json
import time
from pathlib import Path

import numpy as np
from lightgbm import LGBMClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline

from dataset import feature_columns, load_windows

MIN_PARTICIPANTS = 5
BASELINE_FEATURE = "acc_tremor_ratio"


class ThresholdBaseline:
    """Predict tremor when one feature exceeds a threshold chosen to maximise train F1."""

    def __init__(self, feature=BASELINE_FEATURE):
        self.feature = feature

    def fit(self, X, y, cols):
        self.i = cols.index(self.feature)
        v = X[:, self.i]
        best = (-1, 0.0)
        for t in np.unique(np.quantile(v, np.linspace(0.02, 0.98, 97))):
            f1 = _prf((v > t).astype(int), y)["f1"]
            if f1 > best[0]:
                best = (f1, t)
        self.t = best[1]
        return self

    def predict(self, X):
        return (X[:, self.i] > self.t).astype(int)


def _prf(pred, y):
    tp = int(((pred == 1) & (y == 1)).sum()); fp = int(((pred == 1) & (y == 0)).sum())
    tn = int(((pred == 0) & (y == 0)).sum()); fn = int(((pred == 0) & (y == 1)).sum())
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    return {
        "accuracy": (tp + tn) / max(1, len(y)),
        "precision": prec,
        "recall": rec,
        "f1": 2 * prec * rec / (prec + rec) if prec + rec else 0.0,
        "false_positive_rate": fp / (fp + tn) if fp + tn else 0.0,
        "tp": tp, "fp": fp, "tn": tn, "fn": fn,
    }


def _make_models(seed):
    return {
        "threshold": None,  # fitted specially
        "random_forest": make_pipeline(
            SimpleImputer(strategy="median"),
            RandomForestClassifier(n_estimators=300, min_samples_leaf=3, class_weight="balanced_subsample", random_state=seed, n_jobs=-1),
        ),
        "lightgbm": LGBMClassifier(
            n_estimators=300, learning_rate=0.05, num_leaves=15, min_child_samples=20, subsample=0.8,
            subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, class_weight="balanced",
            random_state=seed, verbose=-1, n_jobs=1,
        ),
    }


def _fit(name, model, Xtr, ytr, cols):
    return ThresholdBaseline().fit(Xtr, ytr, cols) if name == "threshold" else model.fit(Xtr, ytr)


def _time_per_window(model, X, n=100):
    X = X[:n]
    t0 = time.perf_counter()
    for i in range(len(X)):
        model.predict(X[i : i + 1])
    return 1000 * (time.perf_counter() - t0) / max(1, len(X))


def split_participants(users, df_y_by_user, test_frac=0.2, seed=0):
    """Pick held-out participants so both classes appear in train and test."""
    users = np.array(sorted(users))
    n_test = max(1, int(round(test_frac * len(users))))
    rng = np.random.RandomState(seed)
    for _ in range(500):
        test = set(rng.choice(users, n_test, replace=False))
        train = set(users) - test
        has = lambda us: {c for u in us for c in df_y_by_user[u]}  # noqa: E731
        if has(train) == {0, 1} and has(test) == {0, 1}:
            return sorted(train), sorted(test)
    raise ValueError("Could not find a participant split with both classes in train and test — record more varied data.")


def run(df, out_dir=None, seed=0, test_frac=0.2, refit_all=True):
    cols = feature_columns(df)
    users = df["user"].unique()
    if len(users) < MIN_PARTICIPANTS:
        raise ValueError(f"Need at least {MIN_PARTICIPANTS} participants, have {len(users)}. Results on fewer people aren't trustworthy.")
    if df["y"].nunique() < 2:
        raise ValueError("Need both steady and tremor recordings.")
    X, y, g = df[cols].to_numpy(float), df["y"].to_numpy(int), df["user"].to_numpy()

    by_user = {u: set(df.loc[df["user"] == u, "y"]) for u in users}
    train_u, test_u = split_participants(users, by_user, test_frac, seed)
    tr, te = np.isin(g, train_u), np.isin(g, test_u)

    report = {"n_windows": int(len(df)), "n_participants": int(len(users)), "train_participants": train_u,
              "test_participants": test_u, "features": cols, "holdout": {}, "grouped_cv": {}}

    for name, model in _make_models(seed).items():
        m = _fit(name, model, X[tr], y[tr], cols)
        res = _prf(m.predict(X[te]), y[te])
        res["inference_ms_per_window"] = _time_per_window(m, X[te])
        report["holdout"][name] = res

    # Grouped CV: every participant is test exactly once.
    folds = GroupKFold(n_splits=min(5, len(users)))
    cv = {n: [] for n in _make_models(seed)}
    for a, b in folds.split(X, y, g):
        if len(set(y[a])) < 2 or len(set(y[b])) < 2:
            continue
        for name, model in _make_models(seed).items():
            m = _fit(name, model, X[a], y[a], cols)
            cv[name].append(_prf(m.predict(X[b]), y[b]))
    for name, rs in cv.items():
        if rs:
            report["grouped_cv"][name] = {k: {"mean": float(np.mean([r[k] for r in rs])), "std": float(np.std([r[k] for r in rs]))}
                                          for k in ("accuracy", "precision", "recall", "f1", "false_positive_rate")}
            report["grouped_cv"][name]["folds"] = len(rs)

    if out_dir:
        out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
        final = _make_models(seed)["lightgbm"]
        final.fit(X if refit_all else X[tr], y if refit_all else y[tr])
        final.booster_.save_model(str(out / "lgbm.txt"))
        (out / "feature_names.json").write_text(json.dumps(cols))
        (out / "report.json").write_text(json.dumps(report, indent=2))
    return report


def print_report(r):
    print(f"\n{r['n_windows']} windows from {r['n_participants']} participants "
          f"(held-out test: {len(r['test_participants'])} people)\n")
    print(f"{'HELD-OUT TEST':<16}{'acc':>7}{'prec':>7}{'recall':>8}{'F1':>7}{'FPR':>7}{'ms/win':>9}")
    for n, m in r["holdout"].items():
        print(f"{n:<16}{m['accuracy']:>7.3f}{m['precision']:>7.3f}{m['recall']:>8.3f}{m['f1']:>7.3f}{m['false_positive_rate']:>7.3f}{m['inference_ms_per_window']:>9.3f}")
    print(f"\n{'GROUPED CV (mean ± sd)':<24}{'F1':>16}{'recall':>16}{'FPR':>16}")
    for n, m in r["grouped_cv"].items():
        f = lambda k: f"{m[k]['mean']:.3f} ± {m[k]['std']:.3f}"  # noqa: E731
        print(f"{n:<24}{f('f1'):>16}{f('recall'):>16}{f('false_positive_rate'):>16}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "models"))
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    df, skipped = load_windows()
    if df.empty:
        raise SystemExit(f"No usable real recordings in data/raw (skipped: {skipped}). Record sessions with recorder.py first — "
                         "labels needed: steady, and simulated_tremor and/or clinical_tremor.")
    print_report(run(df, out_dir=a.out, seed=a.seed))
    print(f"\nSaved model + report to {a.out}")
