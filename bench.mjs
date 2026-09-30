import { trackPitch } from "./dist/pitch.js";

const sampleRate = 44100;
const freqHz = 130;
const durationSeconds = 90;
const n = Math.round(durationSeconds * sampleRate);
const samples = new Float64Array(n);
for (let i = 0; i < n; i++) {
  samples[i] = 0.6 * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
}
const framing = {
  frameSizeSamples: Math.round(sampleRate * 0.03),
  hopSizeSamples: Math.round(sampleRate * 0.01),
};
const t0 = Date.now();
const frames = trackPitch(samples, sampleRate, framing);
const t1 = Date.now();
console.log("trackPitch wall ms:", t1 - t0, "frames:", frames.length);
