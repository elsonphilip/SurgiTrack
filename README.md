# SurgiTrack

Wrist-worn hand-stability trainer for med students / novice surgeons. A BMI270 IMU (via Arduino R4 WiFi)
streams motion to a Raspberry Pi, which scores tremor, smoothness and path deviation and drives haptic
feedback (DRV2605L). A Pi camera + MediaPipe Hands tracks path; the IMU is the primary tremor source
(a 30 fps camera can't resolve 4–12 Hz tremor reliably).

## Status
- [x] Arduino IMU streamer (untested on hardware)
- [x] Recorder, calibration, tremor features (+ tests)
- [x] Web app (`web/`): profiles, sessions, leaderboard, 5 progress charts, session API
- [x] ML pipeline (`pi/train.py`): window features → threshold baseline vs Random Forest vs LightGBM, evaluated on held-out participants
- [ ] Collect real recordings, then run `python train.py`
- [x] Pi session engine, simulated rig, WebSocket live feed, uploader, tremor/smoothness formulas (tested; simulated)
- [x] MediaPipe fingertip tracking (verified on photos; live camera untested) · haptic/HC-SR04 firmware (**untested on hardware**)
- [ ] Hardware bring-up, real recordings, fit tremor constants, train model

## Quick start
```
cd pi && pip install -r requirements.txt && pytest
python recorder.py --port /dev/ttyACM0 --user u01 --task steady_hold --label steady --seconds 30
```
Not a medical device; any Parkinson's indication is a screening signal, not a diagnosis.

## Tremor model (`pi/`)
```
BMI270/camera → raw time series → high-pass filter + 2 s windows → features → LightGBM → tremor probability
```
Features (`windows.py`): accel/gyro mean·std·RMS, angular velocity, jerk, dominant frequency, 4–6 / 6–12 Hz and
high-frequency (12–30 Hz) energy, tremor-band ratio, spectral entropy; plus hand velocity, smoothness (LDLJ), path
deviation and time outside tolerance when camera/path columns are present.

`python train.py` compares a **threshold baseline**, **Random Forest** and **LightGBM** on the same features, reporting
accuracy, precision, recall, F1, false-positive rate and inference time per window on **held-out participants**
(plus grouped cross-validation). It refuses to run on synthetic data or with fewer than 5 participants, and saves
`models/lgbm.txt` for `infer.py`. Tests (`pytest`) use generated signals only to check the code, never to train.
Labels: `steady` = 0; `simulated_tremor` / `clinical_tremor` = 1; other labels are skipped.

## Look & feel
Palette (`web/src/app/globals.css`): page `#0f1015`, panels `#21211f`, pale-teal text `#a6cac8`, muted-green accent `#3d8571`,
logo blue `#5aa4d6` for secondary data, amber `#e3a857` for warnings. First open per browser session shows a ~3.6 s splash
(logo, wordmark, one quote from `web/src/lib/quotes.ts`); click or Esc skips it.

## Two views
The site opens in the **Simple** view, built for students: Practice / My Progress / History / Leaderboard, a three-step
guide, one big Start button, plain-language feedback ("Hand tremor: Mild"), a coaching tip after each run, and unlock
goals — no raw sensor panels. The **Detailed** toggle (top right, remembered in a cookie) is the full engineering dashboard
from the design handoff (live IMU/spectrum/LCD, Sessions database with CSV, Scoring model, hardware status).

## Running it all (local)
```
npm run dev            # website → http://localhost:3000   (installs web/ dependencies on first run)
npm run pi:sim         # Pi runner with a SIMULATED person (no hardware) → ws://localhost:8765
npm run pi:test        # Python tests (pi/): engine, tremor, paths, ML pipeline, end-to-end WebSocket
```
Then in the website: **Live Session → Settings → Data source = Raspberry Pi**. Sessions from the simulated runner are
stored as DEMO data. With real hardware: `python3 pi/server.py --serial /dev/ttyACM0 --camera 0` — see
[`docs/HARDWARE.md`](docs/HARDWARE.md) for the bring-up checklist and [`docs/PROTOCOL.md`](docs/PROTOCOL.md) for every interface.

First time on the Pi side: `pip install -r pi/requirements.txt`; for the camera also `sudo apt install libegl1 libgles2` and
`pip install -r pi/requirements-camera.txt` (MediaPipe hand tracking), then check it with `python3 pi/camera_check.py --camera 0`.

## Target paths
27 paths across the 5 levels live in `web/src/lib/paths.ts` (straight/diagonal strokes, arcs and S-curves, a fusiform
excision, zigzag/sawtooth/square-wave/suture weaves, spirals, figure-eight, clover, square spiral, circles, ellipse,
triangle, pentagram, trefoil knot). The first path of each level is the original design path. Pick one (or shuffle)
from Settings on Live Session; each session records its `pathId`.
```
cd web && npm run check:paths     # validates every path (in bounds, continuous, sane length)
npm run export:paths              # writes data/paths.json (mm) for the Pi
```
The Pi uses `pi/paths.py` (`deviation_mm`, `accuracy_pct`) against the same shapes, so site and Pi score identically.

## Website (`web/`)
Next.js, custom SVG/canvas charts, JSON-file storage in `web/data/` (gitignored). UI follows the design handoff
(5 screens: Live Session, Progress, Sessions, Leaderboard, Scoring).
```
npm run dev          # from the repo root — installs web/ dependencies automatically on first run
npm run seed:demo    # optional demo profiles/sessions (flagged synthetic, shown with a DEMO badge)
npm run seed:clear   # remove all synthetic data; real data is untouched
```

**Real vs. simulated data.** The Live Session sensor feed is currently *simulated in the browser* (no hardware connected).
Sessions it records are stored as `source: "synthetic"` and never count toward a real profile's best score, level or the
leaderboard. Only sessions posted by the Pi count.

**Pi → site:** `POST /api/sessions`
```
{ userId, level, metrics:{accuracy, avgDeviationMm, tremor (0-10), smoothness, completionTimeS, hapticPulses},
  baseline?:{pitch, roll, noiseSigma}, date?, raw?:[{t,ax,ay,az,gx,gy,gz,camX?,camY?,distCm?}] }
```
Set `SURGITRACK_API_KEY` to require `Authorization: Bearer <key>`. The overall score is computed server-side
(`web/src/lib/scoring.ts`). Raw data downloads as CSV from the Sessions screen.

**Definitions (placeholders to retune with real data):** accuracy = % of samples within the level's tolerance τ
(3 / 2.5 / 2 / 1.5 / 1 mm for L1–L5); `SCORE = .40·ACC + .25·SM + .20·(100 − 10·TRM) + .15·TIME`;
unlock the next level with 3 sessions ≥ 75 / 78 / 80 / 85 on L1 / L2 / L3 / L4.

**To go live:** replace the simulator in `web/src/components/LiveSession.tsx` with a Pi WebSocket feed and save with
`source: "device"` via the API.
