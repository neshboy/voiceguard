/**
 * Real autocorrelation-based F0 (pitch) tracking, plus jitter/shimmer
 * statistics derived from the frame-to-frame F0 and amplitude track.
 *
 * Autocorrelation pitch detection: for a windowed frame, compute the
 * signal's autocorrelation at lags corresponding to plausible human pitch
 * periods (default ~60-500 Hz), pick the lag with the strongest normalized
 * autocorrelation peak (the periodicity that best "explains" the frame), and
 * convert that lag to a frequency. This is a well-known, legitimately
 * implementable-from-scratch pitch estimator (closely related to the
 * classic autocorrelation method / RAPT-style approaches), not a novel or
 * exotic algorithm.
 *
 * Jitter (cycle-to-cycle F0 variability) and shimmer (cycle-to-cycle
 * amplitude variability) are standard voice-quality measures used in
 * clinical voice analysis. The heuristic used here -- that unnaturally LOW
 * jitter/shimmer can indicate synthetic speech -- reflects the fact that
 * many TTS/vocoder pipelines produce pitch and amplitude contours that are
 * smoother/more regular than a real human larynx, which is never perfectly
 * periodic. This is a published, plausible signal, not a proven detector,
 * and is treated as such throughout VoiceGuard.
 */

import type { JitterShimmerResult, PitchFrame } from "./types.js";

export interface PitchTrackingOptions {
  frameSizeSamples: number;
  hopSizeSamples: number;
  minHz?: number;
  maxHz?: number;
  /** Normalized autocorrelation peak must exceed this to count as voiced. */
  voicingThreshold?: number;
  /** RMS below this (in [0,1] normalized amplitude) is treated as silence/unvoiced. */
  silenceRms?: number;
}

function rms(frame: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!;
  return Math.sqrt(sum / frame.length);
}

/**
 * Estimate F0 for a single frame via normalized autocorrelation. Returns
 * null if the frame is too quiet or not sufficiently periodic to be
 * confidently voiced.
 */
export function estimateFrameF0(
  frame: Float64Array,
  sampleRate: number,
  minHz = 60,
  maxHz = 500,
  voicingThreshold = 0.3,
  silenceRms = 0.01
): number | null {
  const n = frame.length;

  // Remove DC offset.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += frame[i]!;
  mean /= n;
  const centered = new Float64Array(n);
  for (let i = 0; i < n; i++) centered[i] = frame[i]! - mean;

  if (rms(centered) < silenceRms) {
    return null;
  }

  const minLag = Math.max(1, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(n - 1, Math.ceil(sampleRate / minHz));
  if (minLag >= maxLag) return null;

  // r0: zero-lag autocorrelation (signal energy), used for normalization.
  let r0 = 0;
  for (let i = 0; i < n; i++) r0 += centered[i]! * centered[i]!;
  if (r0 <= 0) return null;

  let bestLag = -1;
  let bestValue = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) {
      sum += centered[i]! * centered[i + lag]!;
    }
    const normalized = sum / r0;
    if (normalized > bestValue) {
      bestValue = normalized;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || bestValue < voicingThreshold) {
    return null;
  }

  // Parabolic interpolation around the best lag for sub-sample precision.
  const lagFor = (lag: number): number => {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += centered[i]! * centered[i + lag]!;
    return sum / r0;
  };
  const yPrev = bestLag > minLag ? lagFor(bestLag - 1) : bestValue;
  const yCurr = bestValue;
  const yNext = bestLag < maxLag ? lagFor(bestLag + 1) : bestValue;
  const denom = yPrev - 2 * yCurr + yNext;
  const shift = denom !== 0 ? (0.5 * (yPrev - yNext)) / denom : 0;
  const refinedLag = bestLag + Math.max(-1, Math.min(1, shift));

  return sampleRate / refinedLag;
}

/** Track F0 and RMS across framed windows of the whole signal. */
export function trackPitch(
  samples: Float64Array,
  sampleRate: number,
  opts: PitchTrackingOptions
): PitchFrame[] {
  const {
    frameSizeSamples,
    hopSizeSamples,
    minHz = 60,
    maxHz = 500,
    voicingThreshold = 0.3,
    silenceRms = 0.01,
  } = opts;

  const frames: PitchFrame[] = [];
  for (
    let start = 0;
    start + frameSizeSamples <= samples.length;
    start += hopSizeSamples
  ) {
    const frame = samples.subarray(start, start + frameSizeSamples);
    const f0 = estimateFrameF0(
      frame,
      sampleRate,
      minHz,
      maxHz,
      voicingThreshold,
      silenceRms
    );
    frames.push({
      timeSeconds: start / sampleRate,
      f0Hz: f0,
      rms: rms(frame),
    });
  }
  return frames;
}

/**
 * Compute jitter (relative F0 variability) and shimmer (relative amplitude
 * variability) across consecutive voiced frames.
 */
export function computeJitterShimmer(frames: PitchFrame[]): JitterShimmerResult {
  const jitterTerms: number[] = [];
  const shimmerTerms: number[] = [];
  let voicedCount = 0;

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1]!;
    const curr = frames[i]!;
    if (curr.f0Hz !== null) voicedCount++;

    if (prev.f0Hz !== null && curr.f0Hz !== null && prev.f0Hz > 0) {
      jitterTerms.push(Math.abs(curr.f0Hz - prev.f0Hz) / prev.f0Hz);
    }
    if (prev.f0Hz !== null && curr.f0Hz !== null && prev.rms > 1e-9) {
      shimmerTerms.push(Math.abs(curr.rms - prev.rms) / prev.rms);
    }
  }
  if (frames.length > 0 && frames[0]!.f0Hz !== null) voicedCount++;

  const jitterPercent =
    jitterTerms.length > 0
      ? (jitterTerms.reduce((a, b) => a + b, 0) / jitterTerms.length) * 100
      : null;
  const shimmerPercent =
    shimmerTerms.length > 0
      ? (shimmerTerms.reduce((a, b) => a + b, 0) / shimmerTerms.length) * 100
      : null;

  return {
    jitterPercent,
    shimmerPercent,
    voicedFrameCount: voicedCount,
    totalFrameCount: frames.length,
  };
}
