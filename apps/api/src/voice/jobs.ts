import { randomUUID } from 'node:crypto';
import { AppError } from '../errors.js';
import { finalise, formatTranscript, speakerNames, type Segment } from './segments.js';
import type { Transcription, TranscriptionStage } from './types.js';
import { WAV_SAMPLE_RATE } from './wav.js';

export interface TranscriptionRunner {
  /** Takes ownership of `samples` (the worker transfers the buffer). Resolves with finalised segments. */
  run(samples: Float32Array, opts: { numSpeakers: number | null }, onStage: (s: TranscriptionStage) => void): Promise<Segment[]>;
  /** Stops any worker. Optional so test fakes stay small. */
  dispose?(): Promise<void>;
}

/** Thrown by a runner whose worker died mid-job, which in practice means it ran out of memory. */
export class RunnerCrashedError extends Error {
  constructor(message = 'The transcription worker exited unexpectedly') {
    super(message);
    this.name = 'RunnerCrashedError';
  }
}

export interface JobLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface JobsOptions {
  maxQueue: number;
  maxSeconds: number;
  ttlMs?: number;
  log: JobLogger;
}

interface Job {
  id: string;
  status: Transcription['status'];
  samples: Float32Array | null;
  numSpeakers: number | null;
  durationSeconds: number;
  stage: TranscriptionStage | null;
  segments: Segment[];
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
}

export const DEFAULT_JOB_TTL_MS = 60 * 60 * 1000;
export const CRASH_MESSAGE = 'Transcription crashed, probably out of memory. Try a shorter recording.';
export const NO_SPEECH_MESSAGE = 'No speech was found in the recording.';
const GENERIC_FAILURE = 'Transcription failed. Check the API logs.';

/**
 * Jobs live in memory on purpose: audio is never stored and a draft is thrown away unless the user confirms it, so
 * there is nothing durable to keep. A restart loses queued and running jobs and the browser gets a 404 on its next poll.
 */
export class TranscriptionJobs {
  readonly maxQueue: number;
  readonly maxSeconds: number;
  private readonly ttlMs: number;
  private readonly log: JobLogger;
  private readonly jobs = new Map<string, Job>();
  private running: Job | null = null;
  private sweeper: NodeJS.Timeout | null = null;

  constructor(private readonly runner: TranscriptionRunner | null, opts: JobsOptions) {
    this.maxQueue = opts.maxQueue;
    this.maxSeconds = opts.maxSeconds;
    this.ttlMs = opts.ttlMs ?? DEFAULT_JOB_TTL_MS;
    this.log = opts.log;
    if (runner) {
      this.sweeper = setInterval(() => this.sweep(), 60_000);
      this.sweeper.unref();
    }
  }

  get available(): boolean {
    return this.runner !== null;
  }

  private active(): Job[] {
    return [...this.jobs.values()].filter((j) => j.status === 'queued' || j.status === 'running');
  }

  /** Cheap pre-check so the route can refuse before it buffers and decodes a large body. add() still enforces it. */
  hasCapacity(): boolean {
    return this.active().length < this.maxQueue;
  }

  /** Throws CONFLICT when the queue is full; otherwise returns the new job as a `queued` snapshot. */
  add(samples: Float32Array, opts: { numSpeakers: number | null }): Transcription {
    if (!this.runner) throw new AppError('CONFLICT', 'Voice transcription is not available on this API.');
    if (!this.hasCapacity()) throw this.queueFull();
    const job: Job = {
      id: randomUUID(),
      status: 'queued',
      samples,
      numSpeakers: opts.numSpeakers,
      durationSeconds: Math.round(samples.length / WAV_SAMPLE_RATE),
      stage: null,
      segments: [],
      error: null,
      createdAt: Date.now(),
      finishedAt: null,
    };
    this.jobs.set(job.id, job);
    const snapshot = this.snapshot(job);
    // Start on the next tick so the caller's 202 always reports `queued`.
    setImmediate(() => void this.pump());
    return snapshot;
  }

