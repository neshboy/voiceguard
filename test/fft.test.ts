import { describe, expect, it } from "vitest";
import { fft, magnitudeSpectrum, nextPowerOfTwo } from "../src/fft.js";
import { makeSineWave } from "./fixtures.js";

describe("real radix-2 Cooley-Tukey FFT", () => {
  it("computes the correct spectrum for a known impulse (DC-only check)", () => {
    const n = 8;
    const real = new Float64Array(n);
    const imag = new Float64Array(n);
    real[0] = 1; // unit impulse
    fft(real, imag);
    // FFT of a unit impulse is a constant 1 across all bins.
    for (let i = 0; i < n; i++) {
      expect(real[i]).toBeCloseTo(1, 6);
      expect(imag[i]).toBeCloseTo(0, 6);
    }
  });

  it("throws on non-power-of-two length", () => {
    const real = new Float64Array(6);
    const imag = new Float64Array(6);
    expect(() => fft(real, imag)).toThrow();
  });

  it("nextPowerOfTwo rounds up correctly", () => {
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(2)).toBe(2);
    expect(nextPowerOfTwo(5)).toBe(8);
    expect(nextPowerOfTwo(1024)).toBe(1024);
    expect(nextPowerOfTwo(1025)).toBe(2048);
  });

  it("identifies the correct dominant frequency bin for a pure tone", () => {
    const sampleRate = 8000;
    const freqHz = 1000; // exact bin frequency for N=... chosen below
    const durationSeconds = 0.064; // 512 samples at 8000 Hz
    const signal = makeSineWave(freqHz, durationSeconds, sampleRate, 1.0);

    const mags = magnitudeSpectrum(signal);
    const fftSize = (mags.length - 1) * 2;
    expect(fftSize).toBe(nextPowerOfTwo(signal.length));

    let peakBin = 0;
    let peakVal = -Infinity;
    // Skip DC bin.
    for (let i = 1; i < mags.length; i++) {
      if (mags[i]! > peakVal) {
        peakVal = mags[i]!;
        peakBin = i;
      }
    }
    const peakFreq = (peakBin * sampleRate) / fftSize;
    // Bin resolution is sampleRate/fftSize; the peak should land within one
    // bin of the true tone frequency.
    const binWidth = sampleRate / fftSize;
    expect(Math.abs(peakFreq - freqHz)).toBeLessThanOrEqual(binWidth);
  });

  it("finds distinct peaks for two different pure tones at different bins", () => {
    const sampleRate = 16000;
    const durationSeconds = 0.128; // 2048 samples
    const lowTone = makeSineWave(500, durationSeconds, sampleRate, 1.0);
    const highTone = makeSineWave(4000, durationSeconds, sampleRate, 1.0);

    const lowMags = magnitudeSpectrum(lowTone);
    const highMags = magnitudeSpectrum(highTone);
    const fftSize = (lowMags.length - 1) * 2;

    const dominantBin = (mags: Float64Array): number => {
      let peakBin = 0;
      let peakVal = -Infinity;
      for (let i = 1; i < mags.length; i++) {
        if (mags[i]! > peakVal) {
          peakVal = mags[i]!;
          peakBin = i;
        }
      }
      return peakBin;
    };

    const lowBin = dominantBin(lowMags);
    const highBin = dominantBin(highMags);
    const lowFreq = (lowBin * sampleRate) / fftSize;
    const highFreq = (highBin * sampleRate) / fftSize;

    expect(lowFreq).toBeLessThan(highFreq);
    expect(Math.abs(lowFreq - 500)).toBeLessThan(100);
    expect(Math.abs(highFreq - 4000)).toBeLessThan(100);
  });
});
