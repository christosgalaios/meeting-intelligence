import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioTooLong, AudioUndecodable, MAX_AUDIO_SECONDS, decodeToWav16k, encodeWavPcm16, toMono16k } from '../lib/audio';

afterEach(() => vi.unstubAllGlobals());

const ascii = (v: DataView, at: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(at + i)));

describe('encodeWavPcm16', () => {
  it('writes a 16 kHz mono 16-bit PCM header with consistent sizes', () => {
    const v = new DataView(encodeWavPcm16(new Float32Array(100)));
    expect(v.byteLength).toBe(44 + 200);
    expect(ascii(v, 0, 4)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(36 + 200);
    expect(ascii(v, 8, 8)).toBe('WAVEfmt ');
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000);
    expect(v.getUint16(32, true)).toBe(2);
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(v, 36, 4)).toBe('data');
    expect(v.getUint32(40, true)).toBe(200);
  });

  it('clamps out-of-range samples and maps full scale to the int16 extremes', () => {
    const v = new DataView(encodeWavPcm16(Float32Array.from([1.5, -1.5, 1, -1, 0, 0.5])));
    expect([0, 1, 2, 3, 4, 5].map((i) => v.getInt16(44 + i * 2, true))).toEqual([32767, -32768, 32767, -32768, 0, 16384]);
  });
});

describe('toMono16k', () => {
  it('averages stereo channels', () => {
    const out = toMono16k([Float32Array.from([1, 0.5]), Float32Array.from([-1, 0.5])], 16000);
    expect(Array.from(out)).toEqual([0, 0.5]);
  });

  it('resamples 48 kHz to a third of the length when the decoder ignored the 16 kHz request', () => {
    const out = toMono16k([new Float32Array(4800).fill(0.25)], 48000);
    expect(out.length).toBe(1600);
    expect(out[10]).toBeCloseTo(0.25, 6);
  });
});

function stubDecoder(buffer: Partial<AudioBuffer> | { reject: unknown }) {
  class FakeOffline {
    decodeAudioData() {
      return 'reject' in buffer ? Promise.reject(buffer.reject) : Promise.resolve(buffer);
    }
  }
  vi.stubGlobal('OfflineAudioContext', FakeOffline);
}

const file = () => new File([new Uint8Array([1, 2, 3])], 'standup.m4a', { type: 'audio/mp4' });
const canned = (seconds: number, channels = 1): Partial<AudioBuffer> => ({
  length: seconds * 16000,
  sampleRate: 16000,
  numberOfChannels: channels,
  getChannelData: () => new Float32Array(seconds * 16000).fill(0.1),
});

describe('decodeToWav16k', () => {
  it('returns a WAV blob and the duration', async () => {
    stubDecoder(canned(2, 2));
    const { blob, seconds } = await decodeToWav16k(file());
    expect(seconds).toBe(2);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + 2 * 16000 * 2);
  });

  it('refuses a recording over 30 minutes before building any WAV', async () => {
    stubDecoder(canned(MAX_AUDIO_SECONDS + 60));
    await expect(decodeToWav16k(file())).rejects.toBeInstanceOf(AudioTooLong);
    await expect(decodeToWav16k(file())).rejects.toThrow('That recording is 31 minutes; the limit is 30.');
  });

  it('accepts exactly 30 minutes', async () => {
    stubDecoder(canned(MAX_AUDIO_SECONDS));
    await expect(decodeToWav16k(file())).resolves.toMatchObject({ seconds: MAX_AUDIO_SECONDS });
  });

  it('reports an undecodable file with advice', async () => {
    stubDecoder({ reject: new DOMException('bad', 'EncodingError') });
    await expect(decodeToWav16k(file())).rejects.toBeInstanceOf(AudioUndecodable);
    await expect(decodeToWav16k(file())).rejects.toThrow(/Convert it to MP3, M4A or WAV/);
  });
});
