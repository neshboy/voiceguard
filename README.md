# VoiceGuard

> **DISCLAIMER (read this first):** VoiceGuard is a **best-effort heuristic
> screening aid** based on acoustic-feature analysis. It is **NOT** a
> certified or forensic deepfake detector, **will make mistakes in both
> directions** (missing real clones, and flagging real humans), and **must
> never be the sole basis** for verifying someone's identity or authorizing a
> real-world action (e.g. wiring money because "they sounded right on the
> phone"). This disclaimer is printed on every single CLI run, not just here.

VoiceGuard is a local, fully-offline command-line tool that runs real digital
signal processing on a WAV file and reports a heuristic
"synthetic-speech-likelihood" score, with a transparent, plain-English
breakdown of exactly which acoustic features contributed and why. It exists
to give a *little* extra signal to someone worried about the classic
cloned-voice vishing scenario ("Grandma, it's me, I need you to wire money
right now") -- as one input among many, never as a verdict.

It is not machine learning. There is no trained model, no dataset, no
claimed accuracy rate. Every number it prints comes from a real WAV parser,
a real FFT, a real pitch tracker, and a real silence detector that you can
read in `src/`.

## What it actually does

Given a WAV file, VoiceGuard:

1. **Parses the real WAV header and PCM sample data** itself, by walking the
   RIFF/`fmt `/`data` chunk structure byte-by-byte (see `src/wav.ts`). No
   audio library involved.
2. **Runs a real FFT** (a from-scratch radix-2 Cooley-Tukey implementation,
   see `src/fft.ts`) over Hann-windowed frames to compute:
   - **Spectral flatness** (geometric mean / arithmetic mean of the
     magnitude spectrum -- a standard DSP metric, sometimes called Wiener
     entropy) and how much it *varies* over time.
   - Spectral centroid and rolloff (computed, currently used for potential
     future extensions; not part of the v1 composite score).
3. **Tracks pitch (F0)** with a real autocorrelation-based estimator over
   framed windows (see `src/pitch.ts`), then computes **jitter** (relative
   frame-to-frame F0 variability) and **shimmer** (relative frame-to-frame
   amplitude variability).
4. **Detects silence/pause segments** via an amplitude (RMS) threshold over
   time (see `src/silence.ts`), then measures how *regular* the pause
   durations and spacing are.
5. **Combines all of the above** into a single 0-100 composite score, where
   each feature contributes a weighted sub-score plus a plain-English
   explanation of what was measured and why it might (heuristically, weakly)
   relate to synthetic speech. If a feature can't be reliably measured (e.g.
   too few detected pauses), it is **excluded from the composite** rather
   than guessed -- you'll see it listed as "insufficient data" instead of a
   silently-wrong number.

## The heuristics, and why they're only heuristics

- **Low jitter / low shimmer.** A real human larynx is never perfectly
  periodic -- pitch and loudness wobble slightly from cycle to cycle. Many
  TTS/vocoder pipelines produce smoother, more regular pitch and amplitude
  contours than natural speech. So VoiceGuard treats *unusually low*
  jitter/shimmer as a (weak) signal of synthetic origin. **But**: a calm,
  monotone speaker, a clean studio recording, or a short clip can also show
  low jitter/shimmer. This is a widely-discussed heuristic in voice-analysis
  literature, not a proven, calibrated detector.
- **Low spectral-texture variability.** Real speech swings between
  harmonic-rich voiced sounds and noisy unvoiced/fricative sounds, so its
  spectral flatness should vary a lot frame-to-frame. A very uniform
  spectral "texture" across a whole clip can indicate over-smoothed
  synthetic audio -- or just a very short/simple recording (e.g. a single
  sustained vowel, or one of this project's own pure-tone test fixtures).
- **Unusually regular pause timing/spacing.** Natural pauses (breathing,
  hesitation, prosody) vary a lot in length and spacing. Some synthetic
  pipelines insert fixed-length silence between segments, producing
  metronomic pause patterns. **But** a fluent speaker reading a script at a
  steady pace produces the same pattern naturally.

Every one of these signals can point the wrong way. That is the entire
reason this tool exists as a *screening aid*, not a detector.

## Install / quick start

Requires Node.js 18+.

```bash
git clone <this-repo>
cd voiceguard
npm install
npm run build
node bin/voiceguard.js analyze path/to/file.wav
```

Or during development, skip the build step with `tsx`:

```bash
npx tsx src/cli.ts analyze path/to/file.wav
```

Add `--json` for machine-readable output:

```bash
node bin/voiceguard.js analyze path/to/file.wav --json
```

Only uncompressed PCM (integer, 8/16/24/32-bit) and IEEE-float WAV files are
supported -- convert MP3/M4A/etc. to WAV first (e.g. with `ffmpeg`).

## Example output

The run below uses a WAV file that VoiceGuard's own test suite synthesizes
from pure math (sine-wave harmonics with randomized micro-jitter in pitch
and amplitude, and randomized pause timing) -- it is **not** a real human
recording. It's shown here purely to demonstrate the CLI's output format.
Because it's still just synthesized tones rather than real speech (no real
fricatives/consonants at all), several features still read as "elevated" --
which is a good illustration of exactly the kind of false positive this tool
is capable of producing, and why the disclaimer exists.

```
======================================================================
VoiceGuard -- heuristic synthetic-speech screening
======================================================================
!! Heuristic screening only. Not forensic-grade. Can be wrong in both directions. Never use this as the sole basis for verifying a caller's identity or approving a payment/transfer.
======================================================================

File:     demo-natural.wav
Audio:    16000 Hz, 1ch, 16-bit, 6.00s

Composite heuristic score: 62.1 / 100  [ELEVATED level of synthetic-speech indicators]
(Higher = more heuristic indicators associated with synthetic/cloned speech. This is NOT a probability and NOT a verdict.)

----------------------------------------------------------------------
Feature breakdown
----------------------------------------------------------------------

- Pitch (F0) jitter
  score: 82.8/100  weight: 30%
  why:   Measures frame-to-frame variation in fundamental frequency (pitch). Real human voices are never perfectly steady in pitch; unusually LOW jitter can indicate an overly smooth, synthetic-sounding pitch contour. This is a heuristic signal, not proof -- a calm, monotone human speaker can also show low jitter.
  data:  jitterPercent=0.85, voicedFrames=432, totalFrames=598

- Amplitude shimmer
  score: 62.1/100  weight: 20%
  why:   Measures frame-to-frame variation in loudness (amplitude). Natural speech has small, irregular amplitude fluctuations from cycle to cycle; unusually LOW shimmer suggests an unnaturally smooth amplitude envelope sometimes seen in synthetic voices. Again heuristic only -- clean studio recordings can also show low shimmer.
  data:  shimmerPercent=3.34, voicedFrames=432, totalFrames=598

- Spectral-texture variability
  score: 0.0/100  weight: 20%
  why:   Measures how much the spectral "shape" (flatness: geometric mean / arithmetic mean of the FFT magnitude spectrum) changes over time. Natural speech swings between harmonic-rich voiced sounds and noise-like unvoiced/fricative sounds, giving high variability. An unusually UNIFORM spectral texture across the whole clip can indicate vocoder-smoothed synthetic audio. Heuristic only -- a short or single-phoneme clip will also look uniform.
  data:  flatnessCV=2.286, meanFlatness=0.021, framesUsed=432, usedVoicedFramesOnly=yes

- Pause-duration regularity
  score: 90.6/100  weight: 15%
  why:   Measures how consistent the LENGTHS of detected silent pauses are. Natural pauses (breaths, hesitation, prosody) vary a lot in duration; unusually UNIFORM pause lengths can indicate synthetic audio built from fixed-length silence padding. Heuristic only -- a fluent, evenly-paced human reader can also produce regular pauses.
  data:  pauseDurationCV=0.221, pauseCount=5

- Pause-spacing regularity
  score: 74.9/100  weight: 15%
  why:   Measures how evenly-SPACED the pauses are in time (metronomic vs. irregular). Unusually regular spacing between pauses is another signal sometimes associated with synthetic pipelines. Heuristic only -- reading from a script at a steady cadence produces the same pattern in genuine human speech.
  data:  pauseIntervalCV=0.339, pauseCount=5

======================================================================
DISCLAIMER
======================================================================
VoiceGuard is a best-effort heuristic screening aid based on acoustic-feature analysis. It is NOT a certified or forensic deepfake detector, will make mistakes in both directions, and must never be the sole basis for verifying someone's identity or authorizing a real-world action.
======================================================================
```

## Running the tests

```bash
npm test
```

The test suite (vitest) synthesizes its own deterministic WAV fixtures from
pure math -- a pure sine tone, white noise, an artificially "perfect" pitch
contour with zero jitter/shimmer, and a randomized-but-seeded "natural
jitter" contour -- and feeds them through the real parsing/FFT/pitch/silence
pipeline. In particular, `test/pitch.test.ts` directly verifies the core
claim this whole tool leans on: **the artificially perfect fixture measures
a lower jitter (and shimmer) than the randomized natural-jitter fixture**,
using VoiceGuard's own pitch-tracking code, not a mocked result.

## Limitations (read this too)

- **Heuristic only, not a trained detector.** There is no machine-learning
  model, no training data, and no measured accuracy/false-positive rate
  against real deepfake audio in v1. The thresholds used to turn raw
  measurements (jitter %, flatness CV, pause CV, ...) into 0-100 sub-scores
  are reasonable engineering choices based on the DSP literature's general
  direction of effect, not scientifically validated cutoffs.
- **Easily defeated by a good clone.** Modern high-quality voice cloning can
  produce pitch/amplitude variation and pause patterns that look perfectly
  natural by these metrics. A sufficiently good clone will simply not be
  flagged.
- **False positives on unusual-but-genuine human voices.** Calm/monotone
  speakers, sedated or fatigued speakers, people with certain voice
  disorders, very clean studio recordings, or very short clips can all
  trigger the "low jitter/shimmer" or "low spectral variability" signals
  despite being completely genuine.
- **Sensitive to recording quality and file characteristics.** Background
  noise, compression artifacts, clipping, low sample rates, and aggressive
  noise reduction can all distort these measurements in either direction.
- **Only handles WAV/PCM.** No MP3, no streaming, no real-time/live-call
  analysis in v1 -- convert to WAV first.
- **No calibration against real deepfake corpora.** The directional claims
  (e.g. "synthetic speech tends to have lower jitter") are drawn from
  published voice-quality/DSP heuristics discussed in the literature, but
  this project has not been benchmarked against a labeled real-vs-cloned
  voice dataset. Treat every score as a rough, fallible prompt to
  investigate further -- via a second communication channel, a callback to a
  known number, a shared passphrase, etc. -- never as confirmation.

## Project structure

```
src/
  wav.ts        real WAV/RIFF parsing + a 16-bit PCM encoder (used by tests)
  fft.ts        real radix-2 Cooley-Tukey FFT + windowing helpers
  spectral.ts   framing + spectral flatness/centroid/rolloff
  pitch.ts      autocorrelation F0 tracking + jitter/shimmer
  silence.ts    amplitude-threshold silence detection + pause-timing stats
  score.ts      composite scoring + per-feature breakdown
  report.ts     text/JSON report formatting
  disclaimer.ts the mandatory disclaimer text
  cli.ts        CLI entry point
  types.ts      shared types
bin/voiceguard.js   CLI launcher (runs the compiled dist/cli.js)
test/               vitest suite + synthesized fixture generators
```

## License

MIT, see [LICENSE](./LICENSE).
