# Training the tremor model (laptop + Arduino)

**Windows users: jump to [Windows steps](#windows-steps).** The rest of this page uses Mac/Linux commands.

Everything in `tracker/` is plain Python and runs on any laptop. You only need the wristband
(Arduino + BMI270) plugged in over USB. No camera is needed to train.

## 1. One-time setup
```
python3 -m venv .venv && source .venv/bin/activate
pip install -r tracker/requirements.txt
```
Flash `firmware/surgitrack_imu/surgitrack_imu.ino` with the Arduino IDE (libraries: *SparkFun BMI270 Arduino Library*;
*Adafruit DRV2605 Library* if the haptic driver is wired — see `docs/HARDWARE.md`). The sketch has never been compiled, so
expect to fix small things.

## 2. Check the hardware
```
python3 tracker/collect.py --list-ports                       # Mac: look for /dev/cu.usbmodem…
python3 tracker/collect.py --port /dev/cu.usbmodem1101 --check
```
You want `✓ stream looks healthy` (≈200 Hz, no gaps, gravity ≈ 1 g). If it complains, fix that first — bad recordings poison training.

### Using the trainer sketch (`firmware/surgitrack_trainer`)
The repo includes the standalone **Surgical Tremor Trainer** sketch (BMI270 + DRV2605L, LED bar). Set `FOR_PI = true` (already
the default in the repo copy) and it streams `millis,ax,ay,az,gx,gy,gz` at 115200 baud. Tell the tools about it:
```
python tracker/collect.py --port /dev/cu.usbmodem1101 --check --baud 115200 --time-unit ms
```
Any sketch that prints `time,ax,ay,az,gx,gy,gz` works: use `--time-unit us` for `micros()` and `--baud` for its speed.
Prefer `micros()` and 460800 baud when you can: millisecond timestamps are coarse at 200 Hz, and 115200 baud leaves little
headroom for 200 lines per second.

### Running the website with the trainer sketch (no camera)
```
python tracker/server.py --serial /dev/cu.usbmodem1101 --device trainer
```
Then open the site → Live → it connects on its own (chip says **TRACKER · LIVE**). With no camera the session is a
**steady hold**: the band measures your tremor, buzzes when it goes over the limit for your level (`B`; the sketch's
double click `D` is the "perfect section" pulse in Game mode), and the site scores accuracy (time under the limit),
tremor, steadiness and the usual overall score. Try it without the band: `python tracker/server.py --simulate --task hold --skill 0.85`.

## 3. Record participants (about 4 minutes each)
```
python3 tracker/collect.py --port /dev/cu.usbmodem1101 --user p01
```
The tool walks the participant through **3 × 30 s `steady`** and **3 × 30 s `simulated_tremor`** recordings, checks each one, and
re-records bad ones. Use anonymous ids (`p01`, `p02`, …) and get consent first. Do this for **at least 5 different people**
(8–15 is much better): the model is always tested on people it never saw, so more people matters more than more minutes.
Tips: same wristband position every time; forearm supported; let participants vary hand (dominant/non-dominant) and shake
strength between recordings.

## 4. Are we ready?
```
python3 tracker/inventory.py
```
Shows recordings and windows per person and class, and exactly what's still missing (e.g. "need 2 more participants").

## 5. Train
```
python3 tracker/train.py
```
Compares a **threshold baseline**, **Random Forest** and **LightGBM** on held-out *participants* (plus grouped cross-validation):
accuracy, precision, recall, F1, false-positive rate, ms per window. It saves `models/lgbm.txt` and `models/report.json`;
the website's Scoring page then shows the real held-out F1 instead of "pending dataset".
If LightGBM doesn't clearly beat the baseline, say so — that's a legitimate result.

## 6. Use it
`python3 tracker/server.py --serial /dev/cu.usbmodem1101` (add `--camera 0` for a camera) loads `models/lgbm.txt`
automatically and adds a tremor-screening signal to each session; the result card shows it.

## What the numbers do and don't mean
- `simulated_tremor` is a person *deliberately shaking*, so the model learns "shaky vs steady hand" — useful for the trainer,
  but **not** a Parkinson's detector. Real pathological tremor data needs clinical participants and ethics approval.
  Keep the "screening signal, not a diagnosis" wording everywhere.
- With few participants the scores will be noisy. Report the grouped-CV mean ± sd, not just the single best split.
- Never train on the simulator / `--simulate` output: the tools refuse to (they only use `source: "device"` recordings).

---

## Windows steps
Same workflow; only the commands and port names differ. Open **PowerShell** in the `SurgiTrack` folder
(File Explorer → open the folder → type `powershell` in the address bar → Enter).

**0. Install the basics (once)**
- **Python 3.11+** from python.org — tick **"Add python.exe to PATH"** in the installer.
- **Git** and the **Arduino IDE 2**.
- Check: `python --version` (if that fails, try `py --version` and use `py` wherever these steps say `python`).

**1. Get the code and set up Python (once)**
```
git pull
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r tracker\requirements.txt
```
- If PowerShell says *"running scripts is disabled"*: run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, answer **Y**, then retry.
  (Using Command Prompt instead of PowerShell? Activate with `.venv\Scripts\activate.bat`.)
- Re-run `.venv\Scripts\Activate.ps1` in every new terminal. You'll see `(.venv)` at the start of the prompt.

**2. Flash the wristband (once)**
In the Arduino IDE install the **SparkFun BMI270 Arduino Library** (and **Adafruit DRV2605 Library** if the haptic driver is wired),
open `firmware\surgitrack_imu\surgitrack_imu.ino`, choose **Arduino UNO R4 WiFi**, upload, then **close the Serial Monitor**
(it blocks the port). The sketch has never been compiled — expect small fixes. If Windows doesn't recognise the board, unplug,
try another USB cable (some are charge-only) and another port.

**3. Find the COM port and check the hardware**
```
python tracker\collect.py --list-ports
python tracker\collect.py --port COM5 --check
```
Use the port that mentions Arduino (`COM3`, `COM5`, …; you can also see it in Device Manager → *Ports (COM & LPT)*).
You want `✓ stream looks healthy` (≈200 Hz, gravity ≈ 1 g). If it can't open the port, close the Arduino Serial Monitor and anything else using it.

**4. Record people (about 4 minutes each, ≥ 5 people)**
```
python tracker\collect.py --port COM5 --user p01
```
It prompts the participant through 3 steady and 3 deliberate-shake recordings (30 s each) and redoes bad ones. Use a new anonymous id
per person (`p02`, `p03`, …) and get consent first. Keep the wristband in the same position every time.

**5. Check you have enough data**
```
python tracker\inventory.py
```
Repeat step 4 until it says **✓ Ready**.

**6. Train**
```
python tracker\train.py
```
Prints the comparison table (baseline vs Random Forest vs LightGBM, on people the model hasn't seen) and saves `models\lgbm.txt` and
`models\report.json`.

**7. See it in the app (optional)** — needs Node.js from nodejs.org:
```
npm run dev
```
then open http://localhost:3000 → Detailed view → Scoring: the real held-out F1 replaces "pending dataset".

**Windows troubleshooting**
| Problem | Fix |
|---|---|
| `python` not recognised | Reinstall Python with *Add to PATH*, or use `py` instead of `python` |
| `pip install` fails building a package | Make sure Python is 3.11–3.13 (64-bit); upgrade pip: `python -m pip install --upgrade pip` |
| `PermissionError` / "access denied" opening COM port | Close the Arduino Serial Monitor and other serial programs, replug the board |
| `could not open port 'COM5'` | Wrong number — re-run `--list-ports`; `COM10` and above work too |
| Camera not found (webcam mode) | Settings → Privacy & security → Camera → allow desktop apps |
| Odd characters instead of ✓ / ✗ | Harmless (the tools force UTF-8); Windows Terminal shows them best |

