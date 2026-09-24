#!/usr/bin/env node
/**
 * VoiceGuard CLI entry point.
 *
 * Usage:
 *   voiceguard analyze <file.wav> [--json]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeWav, WavParseError } from "./wav.js";
import { analyzeDecodedWav } from "./score.js";
import { formatJsonReport, formatTextReport } from "./report.js";
import { DISCLAIMER, SHORT_WARNING } from "./disclaimer.js";

function printUsage(): void {
  console.log(`VoiceGuard -- heuristic synthetic-speech screening CLI

Usage:
  voiceguard analyze <file.wav> [--json]
  voiceguard --help

! ${SHORT_WARNING}
`);
}

export function runCli(argv: string[]): number {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return command ? 0 : 1;
  }

  if (command !== "analyze") {
    console.error(`Unknown command: "${command}"\n`);
    printUsage();
    return 1;
  }

  const jsonFlagIndex = rest.indexOf("--json");
  const asJson = jsonFlagIndex !== -1;
  if (asJson) rest.splice(jsonFlagIndex, 1);

  const filePathArg = rest[0];
  if (!filePathArg) {
    console.error("Error: missing <file.wav> argument.\n");
    printUsage();
    return 1;
  }

  const filePath = resolve(filePathArg);
  let buf: Buffer;
  try {
    buf = readFileSync(filePath);
  } catch (err) {
    console.error(`Error: could not read file "${filePath}": ${(err as Error).message}`);
    console.error(`\n${DISCLAIMER}`);
    return 1;
  }

  try {
    const wav = decodeWav(buf);
    const result = analyzeDecodedWav(filePath, wav, {});
    if (asJson) {
      console.log(formatJsonReport(result));
    } else {
      console.log(formatTextReport(result));
    }
    return 0;
  } catch (err) {
    if (err instanceof WavParseError) {
      console.error(`Error: failed to parse "${filePath}" as a WAV file: ${err.message}`);
    } else {
      console.error(`Error: analysis failed: ${(err as Error).message}`);
    }
    console.error(`\n${DISCLAIMER}`);
    return 1;
  }
}

// Tests import `runCli` directly and set this so requiring the module
// doesn't also invoke process.exit(); every real invocation (via the `bin/`
// launcher or `node dist/cli.js`) runs main normally.
if (process.env.VOICEGUARD_NO_MAIN !== "1") {
  const exitCode = runCli(process.argv.slice(2));
  process.exit(exitCode);
}
