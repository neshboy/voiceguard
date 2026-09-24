import { describe, expect, it } from "vitest";
import { analyzePausePattern, detectSilenceSegments } from "../src/silence.js";
import { makeNaturalJitterVoiceLike, makePerfectPitchVoiceLike, makeSineWave } from "./fixtures.js";

const SAMPLE_RATE = 16000;
const FRAMING = { frameSizeSamples: 480, hopSizeSamples: 160 };

describe("silence/pause detection", () => {
  it("detects a single known silence gap at the expected position", () => {
    const sampleRate = 8000;
    const tone1 = makeSineWave(200, 0.5, sampleRate, 0.6);
    const gap = new Float64Array(Math.round(0.3 * sampleRate)); // zeros
    const tone2 = makeSineWave(200, 0.5, sampleRate, 0.6);
    const signal = new Float64Array(tone1.length + gap.length + tone2.length);
    signal.set(tone1, 0);
    signal.set(gap, tone1.length);
    signal.set(tone2, tone1.length + gap.length);

    const segments = detectSilenceSegments(signal, sampleRate, {
      frameSizeSamples: 240,
      hopSizeSamples: 80,
    });

    expect(segments.length).toBe(1);
    const seg = segments[0]!;
    expect(seg.startSeconds).toBeGreaterThan(0.4);
    expect(seg.startSeconds).toBeLessThan(0.6);
    expect(seg.durationSeconds).toBeGreaterThan(0.15);
  });

  it("finds pause timing far more regular in the perfect fixture than the natural fixture", () => {
    const perfect = makePerfectPitchVoiceLike({
      durationSeconds: 4,
      sampleRate: SAMPLE_RATE,
      f0Hz: 150,
      voicedSeconds: 0.4,
      silenceSeconds: 0.2,
    });
    const natural = makeNaturalJitterVoiceLike({
      durationSeconds: 4,
      sampleRate: SAMPLE_RATE,
      f0Hz: 150,
      seed: 7,
    });

    const perfectPattern = analyzePausePattern(perfect, SAMPLE_RATE, FRAMING);
    const naturalPattern = analyzePausePattern(natural, SAMPLE_RATE, FRAMING);

    expect(perfectPattern.pauseCount).toBeGreaterThan(1);
    expect(naturalPattern.pauseCount).toBeGreaterThan(1);
    expect(perfectPattern.pauseDurationCV).not.toBeNull();
    expect(naturalPattern.pauseDurationCV).not.toBeNull();

    // The perfect fixture's pauses are identical by construction -> near-zero CV.
    expect(perfectPattern.pauseDurationCV!).toBeLessThan(0.05);
    // The natural fixture's pauses vary in duration -> materially higher CV.
    expect(naturalPattern.pauseDurationCV!).toBeGreaterThan(perfectPattern.pauseDurationCV!);
  });
});
