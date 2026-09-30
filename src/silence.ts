/**
 * Silence/pause detection via a simple amplitude (RMS) threshold over time,
 * plus statistics on how regular or irregular the pause timing is.
 *
 * Natural human speech tends to have irregular pause placement and duration
 * (breathing, word-finding, prosody). Some synthetic/TTS pipelines -- notably
 * ones that concatenate or pad fixed-length silence between utterances --
 * can produce unusually uniform pause durations or spacing. Like the
 * jitter/shimmer heuristic, this is a plausible, heuristic signal only: many
 * genuine human speakers (e.g. reading a script at a steady pace) will also
 * produce fairly regular pauses, so this must not be treated as proof.
 */

import { coefficientOfVariation } from "./stats.js";
import type { PausePatternResult, SilenceSegment } from "./types.js";

export interface SilenceDetectionOptions {
  frameSizeSamples: number;
  hopSizeSamples: number;
  /** RMS below this normalized amplitude counts as silence. */
  silenceRmsThreshold?: number;
  /** Minimum duration (seconds) for a silent run to count as a real pause. */
  minPauseDurationSeconds?: number;
}

function frameRms(frame: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!;
  return Math.sqrt(sum / frame.length);
}

export function detectSilenceSegments(
  samples: Float64Array,
  sampleRate: number,
  opts: SilenceDetectionOptions
): SilenceSegment[] {
  const {
    frameSizeSamples,
    hopSizeSamples,
    silenceRmsThreshold = 0.02,
    minPauseDurationSeconds = 0.15,
  } = opts;

  const segments: SilenceSegment[] = [];
  let runStartSample: number | null = null;
  let lastFrameEndSample = 0;

  for (
    let start = 0;
    start + frameSizeSamples <= samples.length;
    start += hopSizeSamples
  ) {
    const frame = samples.subarray(start, start + frameSizeSamples);
    const isSilent = frameRms(frame) < silenceRmsThreshold;
    lastFrameEndSample = start + frameSizeSamples;

    if (isSilent && runStartSample === null) {
      runStartSample = start;
    } else if (!isSilent && runStartSample !== null) {
      pushSegment(segments, runStartSample, start, sampleRate, minPauseDurationSeconds);
      runStartSample = null;
    }
  }
  if (runStartSample !== null) {
    pushSegment(
      segments,
      runStartSample,
      lastFrameEndSample,
      sampleRate,
      minPauseDurationSeconds
    );
  }

  return segments;
}

function pushSegment(
  segments: SilenceSegment[],
  startSample: number,
  endSample: number,
  sampleRate: number,
  minPauseDurationSeconds: number
): void {
  const startSeconds = startSample / sampleRate;
  const endSeconds = endSample / sampleRate;
  const durationSeconds = endSeconds - startSeconds;
  if (durationSeconds >= minPauseDurationSeconds) {
    segments.push({ startSeconds, endSeconds, durationSeconds });
  }
}

export function analyzePausePattern(
  samples: Float64Array,
  sampleRate: number,
  opts: SilenceDetectionOptions
): PausePatternResult {
  const segments = detectSilenceSegments(samples, sampleRate, opts);
  const durations = segments.map((s) => s.durationSeconds);
  const onsetIntervals: number[] = [];
  for (let i = 1; i < segments.length; i++) {
    onsetIntervals.push(segments[i]!.startSeconds - segments[i - 1]!.startSeconds);
  }

  return {
    segments,
    pauseDurationCV: coefficientOfVariation(durations),
    pauseIntervalCV: coefficientOfVariation(onsetIntervals),
    pauseCount: segments.length,
  };
}
