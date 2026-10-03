# SurgiTrack

Wrist-worn hand-stability trainer for med students / novice surgeons. A BMI270 IMU (via Arduino R4 WiFi)
streams motion to a Raspberry Pi, which scores tremor, smoothness and path deviation and drives haptic
feedback (DRV2605L). A Pi camera + MediaPipe Hands tracks path; the IMU is the primary tremor source
(a 30 fps camera can't resolve 4–12 Hz tremor reliably).

## Status
- [x] Arduino IMU streamer (untested on hardware)
- [x] Recorder, calibration, tremor features (+ tests)
- [x] Web app (`web/`): profiles, sessions, leaderboard, 5 progress charts, session API
- [ ] Collect real data → train classifier (split by user)
- [ ] MediaPipe path tracking, haptics, Pi → site uploader

## Quick start
```
cd pi && pip install -r requirements.txt && pytest
python recorder.py --port /dev/ttyACM0 --user u01 --task steady_hold --label steady --seconds 30
```
Not a medical device; any Parkinson's indication is a screening signal, not a diagnosis.

## Website (`web/`)
Next.js, custom SVG/canvas charts, JSON-file storage in `web/data/` (gitignored). UI follows the design handoff
(5 screens: Live Session, Progress, Sessions, Leaderboard, Scoring).
```
cd web && npm install && npm run dev
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
