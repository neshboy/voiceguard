/**
 * Frame-based spectral feature extraction: spectral flatness, centroid, and
 * rolloff, computed from the real FFT magnitude spectrum of each frame.
 */

import { hannWindow, magnitudeSpectrum } from "./fft.js";
import type { FrameSpectralFeatures } from "./types.js";

export interface FramingOptions {
  frameSizeSamples: number;
  hopSizeSamples: number;
}

export function frameSignal(
  samples: Float64Array,
  opts: FramingOptions
): Float64Array[] {
  const { frameSizeSamples, hopSizeSamples } = opts;
  const frames: Float64Array[] = [];
  for (
    let start = 0;
    start + frameSizeSamples <= samples.length;
    start += hopSizeSamples
  ) {
    frames.push(samples.subarray(start, start + frameSizeSamples));
  }
  return frames;
}

/**
 * Spectral flatness: geometric mean of the magnitude spectrum divided by its
 * arithmetic mean. Close to 1 => flat/noise-like spectrum; close to 0 =>
 * peaky/tonal spectrum. This is a standard DSP metric (Wiener entropy).
 */
export function spectralFlatness(magnitudes: Float64Array): number {
  const eps = 1e-12;
  let logSum = 0;
  let sum = 0;
  let count = 0;
  // Skip DC bin (index 0), which carries no tonal information here.
  for (let i = 1; i < magnitudes.length; i++) {
    const m = magnitudes[i]! + eps;
    logSum += Math.log(m);
    sum += m;
    count++;
  }
  if (count === 0 || sum === 0) return 0;
  const geometricMean = Math.exp(logSum / count);
  const arithmeticMean = sum / count;
  return geometricMean / arithmeticMean;
}

/** Spectral centroid in Hz: the amplitude-weighted mean frequency. */
export function spectralCentroid(
  magnitudes: Float64Array,
  sampleRate: number,
  fftSize: number
): number {
  let weightedSum = 0;
  let magSum = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    const freq = (i * sampleRate) / fftSize;
    weightedSum += freq * magnitudes[i]!;
    magSum += magnitudes[i]!;
  }
  return magSum > 0 ? weightedSum / magSum : 0;
}

/** Frequency below which `fraction` of total spectral energy is contained. */
export function spectralRolloff(
  magnitudes: Float64Array,
  sampleRate: number,
  fftSize: number,
  fraction = 0.85
): number {
  let totalEnergy = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    totalEnergy += magnitudes[i]! * magnitudes[i]!;
  }
  if (totalEnergy === 0) return 0;
  const threshold = totalEnergy * fraction;
  let cumulative = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    cumulative += magnitudes[i]! * magnitudes[i]!;
    if (cumulative >= threshold) {
      return (i * sampleRate) / fftSize;
    }
  }
  return (sampleRate / 2);
}

/**
 * Compute per-frame spectral features across the whole signal, using a Hann
 * window before each FFT to reduce spectral leakage.
 */
export function analyzeSpectralFrames(
  samples: Float64Array,
  sampleRate: number,
  opts: FramingOptions
): FrameSpectralFeatures[] {
  const frames = frameSignal(samples, opts);
  const window = hannWindow(opts.frameSizeSamples);
  const results: FrameSpectralFeatures[] = [];

  for (const frame of frames) {
    const windowed = new Float64Array(frame.length);
    for (let i = 0; i < frame.length; i++) {
      windowed[i] = frame[i]! * window[i]!;
    }
    const mags = magnitudeSpectrum(windowed);
    const fftSize = (mags.length - 1) * 2;
    results.push({
      flatness: spectralFlatness(mags),
      centroidHz: spectralCentroid(mags, sampleRate, fftSize),
      rolloffHz: spectralRolloff(mags, sampleRate, fftSize),
    });
  }

  return results;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
