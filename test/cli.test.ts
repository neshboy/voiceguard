import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWavMono16 } from "../src/wav.js";
import { makePerfectPitchVoiceLike } from "./fixtures.js";

process.env.VOICEGUARD_NO_MAIN = "1";

describe("CLI", () => {
  let dir: string;
  let wavPath: string;
  let notWavPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "voiceguard-test-"));
    wavPath = join(dir, "sample.wav");
    notWavPath = join(dir, "not-audio.txt");
    const samples = makePerfectPitchVoiceLike({ durationSeconds: 1, sampleRate: 16000 });
    writeFileSync(wavPath, encodeWavMono16(samples, 16000));
    writeFileSync(notWavPath, "this is definitely not a wav file");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("prints the composite score and disclaimer for a valid WAV file", async () => {
    const { runCli } = await import("../src/cli.js");
    const logs: string[] = [];
    const errors: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    let code: number;
    try {
      code = runCli(["analyze", wavPath]);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }

    expect(code).toBe(0);
    const output = logs.join("\n");
    expect(output).toMatch(/Composite heuristic score/);
    expect(output).toMatch(/NOT a certified or forensic deepfake detector/);
    expect(output).toMatch(/never be the sole basis/);
    expect(errors.length).toBe(0);
  });

  it("emits valid JSON with --json, including the disclaimer field", async () => {
    const { runCli } = await import("../src/cli.js");
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    let code: number;
    try {
      code = runCli(["analyze", wavPath, "--json"]);
    } finally {
      console.log = origLog;
    }
    expect(code).toBe(0);
    const parsed = JSON.parse(logs.join("\n"));
    expect(typeof parsed.compositeScore).toBe("number");
    expect(parsed.disclaimer).toMatch(/NOT a certified or forensic deepfake detector/);
    expect(Array.isArray(parsed.features)).toBe(true);
  });

  it("exits non-zero and still prints the disclaimer when the file is not a valid WAV", async () => {
    const { runCli } = await import("../src/cli.js");
    const errors: string[] = [];
    const origErr = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    let code: number;
    try {
      code = runCli(["analyze", notWavPath]);
    } finally {
      console.error = origErr;
    }
    expect(code).toBe(1);
    const output = errors.join("\n");
    expect(output).toMatch(/failed to parse/);
    expect(output).toMatch(/NOT a certified or forensic deepfake detector/);
  });

  it("exits non-zero with usage guidance when no file is given", async () => {
    const { runCli } = await import("../src/cli.js");
    const errors: string[] = [];
    const logs: string[] = [];
    const origErr = console.error;
    const origLog = console.log;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    let code: number;
    try {
      code = runCli(["analyze"]);
    } finally {
      console.error = origErr;
      console.log = origLog;
    }
    expect(code).toBe(1);
  });
});
