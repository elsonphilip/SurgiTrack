# SurgiTrack

Wrist-worn hand-stability trainer for med students / novice surgeons. A BMI270 IMU (via Arduino R4 WiFi)
streams motion to a Raspberry Pi, which scores tremor, smoothness and path deviation and drives haptic
feedback (DRV2605L). A Pi camera + MediaPipe Hands tracks path; the IMU is the primary tremor source
(a 30 fps camera can't resolve 4–12 Hz tremor reliably).

## Status
- [x] Arduino IMU streamer (untested on hardware)
- [x] Recorder, calibration, tremor features (+ tests)
- [ ] Collect real data → train classifier (split by user)
- [ ] Web dashboard, MediaPipe path tracking, haptics

## Quick start
```
cd pi && pip install -r requirements.txt && pytest
python recorder.py --port /dev/ttyACM0 --user u01 --task steady_hold --label steady --seconds 30
```
Not a medical device; any Parkinson's indication is a screening signal, not a diagnosis.
