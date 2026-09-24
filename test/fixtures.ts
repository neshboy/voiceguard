/**
 * Deterministic synthetic-audio fixtures for tests, generated from pure
 * math (no recorded audio, no network, no external files checked into the
 * repo). Everything here writes real PCM sample data that then goes through
 * the same real WAV encode/decode + DSP pipeline as any real-world file.
 *
 * "Randomized" fixtures use a seeded PRNG (mulberry32), not Math.random(),
 * so test runs are fully reproducible.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A pure sine tone at `freqHz`, useful for verifying FFT bin identification. */
export function makeSineWave(
  freqHz: number,
  durationSeconds: number,
  sampleRate: number,
  amplitude = 0.6
): Float64Array {
  const n = Math.round(durationSeconds * sampleRate);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return out;
}

/** Seeded white noise, useful as a high-spectral-flatness reference signal. */
export function makeWhiteNoise(
  durationSeconds: number,
  sampleRate: number,
  amplitude = 0.3,
  seed = 12345
): Float64Array {
  const n = Math.round(durationSeconds * sampleRate);
  const rand = mulberry32(seed);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amplitude * (rand() * 2 - 1);
  }
  return out;
}

export interface VoiceLikeOptions {
  durationSeconds: number;
  sampleRate: number;
  f0Hz?: number;
  amplitude?: number;
  /** Seconds of "voiced speech" followed by seconds of silence, repeating. */
  voicedSeconds?: number;
  silenceSeconds?: number;
}

/**
 * A harmonic (fundamental + 2 overtones), amplitude-enveloped, voiced/silence
 * -alternating signal with a PERFECTLY constant pitch period and amplitude
 * within each voiced block, and perfectly regular pause timing. This stands
 * in for "too smooth/regular" synthetic-like audio: zero jitter, zero
 * shimmer, zero pause-timing variability, by construction.
 */
export function makePerfectPitchVoiceLike(opts: VoiceLikeOptions): Float64Array {
  const {
    durationSeconds,
    sampleRate,
    f0Hz = 150,
    amplitude = 0.5,
    voicedSeconds = 0.4,
    silenceSeconds = 0.2,
  } = opts;
  const n = Math.round(durationSeconds * sampleRate);
  const out = new Float64Array(n);
  const cycleSamples = Math.round((voicedSeconds + silenceSeconds) * sampleRate);
  const voicedSamples = Math.round(voicedSeconds * sampleRate);

  let phase = 0;
  const dPhase = (2 * Math.PI * f0Hz) / sampleRate;
  for (let i = 0; i < n; i++) {
    const posInCycle = i % cycleSamples;
    if (posInCycle < voicedSamples) {
      out[i] =
        amplitude *
        (0.7 * Math.sin(phase) + 0.2 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase));
      phase += dPhase;
    } else {
      out[i] = 0;
      phase = 0; // reset phase at each silence boundary; perfectly regular restart
    }
  }
  return out;
}

/**
 * Same harmonic voice-like structure as makePerfectPitchVoiceLike, but with
 * small, deterministic (seeded) pseudo-random cycle-to-cycle perturbations
 * in instantaneous F0 and amplitude (to create natural-style jitter and
 * shimmer), and irregular, pseudo-randomly varying pause durations/spacing.
 */
export function makeNaturalJitterVoiceLike(
  opts: VoiceLikeOptions & { seed?: number; jitterFrac?: number; shimmerFrac?: number }
): Float64Array {
  const {
    durationSeconds,
    sampleRate,
    f0Hz = 150,
    amplitude = 0.5,
    seed = 42,
    jitterFrac = 0.04, // up to +/-4% F0 change per pitch period
    shimmerFrac = 0.08, // up to +/-8% amplitude change per pitch period
  } = opts;
  const rand = mulberry32(seed);
  const n = Math.round(durationSeconds * sampleRate);
  const out = new Float64Array(n);

  // Build irregular voiced/silence segments (pseudo-random durations),
  // driven by the same seeded PRNG, so pause timing is naturally variable.
  const segments: Array<{ voiced: boolean; samples: number }> = [];
  let total = 0;
  while (total < n) {
    const voicedDur = 0.25 + rand() * 0.5; // 0.25s - 0.75s
    const silenceDur = 0.08 + rand() * 0.35; // 0.08s - 0.43s
    const voicedSamples = Math.round(voicedDur * sampleRate);
    const silenceSamples = Math.round(silenceDur * sampleRate);
    segments.push({ voiced: true, samples: voicedSamples });
    segments.push({ voiced: false, samples: silenceSamples });
    total += voicedSamples + silenceSamples;
  }

  let idx = 0;
  let phase = 0;
  outer: for (const seg of segments) {
    if (!seg.voiced) {
      for (let i = 0; i < seg.samples; i++) {
        if (idx >= n) break outer;
        out[idx++] = 0;
      }
      phase = 0;
      continue;
    }

    let remaining = seg.samples;
    while (remaining > 0) {
      // Perturb F0 and amplitude once per pitch period (cycle-synchronous
      // jitter/shimmer), then render that single cycle sample-by-sample.
      const jitteredF0 = f0Hz * (1 + (rand() * 2 - 1) * jitterFrac);
      const jitteredAmp = amplitude * (1 + (rand() * 2 - 1) * shimmerFrac);
      const periodSamples = Math.max(1, Math.round(sampleRate / jitteredF0));
      const dPhase = (2 * Math.PI * jitteredF0) / sampleRate;
      const thisLen = Math.min(periodSamples, remaining);

      for (let i = 0; i < thisLen; i++) {
        if (idx >= n) break outer;
        out[idx++] =
          jitteredAmp *
          (0.7 * Math.sin(phase) + 0.2 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase));
        phase += dPhase;
      }
      remaining -= thisLen;
    }
  }

  return out;
}
