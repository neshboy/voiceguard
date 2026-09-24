/**
 * The mandatory VoiceGuard disclaimer. This is printed on every CLI run --
 * not just documented in the README -- because the whole point of this tool
 * is to avoid ever being mistaken for a certified or forensic detector.
 */
export const DISCLAIMER =
  "VoiceGuard is a best-effort heuristic screening aid based on acoustic-feature analysis. " +
  "It is NOT a certified or forensic deepfake detector, will make mistakes in both directions, " +
  "and must never be the sole basis for verifying someone's identity or authorizing a real-world action.";

export const SHORT_WARNING =
  "Heuristic screening only. Not forensic-grade. Can be wrong in both directions. " +
  "Never use this as the sole basis for verifying a caller's identity or approving a payment/transfer.";
