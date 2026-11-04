import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transcription } from '../api/types';
import { UploadDropzone } from '../components/UploadDropzone';
import { VoiceImport } from '../components/VoiceImport';
import { AudioTooLong, AudioUndecodable } from '../lib/audio';
import { transcription } from './voiceFixtures';

vi.mock('../lib/audio', async (orig) => ({ ...(await orig<typeof import('../lib/audio')>()), decodeToWav16k: vi.fn() }));
import { decodeToWav16k } from '../lib/audio';

const decode = vi.mocked(decodeToWav16k);
const file = new File([new Uint8Array([1])], 'standup.m4a', { type: 'audio/mp4' });
const queued = (position: number): Transcription => transcription({ status: 'queued', queuePosition: position, numSpeakers: null, speakers: [], segments: [], transcript: null });
const running = (done: number, total: number): Transcription =>
  transcription({ status: 'running', stage: { name: 'transcribing', done, total }, numSpeakers: null, speakers: [], segments: [], transcript: null });

/** A server whose job state the test controls. POST returns `onPost`, GET returns whatever `current` is. */
function stubServer(onPost: Transcription, opts: { getStatus?: () => number } = {}) {
  const state = { current: onPost, posts: [] as string[] };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url.startsWith('/api/transcriptions')) {
      state.posts.push(url);
      return new Response(JSON.stringify(onPost), { status: 202 });
    }
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.startsWith('/api/transcriptions/')) {
      const status = opts.getStatus?.() ?? 200;
      if (status === 404) return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Transcription not found.', requestId: 'r' } }), { status });
      return new Response(JSON.stringify(state.current), { status });
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
  return state;
}

beforeEach(() => decode.mockResolvedValue({ blob: new Blob(['wav'], { type: 'audio/wav' }), seconds: 40 }));
afterEach(() => {
  vi.unstubAllGlobals();
  decode.mockReset();
});

const renderImport = () => render(<VoiceImport file={file} onImported={vi.fn()} onCancel={vi.fn()} pollMs={5} />);

describe('VoiceImport', () => {
  it('walks decoding, queue position, stage progress and ends on the review step', async () => {
    const server = stubServer(queued(2));
    renderImport();
    expect(await screen.findByText('Queued, 1 ahead')).toBeInTheDocument();
    server.current = running(3, 12);
    expect(await screen.findByText('Transcribing 4 of 12 segments')).toBeInTheDocument();
    server.current = transcription();
    expect(await screen.findByRole('heading', { name: 'Review the transcript' })).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^Name for speaker/)).toHaveLength(3);
  });

  it('re-runs the same audio with the chosen speaker count and keeps the review on screen', async () => {
    const server = stubServer(transcription());
    renderImport();
    await screen.findByRole('heading', { name: 'Review the transcript' });
    expect(server.posts).toEqual(['/api/transcriptions']);

    const count = screen.getByLabelText('Wrong number of speakers?');
    await userEvent.clear(count);
    await userEvent.type(count, '3');
    server.current = transcription({ id: 't2' });
    await userEvent.click(screen.getByRole('button', { name: 'Re-run with 3 speakers' }));
    expect(server.posts).toEqual(['/api/transcriptions', '/api/transcriptions?numSpeakers=3']);
    expect(decode).toHaveBeenCalledTimes(1); // the WAV is reused, not decoded again
    expect(screen.getByRole('heading', { name: 'Review the transcript' })).toBeInTheDocument();
  });

  it('explains a restarted API when the poll gets a 404 and retries from the held audio', async () => {
    let status = 200;
    const server = stubServer(queued(1), { getStatus: () => status });
    renderImport();
    await screen.findByText('Queued. Starting shortly.');
    status = 404;
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The API restarted while transcribing.');
    status = 200;
    server.current = transcription();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: 'Review the transcript' });
    expect(server.posts).toHaveLength(2);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('shows the API reason when the job fails', async () => {
    stubServer(transcription({ status: 'failed', error: 'No speech was found in the recording.', segments: [], speakers: [], numSpeakers: null, transcript: null }));
    renderImport();
    expect(await screen.findByRole('alert')).toHaveTextContent('No speech was found in the recording.');
  });

  it('refuses a too-long recording in the browser and sends no request at all', async () => {
    decode.mockRejectedValue(new AudioTooLong(35 * 60));
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderImport();
    expect(await screen.findByRole('alert')).toHaveTextContent('That recording is 35 minutes; the limit is 30.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('tells the user how to fix a file the browser cannot decode', async () => {
    decode.mockRejectedValue(new AudioUndecodable());
    vi.stubGlobal('fetch', vi.fn());
    renderImport();
    expect(await screen.findByRole('alert')).toHaveTextContent('Convert it to MP3, M4A or WAV');
  });
});

describe('UploadDropzone voice entry', () => {
  const dropzone = (voiceAvailable?: boolean) =>
    render(<MemoryRouter><UploadDropzone onUploaded={vi.fn()} {...(voiceAvailable === undefined ? {} : { voiceAvailable })} /></MemoryRouter>);

  it('shows the audio button and the 30 minute copy when voice is available', async () => {
    stubServer(queued(1));
    dropzone(true);
    expect(screen.getByRole('button', { name: 'Transcribe audio' })).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText('Audio file'), file);
    expect(await screen.findByText(/up to 30 minutes/)).toBeInTheDocument();
  });

  it('shows a one-line hint and no button when the API has no voice models', () => {
    dropzone(false);
    expect(screen.queryByRole('button', { name: 'Transcribe audio' })).not.toBeInTheDocument();
    expect(screen.getByText(/Audio transcription is not available on this API/)).toBeInTheDocument();
  });

  it('shows neither before health has answered', () => {
    dropzone(undefined);
    expect(screen.queryByRole('button', { name: 'Transcribe audio' })).not.toBeInTheDocument();
    expect(screen.queryByText(/not available/)).not.toBeInTheDocument();
  });
});
