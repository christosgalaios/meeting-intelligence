// Voice eval: runs the real worker on a WAV and scores it against ground truth. Needs the models, so it is not part
// of `npm test`. Run: VOICE_MODELS_DIR=<dir> npm run voice:eval --workspace apps/api
// Optional: VOICE_CLIP (default evals/voice/clip.wav), VOICE_TRUTH (default evals/voice/truth.json), VOICE_NUM_SPEAKERS.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkerRunner } from '../src/voice/runner.js';
import { voiceModelsPresent } from '../src/voice/models.js';
import { parseWav, wavToFloat32, WAV_SAMPLE_RATE } from '../src/voice/wav.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const evalsDir = path.resolve(here, '../../../evals/voice');
const modelsDir = process.env.VOICE_MODELS_DIR;
if (!modelsDir || !voiceModelsPresent(modelsDir)) {
  console.error('Set VOICE_MODELS_DIR to a directory holding the voice models (see apps/api/Dockerfile for the layout).');
  process.exit(1);
}
const clip = process.env.VOICE_CLIP ?? path.join(evalsDir, 'clip.wav');
const truthPath = process.env.VOICE_TRUTH ?? path.join(evalsDir, 'truth.json');
const numSpeakers = process.env.VOICE_NUM_SPEAKERS ? Number(process.env.VOICE_NUM_SPEAKERS) : null;

interface Truth { speaker: string; start: number; end: number; text: string }
const truth = JSON.parse(await readFile(truthPath, 'utf8')) as Truth[];
const wav = parseWav(await readFile(clip));
const samples = wavToFloat32(wav.samples);
const seconds = samples.length / WAV_SAMPLE_RATE;

const runner = new WorkerRunner({ modelsDir, threads: Number(process.env.VOICE_THREADS ?? 2) });
let peakRss = 0;
const timer = setInterval(() => (peakRss = Math.max(peakRss, process.memoryUsage().rss)), 200);
const t0 = Date.now();
const segs = await runner.run(samples, { numSpeakers }, () => undefined);
const elapsedMs = Date.now() - t0;
clearInterval(timer);
await runner.dispose();

// Frame-level attribution: 100 frames per second, best one-to-one mapping of predicted to true speakers.
const FRAMES = 100;
const n = Math.ceil(seconds * FRAMES);
const names = [...new Set(truth.map((t) => t.speaker))];
const predicted = [...new Set(segs.map((s) => s.speaker))];
const fill = (items: Array<{ start: number; end: number; id: number }>) => {
  const f = new Int8Array(n).fill(-1);
  for (const it of items) for (let i = Math.floor(it.start * FRAMES); i < Math.min(n, Math.ceil(it.end * FRAMES)); i++) f[i] = it.id;
  return f;
};
const tf = fill(truth.map((t) => ({ ...t, id: names.indexOf(t.speaker) })));
const pf = fill(segs.map((s) => ({ ...s, id: predicted.indexOf(s.speaker) })));
const perms = <T,>(a: T[]): T[][] => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
let bestOk = 0;
for (const p of perms(predicted.map((_, i) => i))) {
  let ok = 0;
  for (let i = 0; i < n; i++) if (tf[i]! >= 0 && pf[i]! >= 0 && p[pf[i]!] === tf[i]) ok++;
  bestOk = Math.max(bestOk, ok);
}
const truthFrames = tf.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0);
const predictedFrames = pf.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0);

// Word error rate by edit distance over lower-cased words.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean);
const ref = norm(truth.map((t) => t.text).join(' '));
const hyp = norm(segs.map((s) => s.text).join(' '));
let prev = Array.from({ length: hyp.length + 1 }, (_, j) => j);
for (let i = 1; i <= ref.length; i++) {
  const row = [i];
  for (let j = 1; j <= hyp.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  prev = row;
}
const wer = prev[hyp.length]! / ref.length;

console.table({
  'audio seconds': +seconds.toFixed(1),
  'speakers found / true': `${predicted.length} / ${names.length}`,
  'turns': segs.length,
  // Precision: of the speech the system attributed, how much went to the right person. Coverage: of the true speech, how much was attributed correctly.
  'label precision %': +((100 * bestOk) / predictedFrames).toFixed(1),
  'label coverage %': +((100 * bestOk) / truthFrames).toFixed(1),
  'WER %': +(100 * wer).toFixed(1),
  'ms per audio minute': Math.round(elapsedMs / (seconds / 60)),
  'peak RSS MB': Math.round(peakRss / 1048576),
});
