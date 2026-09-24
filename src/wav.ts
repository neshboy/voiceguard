/**
 * Real WAV (RIFF/PCM) file parsing and writing, implemented from scratch by
 * walking the binary chunk structure -- no audio library involved.
 *
 * WAV layout (little-endian):
 *   bytes 0-3   "RIFF"
 *   bytes 4-7   chunk size (u32)
 *   bytes 8-11  "WAVE"
 *   then a sequence of sub-chunks, each:
 *     bytes 0-3  chunk id (ascii, e.g. "fmt " or "data")
 *     bytes 4-7  chunk size (u32)
 *     bytes 8..  chunk payload (padded to even length)
 *
 * The "fmt " chunk describes the encoding (PCM int vs IEEE float, channel
 * count, sample rate, bit depth). The "data" chunk holds the raw samples.
 * We only need those two chunks; any others (e.g. "LIST", "fact") are
 * skipped by their declared size.
 */

import type { DecodedWav } from "./types.js";

const RIFF_FORMAT_PCM = 1;
const RIFF_FORMAT_IEEE_FLOAT = 3;

export class WavParseError extends Error {}

interface FmtChunk {
  audioFormat: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

function readAscii(buf: Buffer, offset: number, length: number): string {
  return buf.toString("ascii", offset, offset + length);
}

/**
 * Parse a real WAV file's bytes into normalized mono PCM samples in [-1, 1].
 * Multi-channel audio is downmixed by averaging channels.
 */
export function decodeWav(buf: Buffer): DecodedWav {
  if (buf.length < 12) {
    throw new WavParseError("File too small to be a WAV file");
  }
  if (readAscii(buf, 0, 4) !== "RIFF") {
    throw new WavParseError('Missing "RIFF" header; not a valid WAV file');
  }
  if (readAscii(buf, 8, 4) !== "WAVE") {
    throw new WavParseError('Missing "WAVE" format tag; not a valid WAV file');
  }

  let offset = 12;
  let fmt: FmtChunk | null = null;
  let dataStart = -1;
  let dataLength = -1;

  while (offset + 8 <= buf.length) {
    const chunkId = readAscii(buf, offset, 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;

    if (chunkId === "fmt ") {
      if (bodyStart + 16 > buf.length) {
        throw new WavParseError('"fmt " chunk is truncated');
      }
      fmt = {
        audioFormat: buf.readUInt16LE(bodyStart + 0),
        numChannels: buf.readUInt16LE(bodyStart + 2),
        sampleRate: buf.readUInt32LE(bodyStart + 4),
        bitsPerSample: buf.readUInt16LE(bodyStart + 14),
      };
    } else if (chunkId === "data") {
      dataStart = bodyStart;
      // Guard against a data chunk size that overruns the actual buffer
      // (some encoders write a placeholder/incorrect size).
      dataLength = Math.min(chunkSize, buf.length - bodyStart);
    }

    // Chunks are padded to an even number of bytes.
    const advance = chunkSize + (chunkSize % 2);
    offset = bodyStart + advance;
  }

  if (!fmt) {
    throw new WavParseError('Missing "fmt " chunk');
  }
  if (dataStart < 0) {
    throw new WavParseError('Missing "data" chunk');
  }
  if (
    fmt.audioFormat !== RIFF_FORMAT_PCM &&
    fmt.audioFormat !== RIFF_FORMAT_IEEE_FLOAT
  ) {
    throw new WavParseError(
      `Unsupported WAV audio format code ${fmt.audioFormat}; only PCM integer (1) and IEEE float (3) are supported`
    );
  }
  if (fmt.numChannels < 1) {
    throw new WavParseError("Invalid channel count in fmt chunk");
  }

  const bytesPerSample = fmt.bitsPerSample / 8;
  if (!Number.isInteger(bytesPerSample) || bytesPerSample < 1) {
    throw new WavParseError(`Unsupported bit depth: ${fmt.bitsPerSample}`);
  }

  const frameSize = bytesPerSample * fmt.numChannels;
  const frameCount = Math.floor(dataLength / frameSize);
  const mono = new Float64Array(frameCount);

  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    const frameOffset = dataStart + i * frameSize;
    for (let ch = 0; ch < fmt.numChannels; ch++) {
      const sampleOffset = frameOffset + ch * bytesPerSample;
      sum += readSample(buf, sampleOffset, fmt);
    }
    mono[i] = sum / fmt.numChannels;
  }

  return {
    sampleRate: fmt.sampleRate,
    numChannels: fmt.numChannels,
    bitsPerSample: fmt.bitsPerSample,
    samples: mono,
    durationSeconds: fmt.sampleRate > 0 ? frameCount / fmt.sampleRate : 0,
  };
}

function readSample(buf: Buffer, offset: number, fmt: FmtChunk): number {
  if (fmt.audioFormat === RIFF_FORMAT_IEEE_FLOAT) {
    if (fmt.bitsPerSample === 32) return buf.readFloatLE(offset);
    if (fmt.bitsPerSample === 64) return buf.readDoubleLE(offset);
    throw new WavParseError(
      `Unsupported float bit depth: ${fmt.bitsPerSample}`
    );
  }

  switch (fmt.bitsPerSample) {
    case 8:
      // 8-bit PCM is unsigned in WAV, centered at 128.
      return (buf.readUInt8(offset) - 128) / 128;
    case 16:
      return buf.readInt16LE(offset) / 32768;
    case 24: {
      const b0 = buf[offset]!;
      const b1 = buf[offset + 1]!;
      const b2 = buf[offset + 2]!;
      let value = b0 | (b1 << 8) | (b2 << 16);
      if (value & 0x800000) value |= 0xff000000; // sign-extend
      return value / 8388608;
    }
    case 32:
      return buf.readInt32LE(offset) / 2147483648;
    default:
      throw new WavParseError(`Unsupported PCM bit depth: ${fmt.bitsPerSample}`);
  }
}

/**
 * Encode mono float samples (range [-1, 1]) as a canonical 16-bit PCM WAV
 * file buffer. Used to synthesize deterministic test fixtures and for any
 * future export needs.
 */
export function encodeWavMono16(samples: Float64Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = samples.length * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");

  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // audio format: PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  const byteRate = sampleRate * numChannels * bytesPerSample;
  buf.writeUInt32LE(byteRate, 28);
  const blockAlign = numChannels * bytesPerSample;
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);

  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    const intSample = Math.round(clamped * 32767);
    buf.writeInt16LE(intSample, 44 + i * bytesPerSample);
  }

  return buf;
}
