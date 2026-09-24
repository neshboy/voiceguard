/**
 * Real, from-scratch radix-2 Cooley-Tukey FFT.
 *
 * This is the textbook decimation-in-time algorithm: bit-reversal permutation
 * followed by log2(N) butterfly stages. Input length must be a power of two;
 * callers zero-pad frames up to the next power of two.
 */

export class FftInputError extends Error {}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/** In-place FFT over parallel real/imaginary arrays of equal power-of-two length. */
export function fft(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  if (imag.length !== n) {
    throw new FftInputError("real and imag arrays must have equal length");
  }
  if (!isPowerOfTwo(n)) {
    throw new FftInputError(`FFT length must be a power of two, got ${n}`);
  }

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = real[i]!;
      real[i] = real[j]!;
      real[j] = tr;
      const ti = imag[i]!;
      imag[i] = imag[j]!;
      imag[j] = ti;
    }
  }

  // Iterative butterflies.
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const angleStep = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const angle = angleStep * k;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const evenIdx = start + k;
        const oddIdx = start + k + half;
        const oddRe = real[oddIdx]! * cos - imag[oddIdx]! * sin;
        const oddIm = real[oddIdx]! * sin + imag[oddIdx]! * cos;
        const evenRe = real[evenIdx]!;
        const evenIm = imag[evenIdx]!;
        real[evenIdx] = evenRe + oddRe;
        imag[evenIdx] = evenIm + oddIm;
        real[oddIdx] = evenRe - oddRe;
        imag[oddIdx] = evenIm - oddIm;
      }
    }
  }
}

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Compute the magnitude spectrum (bins [0, N/2]) of a real-valued signal.
 * The signal is zero-padded to the next power of two if needed.
 */
export function magnitudeSpectrum(signal: Float64Array | number[]): Float64Array {
  const n = nextPowerOfTwo(signal.length);
  const real = new Float64Array(n);
  const imag = new Float64Array(n);
  for (let i = 0; i < signal.length; i++) real[i] = signal[i]!;
  fft(real, imag);
  const half = n / 2 + 1;
  const mags = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    mags[i] = Math.hypot(real[i]!, imag[i]!);
  }
  return mags;
}

/** Standard Hann window, used to reduce spectral leakage before framed FFTs. */
export function hannWindow(size: number): Float64Array {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return w;
}
