"""Tremor index, smoothness and spectrum (the design's scoring formulas).

  TRM = 10 · clip( RMS_4-12Hz(a) / (k · σ_base), 0, 1 )        tremor index, 0–10 (higher = more tremor)
  SM  = 100 − α · max(0, ln(DJ) − ln_ref)                      smoothness, 0–100 (DJ = dimensionless jerk)

K, ALPHA and LN_REF are PLACEHOLDERS. Fit them on real recordings (see suggest_k) before trusting the numbers.
"""
import numpy as np
from scipy.signal import butter, sosfiltfilt

BAND = (4.0, 12.0)  # involuntary-tremor band, Hz
K = 10.0            # RMS must reach K × the calibration noise floor to score a full 10/10
ALPHA = 4.0
LN_REF = 8.0
DEFAULT_SIGMA = 0.003  # g, used when no calibration baseline exists
MIN_SAMPLES = 60


def band_rms(accel, fs, band=BAND):
    """RMS (g) of the band-passed acceleration vector. accel: (n, 3)."""
    x = np.asarray(accel, dtype=float)
    if x.ndim != 2 or len(x) < MIN_SAMPLES:
        return 0.0
    hi = min(band[1], 0.95 * fs / 2)
    sos = butter(4, [band[0] / (fs / 2), hi / (fs / 2)], btype="band", output="sos")
    y = sosfiltfilt(sos, x - x.mean(axis=0), axis=0)
    return float(np.sqrt(np.mean((y**2).sum(axis=1))))


def noise_floor(accel_still, fs):
    """σ_base: the same band RMS measured while the user holds still during calibration."""
    return max(band_rms(accel_still, fs), 1e-5)


def tremor_index(accel, fs, sigma_base=DEFAULT_SIGMA, k=K):
    ratio = band_rms(accel, fs) / (k * max(sigma_base, 1e-5))
    return 10.0 * float(np.clip(ratio, 0.0, 1.0))


def suggest_k(band_rms_worst, sigma_base):
    """Pick K so the 95th-percentile 'worst tremor' recording maps to 10/10.
    band_rms_worst: band RMS values (g) from your most shaky recordings."""
    return float(np.percentile(np.asarray(band_rms_worst, dtype=float), 95) / max(sigma_base, 1e-5))


def log_dimensionless_jerk(speed, fs):
    """ln of dimensionless jerk of a speed profile (higher = jerkier). NaN if undefined."""
    v = np.asarray(speed, dtype=float)
    if len(v) < 8 or v.max() <= 1e-9:
        return float("nan")
    dt = 1.0 / fs
    jerk = np.gradient(np.gradient(v, dt), dt)
    duration = len(v) * dt
    dj = np.trapezoid(jerk**2, dx=dt) * duration**3 / (v.max() ** 2)
    return float(np.log(max(dj, 1e-12)))


def smoothness(speed, fs, alpha=ALPHA, ln_ref=LN_REF):
    ldlj = log_dimensionless_jerk(speed, fs)
    if np.isnan(ldlj):
        return 0.0
    return float(np.clip(100.0 - alpha * max(0.0, ldlj - ln_ref), 0.0, 100.0))


def spectrum14(accel, fs, ref_g=0.05):
    """14 bars (1–14 Hz) of 0–100 for the dot-matrix display; ~floor of 6 like the UI."""
    x = np.asarray(accel, dtype=float)
    if len(x) < 32:
        return [6.0] * 14
    x = x - x.mean(axis=0)
    mag = np.abs(np.fft.rfft(x * np.hanning(len(x))[:, None], axis=0)).sum(axis=1) * 2 / len(x)
    freqs = np.fft.rfftfreq(len(x), 1 / fs)
    out = []
    for f in range(1, 15):
        m = (freqs >= f - 0.5) & (freqs < f + 0.5)
        out.append(float(np.clip(6 + 94 * (mag[m].max() if m.any() else 0.0) / ref_g, 6, 100)))
    return out
