import { describe, expect, it } from "vitest";
import { decodeWav, encodeWavMono16, WavParseError } from "../src/wav.js";

describe("WAV parsing (real RIFF/fmt/data chunk parsing)", () => {
  it("round-trips known sample values through encode -> decode", () => {
    const sampleRate = 8000;
    // Known values chosen to land on exact 16-bit PCM levels so the
    // round trip is exact (no quantization surprises).
    const known = new Float64Array([0, 0.5, -0.5, 1, -1, 0.25, -0.25]);
    const wavBuffer = encodeWavMono16(known, sampleRate);

    const decoded = decodeWav(wavBuffer);

    expect(decoded.sampleRate).toBe(sampleRate);
    expect(decoded.numChannels).toBe(1);
    expect(decoded.bitsPerSample).toBe(16);
    expect(decoded.samples.length).toBe(known.length);

    for (let i = 0; i < known.length; i++) {
      // 16-bit quantization step is 1/32768; allow a couple steps of slack.
      expect(decoded.samples[i]).toBeCloseTo(known[i]!, 3);
    }
  });

  it("parses correct RIFF header fields from a hand-built buffer", () => {
    // Build a minimal, valid 16-bit mono WAV manually to confirm we are
    // reading the actual header bytes, not just trusting our own encoder.
    const sampleRate = 16000;
    const samples = new Int16Array([0, 1000, -1000, 32767, -32768]);
    const dataSize = samples.length * 2;
    const buf = Buffer.alloc(44 + dataSize);
    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(36 + dataSize, 4);
    buf.write("WAVE", 8, "ascii");
    buf.write("fmt ", 12, "ascii");
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20); // PCM
    buf.writeUInt16LE(1, 22); // mono
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write("data", 36, "ascii");
    buf.writeUInt32LE(dataSize, 40);
    for (let i = 0; i < samples.length; i++) {
      buf.writeInt16LE(samples[i]!, 44 + i * 2);
    }

    const decoded = decodeWav(buf);
    expect(decoded.sampleRate).toBe(16000);
    expect(decoded.numChannels).toBe(1);
    expect(decoded.bitsPerSample).toBe(16);
    expect(decoded.samples[0]).toBeCloseTo(0, 4);
    expect(decoded.samples[1]).toBeCloseTo(1000 / 32768, 4);
    expect(decoded.samples[2]).toBeCloseTo(-1000 / 32768, 4);
    expect(decoded.samples[3]).toBeCloseTo(32767 / 32768, 4);
    expect(decoded.samples[4]).toBeCloseTo(-32768 / 32768, 4);
    expect(decoded.durationSeconds).toBeCloseTo(samples.length / sampleRate, 6);
  });

  it("downmixes stereo to mono by averaging channels", () => {
    const sampleRate = 8000;
    const frames = [
      [1, -1], // avg 0
      [0.5, 0.5], // avg 0.5
    ];
    const dataSize = frames.length * 2 * 2;
    const buf = Buffer.alloc(44 + dataSize);
    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(36 + dataSize, 4);
    buf.write("WAVE", 8, "ascii");
    buf.write("fmt ", 12, "ascii");
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(2, 22); // stereo
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 4, 28);
    buf.writeUInt16LE(4, 32);
    buf.writeUInt16LE(16, 34);
    buf.write("data", 36, "ascii");
    buf.writeUInt32LE(dataSize, 40);
    let off = 44;
    for (const [l, r] of frames) {
      buf.writeInt16LE(Math.round(l! * 32767), off);
      buf.writeInt16LE(Math.round(r! * 32767), off + 2);
      off += 4;
    }

    const decoded = decodeWav(buf);
    expect(decoded.numChannels).toBe(2);
    expect(decoded.samples.length).toBe(2);
    expect(decoded.samples[0]).toBeCloseTo(0, 2);
    expect(decoded.samples[1]).toBeCloseTo(0.5, 2);
  });

  it("rejects a buffer missing the RIFF header", () => {
    const bad = Buffer.from("not a wav file at all, just text padding....");
    expect(() => decodeWav(bad)).toThrow(WavParseError);
  });

  it("rejects a RIFF buffer missing the fmt chunk", () => {
    const buf = Buffer.alloc(20);
    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(12, 4);
    buf.write("WAVE", 8, "ascii");
    buf.write("data", 12, "ascii");
    buf.writeUInt32LE(0, 16);
    expect(() => decodeWav(buf)).toThrow(WavParseError);
  });
});
