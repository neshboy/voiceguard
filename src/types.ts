/** Shared types for VoiceGuard's DSP pipeline and scoring. */

/** A parsed, decoded WAV file: PCM samples normalized to [-1, 1] per channel. */
export interface DecodedWav {
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  /** Mono-mixed samples in the range [-1, 1]. */
  samples: Float64Array;
  durationSeconds: number;
}

export interface FrameSpectralFeatures {
  /** Spectral flatness in [0, 1]; geometric mean / arithmetic mean of magnitude spectrum. */
  flatness: number;
  /** Spectral centroid in Hz. */
  centroidHz: number;
  /** Frequency below which 85% of spectral energy is contained, in Hz. */
  rolloffHz: number;
}

export interface PitchFrame {
  /** Frame start time in seconds. */
  timeSeconds: number;
  /** Estimated fundamental frequency in Hz, or null if unvoiced/undetected. */
  f0Hz: number | null;
  /** RMS amplitude of the frame, used for shimmer. */
  rms: number;
}

export interface JitterShimmerResult {
  /** Mean absolute relative frame-to-frame F0 change, as a percentage. */
  jitterPercent: number | null;
  /** Mean absolute relative frame-to-frame amplitude change, as a percentage. */
  shimmerPercent: number | null;
  voicedFrameCount: number;
  totalFrameCount: number;
}

export interface SilenceSegment {
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

export interface PausePatternResult {
  segments: SilenceSegment[];
  /** Coefficient of variation (stddev / mean) of pause durations. Lower = more uniform/robotic. */
  pauseDurationCV: number | null;
  /** Coefficient of variation of gaps between pause onsets. Lower = more metronomic. */
  pauseIntervalCV: number | null;
  pauseCount: number;
}

export interface FeatureScore {
  key: string;
  label: string;
  /** 0-100 contribution score for this feature (higher = more synthetic-like). */
  score: number;
  /** Weight used in the composite (0-1). */
  weight: number;
  /** Plain-English explanation of what was measured and why it matters. */
  explanation: string;
  /** Raw measured value(s) for transparency. */
  details: Record<string, number | string | null>;
}

export interface AnalysisResult {
  filePath: string;
  wavInfo: {
    sampleRate: number;
    numChannels: number;
    bitsPerSample: number;
    durationSeconds: number;
  };
  compositeScore: number;
  features: FeatureScore[];
  disclaimer: string;
}
