import { Worker } from 'node:worker_threads';
import { RunnerCrashedError, type TranscriptionRunner } from './jobs.js';
import type { Segment } from './segments.js';
import type { TranscriptionStage } from './types.js';
import type { WorkerInit, WorkerOut } from './worker.js';

// Under tsx (npm run dev) this file is .ts and the worker must be too; compiled, both are .js.
const WORKER_URL = new URL(`./worker${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`, import.meta.url);

/**
 * Runs diarization and speech-to-text in one long-lived worker thread. The worker is spawned lazily on the first job
 * and respawned after a crash. Single in-flight job by construction: TranscriptionJobs serialises calls.
 */
export class WorkerRunner implements TranscriptionRunner {
  private worker: Worker | null = null;

  constructor(private readonly init: WorkerInit) {}

  private spawn(): Worker {
    this.worker ??= new Worker(WORKER_URL, { workerData: this.init });
    return this.worker;
  }

  run(samples: Float32Array, opts: { numSpeakers: number | null }, onStage: (s: TranscriptionStage) => void): Promise<Segment[]> {
    const worker = this.spawn();
    return new Promise<Segment[]>((resolve, reject) => {
      const cleanup = () => {
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
      };
      const crashed = (reason: string) => {
        cleanup();
        if (this.worker === worker) this.worker = null; // the next job gets a fresh worker
        void worker.terminate();
        reject(new RunnerCrashedError(reason));
      };
      const onMessage = (m: WorkerOut) => {
        if (m.type === 'stage') onStage({ name: m.name, done: m.done, total: m.total });
        else if (m.type === 'done') {
          cleanup();
          resolve(m.segments);
        } else {
          cleanup();
          reject(new Error(m.message));
        }
      };
      const onError = (err: Error) => crashed(err.message);
      const onExit = (code: number) => crashed(`worker exited with code ${code}`);
      worker.on('message', onMessage);
      worker.once('error', onError);
      worker.once('exit', onExit);
      // Transferred, not copied: this thread keeps no second copy of up to 115 MB of samples.
      worker.postMessage({ type: 'run', samples, numSpeakers: opts.numSpeakers }, [samples.buffer as ArrayBuffer]); // never shared: wavToFloat32 allocates it
    });
  }

  async dispose(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    await w?.terminate();
  }
}
