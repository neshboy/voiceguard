import { describe, expect, it } from "vitest";
import { computeJitterShimmer, trackPitch } from "../src/pitch.js";
import { makeNaturalJitterVoiceLike, makePerfectPitchVoiceLike, makeSineWave } from "./fixtures.js";

const SAMPLE_RATE = 16000;
const FRAMING = { frameSizeSamples: 480, hopSizeSamples: 160 }; // 30ms/10ms @16kHz

describe("autocorrelation pitch tracking", () => {
  it("estimates F0 close to the true frequency for a pure tone", () => {
    const freqHz = 150;
    const signal = makeSineWave(freqHz, 1.0, SAMPLE_RATE, 0.7);
    const frames = trackPitch(signal, SAMPLE_RATE, FRAMING);
    const voiced = frames.filter((f) => f.f0Hz !== null);
    expect(voiced.length).toBeGreaterThan(frames.length * 0.8);
    for (const f of voiced) {
      expect(f.f0Hz!).toBeGreaterThan(freqHz * 0.9);
      expect(f.f0Hz!).toBeLessThan(freqHz * 1.1);
    }
  });

  it("returns null (unvoiced) for silence", () => {
    const silence = new Float64Array(SAMPLE_RATE); // 1s of pure zeros
    const frames = trackPitch(silence, SAMPLE_RATE, FRAMING);
    expect(frames.every((f) => f.f0Hz === null)).toBe(true);
  });

  // Regression test: normalizing each lag by the full-frame energy (instead
  // of the energy of the actually-overlapping sub-segment) biased the
  // search toward very short lags and caused complete pitch-lock failure
  // for low F0s well inside the documented/default 60-500 Hz range (e.g. a
  // spurious ~500Hz lock at minLag instead of the true ~60-75Hz).
  it.each([65, 70, 75, 90])(
    "estimates F0 close to the true frequency for a low (%d Hz) pure tone",
    (freqHz) => {
      const signal = makeSineWave(freqHz, 1.0, SAMPLE_RATE, 0.7);
      const frames = trackPitch(signal, SAMPLE_RATE, FRAMING);
      const voiced = frames.filter((f) => f.f0Hz !== null);
      expect(voiced.length).toBeGreaterThan(frames.length * 0.8);
      for (const f of voiced) {
        expect(f.f0Hz!).toBeGreaterThan(freqHz * 0.9);
        expect(f.f0Hz!).toBeLessThan(freqHz * 1.1);
      }
    }
  );

  it("estimates a low F0 correctly at other common sample rates too", () => {
    for (const sampleRate of [44100, 48000]) {
      const freqHz = 70;
      const signal = makeSineWave(freqHz, 1.0, sampleRate, 0.7);
      const framing = {
        frameSizeSamples: Math.round(sampleRate * 0.03),
        hopSizeSamples: Math.round(sampleRate * 0.01),
      };
      const frames = trackPitch(signal, sampleRate, framing);
      const voiced = frames.filter((f) => f.f0Hz !== null);
      expect(voiced.length).toBeGreaterThan(frames.length * 0.8);
      for (const f of voiced) {
        expect(f.f0Hz!).toBeGreaterThan(freqHz * 0.9);
        expect(f.f0Hz!).toBeLessThan(freqHz * 1.1);
      }
    }
  });
});

describe("jitter/shimmer: core heuristic directional check", () => {
  // This is the central claim VoiceGuard relies on: an artificially perfect
  // pitch/amplitude contour (our stand-in for "too smooth" synthetic audio)
  // must score LOWER jitter/shimmer than a fixture with realistic,
  // randomized cycle-to-cycle variation (our stand-in for natural speech).
  const perfect = makePerfectPitchVoiceLike({
    durationSeconds: 3,
    sampleRate: SAMPLE_RATE,
    f0Hz: 150,
    amplitude: 0.5,
  });
  const natural = makeNaturalJitterVoiceLike({
    durationSeconds: 3,
    sampleRate: SAMPLE_RATE,
    f0Hz: 150,
    amplitude: 0.5,
    seed: 42,
  });

  const perfectFrames = trackPitch(perfect, SAMPLE_RATE, FRAMING);
  const naturalFrames = trackPitch(natural, SAMPLE_RATE, FRAMING);
  const perfectJS = computeJitterShimmer(perfectFrames);
  const naturalJS = computeJitterShimmer(naturalFrames);

  it("produces non-null jitter and shimmer for both fixtures", () => {
    expect(perfectJS.jitterPercent).not.toBeNull();
    expect(naturalJS.jitterPercent).not.toBeNull();
    expect(perfectJS.shimmerPercent).not.toBeNull();
    expect(naturalJS.shimmerPercent).not.toBeNull();
  });

  it("gives the artificially-perfect fixture a LOWER jitter than the naturally-varied fixture", () => {
    expect(perfectJS.jitterPercent!).toBeLessThan(naturalJS.jitterPercent!);
  });

  it("gives the artificially-perfect fixture a LOWER shimmer than the naturally-varied fixture", () => {
    expect(perfectJS.shimmerPercent!).toBeLessThan(naturalJS.shimmerPercent!);
  });

  it("keeps the perfect fixture's jitter very close to zero", () => {
    expect(perfectJS.jitterPercent!).toBeLessThan(1);
  });
});

describe("jitter/shimmer: low-F0 (typical adult male range) regression", () => {
  // Before the normalization fix, a low F0 (e.g. 70Hz) drove jitterPercent
  // from ~1% up to ~209% by alternating pitch-lock between the true F0 and
  // a spurious ~500Hz lock at minLag, silently zeroing out the jitter
  // sub-score for lower-pitched speakers.
  const natural = makeNaturalJitterVoiceLike({
    durationSeconds: 3,
    sampleRate: SAMPLE_RATE,
    f0Hz: 70,
    amplitude: 0.5,
    seed: 42,
  });
  const naturalFrames = trackPitch(natural, SAMPLE_RATE, FRAMING);
  const naturalJS = computeJitterShimmer(naturalFrames);

  it("keeps jitterPercent in a realistic range instead of blowing up from spurious pitch-lock", () => {
    expect(naturalJS.jitterPercent).not.toBeNull();
    expect(naturalJS.jitterPercent!).toBeLessThan(20);
  });
});
