// worker_threads entry. sherpa-onnx-node is imported here and nowhere else, so the server, the tests and the type
// check never load the native module. process() and decode() are synchronous, which is why this is a worker.
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import sherpa from 'sherpa-onnx-node';
import { finalise, prepareForAsr, type Segment } from './segments.js';
import { WAV_SAMPLE_RATE } from './wav.js';

export interface WorkerInit { modelsDir: string; threads: number }
export interface WorkerRun { type: 'run'; samples: Float32Array; numSpeakers: number | null }
export type WorkerOut =
  | { type: 'stage'; name: 'diarizing' | 'transcribing'; done: number; total: number }
  | { type: 'done'; segments: Segment[] }
  | { type: 'error'; message: string };

const port = parentPort;
if (!port) throw new Error('voice worker must run inside worker_threads');
const post = (m: WorkerOut) => port.postMessage(m);

const { modelsDir, threads } = workerData as WorkerInit;
const at = (rel: string) => join(modelsDir, rel);

// Loaded on the first job and kept: the first job pays the load, later ones do not.
let sd: InstanceType<typeof sherpa.OfflineSpeakerDiarization> | null = null;
let rec: InstanceType<typeof sherpa.OfflineRecognizer> | null = null;

function load(): void {
  sd ??= new sherpa.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: at('sherpa-onnx-pyannote-segmentation-3-0/model.onnx') }, numThreads: threads },
    embedding: { model: at('wespeaker_en_voxceleb_resnet34.onnx'), numThreads: threads },
    clustering: { numClusters: -1, threshold: 0.5 },
    minDurationOn: 0.2,
    minDurationOff: 0.5,
  });
  rec ??= new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: WAV_SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      whisper: {
        encoder: at('sherpa-onnx-whisper-base.en/base.en-encoder.int8.onnx'),
        decoder: at('sherpa-onnx-whisper-base.en/base.en-decoder.int8.onnx'),
        language: 'en',
        task: 'transcribe',
      },
      tokens: at('sherpa-onnx-whisper-base.en/base.en-tokens.txt'),
      numThreads: threads,
      provider: 'cpu',
    },
  });
}

function run(samples: Float32Array, numSpeakers: number | null): Segment[] {
  load();
  post({ type: 'stage', name: 'diarizing', done: 0, total: 1 });
  // A positive cluster count overrides the threshold (measured in the spike).
  sd!.setConfig({ clustering: { numClusters: numSpeakers ?? -1, threshold: 0.5 } });
  const turns = prepareForAsr(sd!.process(samples));

  const out: Segment[] = [];
  turns.forEach((t, i) => {
    post({ type: 'stage', name: 'transcribing', done: i, total: turns.length });
    const stream = rec!.createStream();
    const from = Math.max(0, Math.floor(t.start * WAV_SAMPLE_RATE));
    const to = Math.min(samples.length, Math.ceil(t.end * WAV_SAMPLE_RATE));
    stream.acceptWaveform({ sampleRate: WAV_SAMPLE_RATE, samples: samples.subarray(from, to) });
    rec!.decode(stream);
    out.push({ ...t, text: rec!.getResult(stream).text.trim() });
  });
  post({ type: 'stage', name: 'transcribing', done: turns.length, total: turns.length });
  return finalise(out);
}

port.on('message', (m: WorkerRun) => {
  if (m.type !== 'run') return;
  try {
    post({ type: 'done', segments: run(m.samples, m.numSpeakers) });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
});
