# Training the tremor model (laptop + Arduino, no Pi)

Everything in `pi/` is plain Python and runs on any laptop; the folder name is historical. You only need the wristband
(Arduino + BMI270) plugged in over USB. No camera is needed to train.

## 1. One-time setup
```
python3 -m venv .venv && source .venv/bin/activate
pip install -r pi/requirements.txt
```
Flash `firmware/surgitrack_imu/surgitrack_imu.ino` with the Arduino IDE (libraries: *SparkFun BMI270 Arduino Library*;
*Adafruit DRV2605 Library* if the haptic driver is wired — see `docs/HARDWARE.md`). The sketch has never been compiled, so
expect to fix small things.

## 2. Check the hardware
```
python3 pi/collect.py --list-ports                       # Mac: look for /dev/cu.usbmodem…
python3 pi/collect.py --port /dev/cu.usbmodem1101 --check
```
You want `✓ stream looks healthy` (≈200 Hz, no gaps, gravity ≈ 1 g). If it complains, fix that first — bad recordings poison training.

## 3. Record participants (about 4 minutes each)
```
python3 pi/collect.py --port /dev/cu.usbmodem1101 --user p01
```
The tool walks the participant through **3 × 30 s `steady`** and **3 × 30 s `simulated_tremor`** recordings, checks each one, and
re-records bad ones. Use anonymous ids (`p01`, `p02`, …) and get consent first. Do this for **at least 5 different people**
(8–15 is much better): the model is always tested on people it never saw, so more people matters more than more minutes.
Tips: same wristband position every time; forearm supported; let participants vary hand (dominant/non-dominant) and shake
strength between recordings.

## 4. Are we ready?
```
python3 pi/inventory.py
```
Shows recordings and windows per person and class, and exactly what's still missing (e.g. "need 2 more participants").

## 5. Train
```
python3 pi/train.py
```
Compares a **threshold baseline**, **Random Forest** and **LightGBM** on held-out *participants* (plus grouped cross-validation):
accuracy, precision, recall, F1, false-positive rate, ms per window. It saves `models/lgbm.txt` and `models/report.json`;
the website's Scoring page then shows the real held-out F1 instead of "pending dataset".
If LightGBM doesn't clearly beat the baseline, say so — that's a legitimate result.

## 6. Use it
`python3 pi/server.py --serial /dev/cu.usbmodem1101` (add `--camera 0` for a camera) loads `models/lgbm.txt`
automatically and adds a tremor-screening signal to each session; the result card shows it.

## What the numbers do and don't mean
- `simulated_tremor` is a person *deliberately shaking*, so the model learns "shaky vs steady hand" — useful for the trainer,
  but **not** a Parkinson's detector. Real pathological tremor data needs clinical participants and ethics approval.
  Keep the "screening signal, not a diagnosis" wording everywhere.
- With few participants the scores will be noisy. Report the grouped-CV mean ± sd, not just the single best split.
- Never train on the simulator / `--simulate` output: the tools refuse to (they only use `source: "device"` recordings).
