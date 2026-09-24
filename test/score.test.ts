import { describe, expect, it } from "vitest";
import { decodeWav, encodeWavMono16 } from "../src/wav.js";
import { analyzeDecodedWav } from "../src/score.js";
import { DISCLAIMER } from "../src/disclaimer.js";
import { makeNaturalJitterVoiceLike, makePerfectPitchVoiceLike } from "./fixtures.js";

const SAMPLE_RATE = 16000;

function analyzeSamples(samples: Float64Array, sampleRate: number) {
  const wavBuffer = encodeWavMono16(samples, sampleRate);
  const decoded = decodeWav(wavBuffer);
  return analyzeDecodedWav("fixture.wav", decoded, {});
}

describe("composite scoring (full pipeline via real WAV encode/decode)", () => {
  it("always includes the exact mandatory disclaimer text", () => {
    const samples = makePerfectPitchVoiceLike({ durationSeconds: 2, sampleRate: SAMPLE_RATE });
    const result = analyzeSamples(samples, SAMPLE_RATE);
    expect(result.disclaimer).toBe(DISCLAIMER);
    expect(result.disclaimer).toMatch(/NOT a certified or forensic deepfake detector/);
    expect(result.disclaimer).toMatch(/never be the sole basis/);
  });

  it("produces a higher composite score for the artificially-perfect fixture than the natural fixture", () => {
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
      seed: 99,
    });

    const perfectResult = analyzeSamples(perfect, SAMPLE_RATE);
    const naturalResult = analyzeSamples(natural, SAMPLE_RATE);

    expect(perfectResult.compositeScore).toBeGreaterThan(naturalResult.compositeScore);
    // Sanity bounds: score is a 0-100 heuristic value.
    expect(perfectResult.compositeScore).toBeGreaterThanOrEqual(0);
    expect(perfectResult.compositeScore).toBeLessThanOrEqual(100);
  });

  it("every feature carries a plain-English explanation string", () => {
    const samples = makeNaturalJitterVoiceLike({ durationSeconds: 2, sampleRate: SAMPLE_RATE, seed: 3 });
    const result = analyzeSamples(samples, SAMPLE_RATE);
    expect(result.features.length).toBeGreaterThan(0);
    for (const f of result.features) {
      expect(f.explanation.length).toBeGreaterThan(20);
      expect(f.label.length).toBeGreaterThan(0);
    }
  });

  it("reports accurate WAV metadata alongside the score", () => {
    const samples = makePerfectPitchVoiceLike({ durationSeconds: 1.5, sampleRate: SAMPLE_RATE });
    const result = analyzeSamples(samples, SAMPLE_RATE);
    expect(result.wavInfo.sampleRate).toBe(SAMPLE_RATE);
    expect(result.wavInfo.numChannels).toBe(1);
    expect(result.wavInfo.bitsPerSample).toBe(16);
    expect(result.wavInfo.durationSeconds).toBeCloseTo(1.5, 1);
  });
});
