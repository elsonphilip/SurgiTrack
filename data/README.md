# data/

`raw/` holds **real device recordings only** (`"source": "device"` in the JSON).
Synthetic/simulated data must never be written here (`recorder.py` refuses).

Each session = `<user>_<task>_<label>_<timestamp>.csv` + `.json` metadata.
CSV columns: `t_s, ax, ay, az, gx, gy, gz` (accel in g, gyro in deg/s, ~200 Hz).

Suggested labels: `steady`, `fatigued`, `caffeine`, `simulated_tremor`, `clinical_tremor`.
When training, split train/test **by user**, not by random window.
