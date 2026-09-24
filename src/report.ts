/**
 * Plain-text and JSON report formatting for the CLI. Kept separate from
 * scoring logic so the output format can be tested/tweaked independently.
 */

import type { AnalysisResult } from "./types.js";
import { DISCLAIMER, SHORT_WARNING } from "./disclaimer.js";

const DIVIDER = "=".repeat(70);
const THIN_DIVIDER = "-".repeat(70);

function band(score: number): string {
  if (score >= 75) return "HIGH";
  if (score >= 50) return "ELEVATED";
  if (score >= 25) return "SOME";
  return "LOW";
}

export function formatTextReport(result: AnalysisResult): string {
  const lines: string[] = [];

  lines.push(DIVIDER);
  lines.push("VoiceGuard -- heuristic synthetic-speech screening");
  lines.push(DIVIDER);
  lines.push(`!! ${SHORT_WARNING}`);
  lines.push(DIVIDER);
  lines.push("");
  lines.push(`File:     ${result.filePath}`);
  lines.push(
    `Audio:    ${result.wavInfo.sampleRate} Hz, ${result.wavInfo.numChannels}ch, ` +
      `${result.wavInfo.bitsPerSample}-bit, ${result.wavInfo.durationSeconds.toFixed(2)}s`
  );
  lines.push("");
  lines.push(
    `Composite heuristic score: ${result.compositeScore.toFixed(1)} / 100  ` +
      `[${band(result.compositeScore)} level of synthetic-speech indicators]`
  );
  lines.push(
    "(Higher = more heuristic indicators associated with synthetic/cloned speech. " +
      "This is NOT a probability and NOT a verdict.)"
  );
  lines.push("");
  lines.push(THIN_DIVIDER);
  lines.push("Feature breakdown");
  lines.push(THIN_DIVIDER);

  for (const f of result.features) {
    const excluded = f.weight === 0;
    lines.push("");
    lines.push(
      `- ${f.label}${excluded ? " [excluded from composite: insufficient data]" : ""}`
    );
    if (!excluded) {
      lines.push(`  score: ${f.score.toFixed(1)}/100  weight: ${(f.weight * 100).toFixed(0)}%`);
    }
    lines.push(`  why:   ${f.explanation}`);
    const detailStr = Object.entries(f.details)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    if (detailStr) lines.push(`  data:  ${detailStr}`);
  }

  lines.push("");
  lines.push(DIVIDER);
  lines.push("DISCLAIMER");
  lines.push(DIVIDER);
  lines.push(result.disclaimer);
  lines.push(DIVIDER);

  return lines.join("\n");
}

export function formatJsonReport(result: AnalysisResult): string {
  // The disclaimer is already embedded in `result.disclaimer`; JSON
  // consumers get it as data, same as every other field.
  return JSON.stringify(result, null, 2);
}

export { DISCLAIMER };