  queueFull(): AppError {
    return new AppError('CONFLICT', `The API is already transcribing ${this.active().length} files. Try again in a few minutes.`);
  }

  /** Undefined for an unknown, evicted or lost id. Expiry is also checked here so it does not depend on the sweep timer. */
  status(id: string): Transcription | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    if (this.expired(job)) {
      this.jobs.delete(id);
      return undefined;
    }
    return this.snapshot(job);
  }

  /** Evicts a finished job early (the web calls this after the user imports it). Returns false if it is unknown. */
  discard(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === 'queued' || job.status === 'running') {
      throw new AppError('CONFLICT', 'This transcription is still in progress.');
    }
    this.jobs.delete(id);
    return true;
  }

  async cancelAll(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const job of this.jobs.values()) {
      if (job.status === 'queued' || job.status === 'running') this.fail(job, 'Transcription was interrupted because the API is shutting down.');
    }
    await this.runner?.dispose?.();
  }

  private expired(job: Job): boolean {
    return job.finishedAt !== null && Date.now() - job.finishedAt > this.ttlMs;
  }

  private sweep(): void {
    for (const [id, job] of this.jobs) if (this.expired(job)) this.jobs.delete(id);
  }

  private snapshot(job: Job): Transcription {
    const done = job.status === 'done';
    let queuePosition: number | null = null;
    if (job.status === 'queued') queuePosition = this.active().findIndex((j) => j.id === job.id) + 1;
    return {
      id: job.id,
      status: job.status,
      queuePosition,
      stage: job.status === 'running' ? job.stage : null,
      durationSeconds: job.durationSeconds,
      numSpeakers: done ? new Set(job.segments.map((s) => s.speaker)).size : null,
      speakers: done ? speakerNames(job.segments) : [],
      segments: done ? job.segments : [],
      transcript: done ? formatTranscript(job.segments) : null,
      error: job.error,
      createdAt: new Date(job.createdAt).toISOString(),
    };
  }

  private fail(job: Job, message: string): void {
    job.status = 'failed';
    job.error = message;
    job.samples = null;
    job.finishedAt = Date.now();
  }

  private async pump(): Promise<void> {
    if (this.running || !this.runner) return;
    const job = [...this.jobs.values()].find((j) => j.status === 'queued');
    if (!job) return;
    this.running = job;
    job.status = 'running';

    const samples = job.samples!;
    job.samples = null; // the runner owns the buffer from here
    const t0 = Date.now();
    let transcribingAt: number | null = null;
    try {
      const segments = finalise(await this.runner.run(samples, { numSpeakers: job.numSpeakers }, (stage) => {
        job.stage = stage;
        if (stage.name === 'transcribing' && transcribingAt === null) transcribingAt = Date.now();
      }));
      if (job.status !== 'running') return; // cancelled while the worker was busy
      if (segments.length === 0) {
        this.fail(job, NO_SPEECH_MESSAGE);
        this.log.info({ jobId: job.id, error: NO_SPEECH_MESSAGE }, 'voice.failed');
      } else {
        job.segments = segments;
        job.status = 'done';
        job.finishedAt = Date.now();
        const end = job.finishedAt;
        this.log.info({
          jobId: job.id,
          seconds: job.durationSeconds,
          diarizeMs: (transcribingAt ?? end) - t0,
          asrMs: transcribingAt === null ? 0 : end - transcribingAt,
          speakers: new Set(segments.map((s) => s.speaker)).size,
          turns: segments.length,
        }, 'voice.done');
      }
    } catch (err) {
      if (job.status === 'running') {
        const message = err instanceof RunnerCrashedError ? CRASH_MESSAGE : GENERIC_FAILURE;
        this.fail(job, message);
        // The error text is logged, never the audio or any transcript.
        this.log.warn({ jobId: job.id, error: err instanceof Error ? err.message : String(err) }, 'voice.failed');
      }
    } finally {
      this.running = null;
      setImmediate(() => void this.pump());
    }
  }
}
