import { z } from 'zod';
import {
  ApiError,
  AskEvent,
  Health,
  MeetingDetail,
  MeetingSummary,
  QueryTrace,
  Transcription,
  type AskRequest,
  type UploadRequest,
} from './types';

// Same origin: Vite proxies /api in dev and nginx does in compose. The API sends no CORS headers.
const BASE = '/api';

export type ClientErrorCode = ApiError['error']['code'] | 'NETWORK' | 'BAD_RESPONSE';

export class ApiClientError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number | null;
  readonly requestId: string | null;

  constructor(code: ClientErrorCode, message: string, status: number | null = null, requestId: string | null = null) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiClientError('NETWORK', 'Could not reach the API.');
  }
  if (res.ok) return res;
  // nginx answers an oversized body with an HTML 413 before the API sees it.
  if (res.status === 413) {
    const apiBody = ApiError.safeParse(await res.json().catch(() => null));
    if (!apiBody.success) throw new ApiClientError('TOO_LARGE', 'The upload is too large.', 413);
    const { message, requestId } = apiBody.data.error;
    throw new ApiClientError('TOO_LARGE', message, 413, requestId);
  }
  const parsed = ApiError.safeParse(await res.json().catch(() => null));
  if (parsed.success) {
    const { code, message, requestId } = parsed.data.error;
    throw new ApiClientError(code, message, res.status, requestId);
  }
  throw new ApiClientError('BAD_RESPONSE', `The API returned ${res.status}.`, res.status);
}

async function sendJson<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await send(path, init);
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ApiClientError('BAD_RESPONSE', 'The API returned data in an unexpected shape.', res.status);
  return parsed.data;
}

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
});

export const getHealth = (signal?: AbortSignal) => sendJson('/health', Health, signal ? { signal } : undefined);

export const listMeetings = async (signal?: AbortSignal): Promise<MeetingSummary[]> =>
  (await sendJson('/meetings', z.object({ meetings: z.array(MeetingSummary) }), signal ? { signal } : undefined)).meetings;

export const getMeeting = (id: string, signal?: AbortSignal) =>
  sendJson(`/meetings/${encodeURIComponent(id)}`, MeetingDetail, signal ? { signal } : undefined);

export const uploadMeeting = (req: UploadRequest) => sendJson('/meetings', MeetingDetail, post(req));

/** User-clicked. The API answers 202 with a pending meeting; poll getMeeting for the result. */
export const extractMeeting = (id: string) => sendJson(`/meetings/${encodeURIComponent(id)}/extract`, MeetingDetail, post());

/** Loads the bundled sample transcripts. No model call; safe to repeat. */
export const seedSamples = () => sendJson('/seed', z.object({ added: z.number().int(), skipped: z.number().int() }), post());

/** Sends 16 kHz mono 16-bit WAV bytes. Answers 202 with a queued draft; poll getTranscription. */
export const startTranscription = (wav: Blob, numSpeakers?: number) =>
  sendJson(
    `/transcriptions${numSpeakers === undefined ? '' : `?numSpeakers=${numSpeakers}`}`,
    Transcription,
    { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav },
  );

export const getTranscription = (id: string, signal?: AbortSignal) =>
  sendJson(`/transcriptions/${encodeURIComponent(id)}`, Transcription, signal ? { signal } : undefined);

/** Frees the finished draft on the API early. Failure is harmless: it expires on its own. */
export const deleteTranscription = (id: string) => send(`/transcriptions/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(() => undefined);

export const getTrace = (id: string, signal?: AbortSignal) =>
  sendJson(`/traces/${encodeURIComponent(id)}`, QueryTrace, signal ? { signal } : undefined);

/**
 * Incremental SSE parser. Feed it decoded text in any chunking; it emits one callback per
 * complete `event:` + `data:` block (blocks end at a blank line). Unknown or malformed events are dropped.
 */
export function createSseParser(onEvent: (event: AskEvent) => void): { push(text: string): void; end(): void } {
  let buffer = '';

  const dispatch = (block: string) => {
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).replace(/^ /, '');
    }
    if (!data) return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = AskEvent.safeParse(json);
    if (parsed.success) onEvent(parsed.data);
  };

  const drain = (final: boolean) => {
    buffer = buffer.replace(/\r\n?/g, '\n');
    let i: number;
    while ((i = buffer.indexOf('\n\n')) !== -1) {
      dispatch(buffer.slice(0, i));
      buffer = buffer.slice(i + 2);
    }
    if (final && buffer.trim() !== '') {
      dispatch(buffer);
      buffer = '';
    }
  };

  return {
    push(text) {
      buffer += text;
      drain(false);
    },
    end() {
      drain(true);
    },
  };
}

export interface AskHandlers {
  onEvent(event: AskEvent): void;
}

/**
 * POST /api/ask and dispatch each AskEvent as it arrives. Resolves when the stream ends.
 * Failures before the stream starts (validation, unknown meeting, embeddings warming) reject with ApiClientError.
 * A stream that closes without `done` or `error` is reported as an `error` event rather than left hanging.
 */
export async function askStream(
  question: string,
  meetingIds: string[] | undefined,
  handlers: AskHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const body: AskRequest = { question, ...(meetingIds ? { meetingIds } : {}) };
  const res = await send('/ask', { ...post(body), ...(signal ? { signal } : {}) });
  if (!res.body) throw new ApiClientError('BAD_RESPONSE', 'The API sent no stream.', res.status);

  let finished = false;
  const parser = createSseParser((event) => {
    if (event.type === 'done' || event.type === 'error') finished = true;
    handlers.onEvent(event);
  });
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(value);
    }
    parser.end();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    if (!finished) {
      handlers.onEvent({ type: 'error', code: 'INTERNAL', message: 'The connection dropped before the answer finished.' });
      return;
    }
  }
  if (!finished) {
    handlers.onEvent({ type: 'error', code: 'INTERNAL', message: 'The connection closed before the answer finished.' });
  }
}
