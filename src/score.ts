/**
 * Composite scoring: combines the individual DSP heuristics into a single
 * 0-100 "synthetic-speech-likelihood" score with a transparent per-feature
 * breakdown. Every sub-score is a heuristic proxy, not a ground-truth
 * measurement -- see DISCLAIMER in disclaimer.ts, printed alongside every
 * result.
 */

import { analyzeSpectralFrames } from "./spectral.js";
import { computeJitterShimmer, trackPitch } from "./pitch.js";
import { analyzePausePattern } from "./silence.js";
import { coefficientOfVariation, mean } from "./stats.js";
import type { AnalysisResult, DecodedWav, FeatureScore } from "./types.js";
import { DISCLAIMER } from "./disclaimer.js";

/** Linear inverse-threshold mapping: value <= lowAnchor => 100 (max suspicion),
 * value >= highAnchor => 0 (no suspicion from this feature), linear between.
 * Used for metrics where a LOW value is the synthetic-like signal
 * (jitter, shimmer, pause-timing regularity, spectral-flatness variability).
 */
function inverseThresholdScore(
  value: number,
  lowAnchor: number,
  highAnchor: number
): number {
  if (value <= lowAnchor) return 100;
  if (value >= highAnchor) return 0;
  const t = (value - lowAnchor) / (highAnchor - lowAnchor);
  return 100 * (1 - t);
}

export interface ScoringOptions {
  frameMs?: number;
  hopMs?: number;
}

