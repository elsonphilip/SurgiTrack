import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import collect  # noqa: E402
import inventory  # noqa: E402
from quality import check_recording  # noqa: E402
from sources import simulated_source  # noqa: E402


def write_csv(path, n=1000, rate=200.0, tweak=None, seed=0):
    rng = np.random.default_rng(seed)
    t = np.arange(n) / rate
    df = pd.DataFrame({"t_s": t, "ax": rng.normal(0, .01, n), "ay": rng.normal(0, .01, n), "az": 1 + rng.normal(0, .01, n),
                       "gx": rng.normal(0, .3, n), "gy": rng.normal(0, .3, n), "gz": rng.normal(0, .3, n)})
    if tweak:
        df = tweak(df)
    df.to_csv(path, index=False)
    return path


def test_quality_ok(tmp_path):
    q = check_recording(write_csv(tmp_path / "a.csv"))
    assert q["ok"] and abs(q["rate_hz"] - 200) < 2 and abs(q["gravity_g"] - 1) < 0.05


def test_quality_catches_problems(tmp_path):
    slow = check_recording(write_csv(tmp_path / "s.csv", rate=60))
    assert not slow["ok"] and any("sample rate" in p for p in slow["problems"])
    gap = check_recording(write_csv(tmp_path / "g.csv", tweak=lambda d: d.drop(range(400, 450)).reset_index(drop=True)))
    assert any("gap" in p for p in gap["problems"])
    units = check_recording(write_csv(tmp_path / "u.csv", tweak=lambda d: d.assign(az=d.az * 9.81)))
    assert any("≈1 g" in p for p in units["problems"])
    stuck = check_recording(write_csv(tmp_path / "k.csv", tweak=lambda d: d.assign(gz=0.0)))
    assert any("gz never changes" in p for p in stuck["problems"])
    assert not check_recording(write_csv(tmp_path / "e.csv", n=10))["ok"]


def test_protocol_dry_run_saves_labelled_recordings(tmp_path):
    saved = collect.run_protocol(simulated_source(realtime=False), "synthetic", tmp_path, "p01", seconds=3, repeats=2,
                                 input_fn=lambda *_: "", say=lambda *_: None)
    assert len(saved) == 4
    metas = [json.loads(p.with_suffix(".json").read_text()) for p in saved]
    assert sorted(m["label"] for m in metas) == ["simulated_tremor"] * 2 + ["steady"] * 2
    assert all(m["user"] == "p01" and m["source"] == "synthetic" for m in metas)


def test_bad_recording_is_deleted_and_not_kept(tmp_path):
    prompts = []

    def answer(prompt):
        prompts.append(prompt)
        return "n" if "Try again" in prompt else ""   # decline every retry

    slow = simulated_source(rate_hz=40, realtime=False)  # 40 Hz: fails the sample-rate check
    saved = collect.run_protocol(slow, "synthetic", tmp_path, "p01", seconds=3, repeats=1, input_fn=answer, say=lambda *_: None)
    assert saved == []
    assert list(tmp_path.glob("*")) == []                      # the bad CSV + JSON were removed
    assert any("Try again" in p for p in prompts)


def test_inventory_and_readiness(tmp_path):
    def meta(user, label, source="device", seconds=30):
        (tmp_path / f"{user}_{label}.json").write_text(json.dumps({"user": user, "label": label, "source": source, "seconds": seconds}))
    for u in ["a", "b", "c", "d"]:
        meta(u, "steady"); meta(u, "simulated_tremor")
    meta("e", "steady")                  # participant with only one class
    meta("z", "steady", source="synthetic")
    meta("a", "fatigued")
    inv, skipped = inventory.inventory(tmp_path)
    assert set(inv) == {"a", "b", "c", "d", "e"} and skipped == {"synthetic": 1, "other_label": 1}
    assert inv["a"]["steady"] == [1, 29]
    todo = inventory.readiness(inv)
    assert len(todo) == 1 and "missing a class" in todo[0] and "e" in todo[0]
    meta("e", "simulated_tremor")
    assert inventory.readiness(inventory.inventory(tmp_path)[0]) == []
