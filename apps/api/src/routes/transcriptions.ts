import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';
import { parseWav, wavToFloat32, WAV_SAMPLE_RATE } from '../voice/wav.js';

// One accepted format makes the byte cap and the duration cap the same number: 30 min x 16 kHz x 2 bytes = 57.6 MB.
export const VOICE_BODY_LIMIT = 64 * 1024 * 1024;
export const WAV_CONTENT_TYPES = ['audio/wav', 'audio/x-wav', 'audio/wave'];
const MIN_SECONDS = 0.5;

function parseNumSpeakers(raw: unknown): number | null {
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new AppError('VALIDATION', 'numSpeakers must be a whole number from 1 to 20.');
  const n = Number(raw);
  if (n < 1 || n > 20) throw new AppError('VALIDATION', 'numSpeakers must be a whole number from 1 to 20.');
  return n;
}

export function registerTranscriptionRoutes(app: FastifyInstance): void {
  // Audio is parsed in memory and handed to the worker. It is never written to disk or the database.
  app.addContentTypeParser(WAV_CONTENT_TYPES, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.post<{ Querystring: { numSpeakers?: string } }>('/api/transcriptions', {
    bodyLimit: VOICE_BODY_LIMIT,
    // onRequest runs before the body is read, so an unavailable or full queue is refused without buffering up to 64 MiB.
    onRequest: async () => {
      const jobs = app.transcriptionJobs;
      if (!jobs.available) throw new AppError('CONFLICT', 'Voice transcription is not available on this API.');
      if (!jobs.hasCapacity()) throw jobs.queueFull();
    },
  }, async (req, reply) => {
    const jobs = app.transcriptionJobs;
    if (!Buffer.isBuffer(req.body)) throw new AppError('VALIDATION', 'Send the audio as a 16 kHz mono 16-bit WAV with content-type audio/wav.');
    const numSpeakers = parseNumSpeakers(req.query.numSpeakers);

    const wav = parseWav(req.body);
    const seconds = wav.samples.length / WAV_SAMPLE_RATE;
    if (seconds < MIN_SECONDS) throw new AppError('UNPROCESSABLE', 'Audio is shorter than half a second.');
    if (seconds > jobs.maxSeconds) {
      throw new AppError('TOO_LARGE', `Audio is longer than ${Math.floor(jobs.maxSeconds / 60)} minutes. Trim it and try again.`);
    }

    const job = jobs.add(wavToFloat32(wav.samples), { numSpeakers });
    req.log.info({ jobId: job.id, seconds: job.durationSeconds, numSpeakers, queuePosition: job.queuePosition }, 'voice.queued');
    return reply.code(202).send(job);
  });

  app.get<{ Params: { id: string } }>('/api/transcriptions/:id', async (req) => {
    const job = app.transcriptionJobs.status(req.params.id);
    if (!job) throw new AppError('NOT_FOUND', 'Transcription not found. The API may have restarted; upload the audio again.');
    return job;
  });

  app.delete<{ Params: { id: string } }>('/api/transcriptions/:id', async (req, reply) => {
    if (!app.transcriptionJobs.discard(req.params.id)) throw new AppError('NOT_FOUND', 'Transcription not found.');
    return reply.code(204).send();
  });
}