export function analyzeDecodedWav(
  filePath: string,
  wav: DecodedWav,
  opts: ScoringOptions = {}
): AnalysisResult {
  const frameMs = opts.frameMs ?? 30;
  const hopMs = opts.hopMs ?? 10;
  const frameSizeSamples = Math.max(
    64,
    Math.round((frameMs / 1000) * wav.sampleRate)
  );
  const hopSizeSamples = Math.max(
    32,
    Math.round((hopMs / 1000) * wav.sampleRate)
  );
  const framing = { frameSizeSamples, hopSizeSamples };

  const spectralFrames = analyzeSpectralFrames(wav.samples, wav.sampleRate, framing);
  const pitchFrames = trackPitch(wav.samples, wav.sampleRate, framing);
  const jitterShimmer = computeJitterShimmer(pitchFrames);
  const pausePattern = analyzePausePattern(wav.samples, wav.sampleRate, framing);

  // Spectral-flatness variability: prefer voiced frames (aligned 1:1 with
  // pitchFrames since both use identical frame/hop sizes and loop bounds);
  // fall back to all frames if too few voiced frames were detected.
  const voicedFlatness: number[] = [];
  for (let i = 0; i < spectralFrames.length && i < pitchFrames.length; i++) {
    if (pitchFrames[i]!.f0Hz !== null) {
      voicedFlatness.push(spectralFrames[i]!.flatness);
    }
  }
  const usedVoicedOnly = voicedFlatness.length >= 5;
  const flatnessValues = usedVoicedOnly
    ? voicedFlatness
    : spectralFrames.map((f) => f.flatness);
  const flatnessCV = coefficientOfVariation(flatnessValues);
  const flatnessMean = mean(flatnessValues);

  const features: FeatureScore[] = [];

  // --- Jitter ---------------------------------------------------------
  if (jitterShimmer.jitterPercent !== null) {
    features.push({
      key: "jitter",
      label: "Pitch (F0) jitter",
      score: inverseThresholdScore(jitterShimmer.jitterPercent, 0.3, 3.5),
      weight: 0.3,
      explanation:
        "Measures frame-to-frame variation in fundamental frequency (pitch). " +
        "Real human voices are never perfectly steady in pitch; unusually LOW " +
        "jitter can indicate an overly smooth, synthetic-sounding pitch contour. " +
        "This is a heuristic signal, not proof -- a calm, monotone human speaker " +
        "can also show low jitter.",
      details: {
        jitterPercent: round2(jitterShimmer.jitterPercent),
        voicedFrames: jitterShimmer.voicedFrameCount,
        totalFrames: jitterShimmer.totalFrameCount,
      },
    });
  } else {
    features.push(insufficientDataFeature(
      "jitter",
      "Pitch (F0) jitter",
      0.3,
      "Not enough voiced frames were detected to estimate pitch jitter (the audio may be too short, too quiet, or unvoiced)."
    ));
  }

  // --- Shimmer ----------------------------------------------------------
  if (jitterShimmer.shimmerPercent !== null) {
    features.push({
      key: "shimmer",
      label: "Amplitude shimmer",
      score: inverseThresholdScore(jitterShimmer.shimmerPercent, 0.5, 8),
      weight: 0.2,
      explanation:
        "Measures frame-to-frame variation in loudness (amplitude). Natural " +
        "speech has small, irregular amplitude fluctuations from cycle to " +
        "cycle; unusually LOW shimmer suggests an unnaturally smooth amplitude " +
        "envelope sometimes seen in synthetic voices. Again heuristic only -- " +
        "clean studio recordings can also show low shimmer.",
      details: {
        shimmerPercent: round2(jitterShimmer.shimmerPercent),
        voicedFrames: jitterShimmer.voicedFrameCount,
        totalFrames: jitterShimmer.totalFrameCount,
      },
    });
  } else {
    features.push(insufficientDataFeature(
      "shimmer",
      "Amplitude shimmer",
      0.2,
      "Not enough voiced frames were detected to estimate amplitude shimmer."
    ));
  }

  // --- Spectral flatness variability ------------------------------------
  if (flatnessCV !== null) {
    features.push({
      key: "spectralFlatnessVariability",
      label: "Spectral-texture variability",
      score: inverseThresholdScore(flatnessCV, 0.05, 0.4),
      weight: 0.2,
      explanation:
        "Measures how much the spectral \"shape\" (flatness: geometric mean / " +
        "arithmetic mean of the FFT magnitude spectrum) changes over time. " +
        "Natural speech swings between harmonic-rich voiced sounds and " +
        "noise-like unvoiced/fricative sounds, giving high variability. An " +
        "unusually UNIFORM spectral texture across the whole clip can indicate " +
        "vocoder-smoothed synthetic audio. Heuristic only -- a short or " +
        "single-phoneme clip will also look uniform.",
      details: {
        flatnessCV: round3(flatnessCV),
        meanFlatness: round3(flatnessMean),
        framesUsed: flatnessValues.length,
        usedVoicedFramesOnly: usedVoicedOnly ? "yes" : "no (fallback: all frames)",
      },
    });
  } else {
    features.push(insufficientDataFeature(
      "spectralFlatnessVariability",
      "Spectral-texture variability",
      0.2,
      "Not enough frames were available to measure spectral-texture variability."
    ));
  }

  // --- Pause duration regularity -----------------------------------------
  if (pausePattern.pauseDurationCV !== null) {
    features.push({
      key: "pauseDurationRegularity",
      label: "Pause-duration regularity",
      score: inverseThresholdScore(pausePattern.pauseDurationCV, 0.15, 0.9),
      weight: 0.15,
      explanation:
        "Measures how consistent the LENGTHS of detected silent pauses are. " +
        "Natural pauses (breaths, hesitation, prosody) vary a lot in duration; " +
        "unusually UNIFORM pause lengths can indicate synthetic audio built " +
        "from fixed-length silence padding. Heuristic only -- a fluent, " +
        "evenly-paced human reader can also produce regular pauses.",
      details: {
        pauseDurationCV: round3(pausePattern.pauseDurationCV),
        pauseCount: pausePattern.pauseCount,
      },
    });
  } else {
    features.push(insufficientDataFeature(
      "pauseDurationRegularity",
      "Pause-duration regularity",
      0.15,
      `Not enough distinct silent pauses were detected (found ${pausePattern.pauseCount}) to judge regularity.`
    ));
  }

  // --- Pause interval regularity -----------------------------------------
  if (pausePattern.pauseIntervalCV !== null) {
    features.push({
      key: "pauseIntervalRegularity",
      label: "Pause-spacing regularity",
      score: inverseThresholdScore(pausePattern.pauseIntervalCV, 0.15, 0.9),
      weight: 0.15,
      explanation:
        "Measures how evenly-SPACED the pauses are in time (metronomic vs. " +
        "irregular). Unusually regular spacing between pauses is another " +
        "signal sometimes associated with synthetic pipelines. Heuristic " +
        "only -- reading from a script at a steady cadence produces the same " +
        "pattern in genuine human speech.",
      details: {
        pauseIntervalCV: round3(pausePattern.pauseIntervalCV),
        pauseCount: pausePattern.pauseCount,
      },
    });
  } else {
    features.push(insufficientDataFeature(
      "pauseIntervalRegularity",
      "Pause-spacing regularity",
      0.15,
      `Not enough distinct silent pauses were detected (found ${pausePattern.pauseCount}) to judge spacing regularity.`
    ));
  }

  const compositeScore = computeWeightedComposite(features);

  return {
    filePath,
    wavInfo: {
      sampleRate: wav.sampleRate,
      numChannels: wav.numChannels,
      bitsPerSample: wav.bitsPerSample,
      durationSeconds: wav.durationSeconds,
    },
    compositeScore,
    features,
    disclaimer: DISCLAIMER,
  };
}

function insufficientDataFeature(
  key: string,
  label: string,
  weight: number,
  reason: string
): FeatureScore {
  return {
    key,
    label,
    score: 0,
    weight: 0, // excluded from composite; renormalized among remaining features
    explanation: `${reason} This feature was excluded from the composite score rather than guessed.`,
    details: { insufficientData: "true", nominalWeight: weight },
  };
}

/** Weighted average over features with weight > 0, renormalized so that
 * features with insufficient data don't silently drag the score toward
 * either extreme. */
function computeWeightedComposite(features: FeatureScore[]): number {
  const usable = features.filter((f) => f.weight > 0);
  const totalWeight = usable.reduce((acc, f) => acc + f.weight, 0);
  if (totalWeight <= 0) return 0;
  const weighted = usable.reduce((acc, f) => acc + f.score * f.weight, 0);
  return Math.round((weighted / totalWeight) * 10) / 10;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
