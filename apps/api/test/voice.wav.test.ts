import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import { encodeWav, parseWav, wavToFloat32 } from '../src/voice/wav.js';

const tone = (seconds: number) => {
  const s = new Int16Array(Math.round(seconds * 16000));
  for (let i = 0; i < s.length; i++) s[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / 16000) * 12000);
  return s;
};

/** Builds a WAV from raw chunks so each test can break exactly one thing. */
function riff(chunks: Array<[string, Buffer]>, form = 'WAVE', magic = 'RIFF'): Buffer {
  const parts = chunks.map(([id, body]) => {
    const head = Buffer.alloc(8);
    head.write(id, 0, 'ascii');
    head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  });
  const head = Buffer.alloc(12);
  head.write(magic, 0, 'ascii');
  head.writeUInt32LE(4 + parts.reduce((n, p) => n + p.length, 0), 4);
  head.write(form, 8, 'ascii');
  return Buffer.concat([head, ...parts]);
}

function fmt(over: { tag?: number; channels?: number; rate?: number; bits?: number } = {}): Buffer {
  const b = Buffer.alloc(16);
  b.writeUInt16LE(over.tag ?? 1, 0);
  b.writeUInt16LE(over.channels ?? 1, 2);
  b.writeUInt32LE(over.rate ?? 16000, 4);
  b.writeUInt32LE((over.rate ?? 16000) * 2, 8);
  b.writeUInt16LE(2, 12);
  b.writeUInt16LE(over.bits ?? 16, 14);
  return b;
}

const pcm = (n: number) => Buffer.alloc(n * 2, 1);

function rejects(buf: Buffer, message: RegExp) {
  try {
    parseWav(buf);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(422);
    expect((err as AppError).code).toBe('UNPROCESSABLE');
    expect((err as AppError).message).toMatch(message);
    return;
  }
  throw new Error('expected parseWav to throw');
}

describe('parseWav', () => {
  it('round-trips encodeWav for one second of a 440 Hz tone', () => {
    const samples = tone(1);
    const parsed = parseWav(encodeWav(samples));
    expect(parsed).toMatchObject({ sampleRate: 16000, channels: 1, bitsPerSample: 16 });
    expect(parsed.samples.length).toBe(16000);
    expect(Array.from(parsed.samples)).toEqual(Array.from(samples));
  });

  it('accepts a LIST chunk before data, including an odd-sized one that needs a pad byte', () => {
    const buf = riff([['fmt ', fmt()], ['LIST', Buffer.from('INFOabc')], ['data', pcm(100)]]);
    expect(parseWav(buf).samples.length).toBe(100);
  });

  it('reads samples when the data chunk sits at an odd byte offset', () => {
    const buf = riff([['fmt ', fmt()], ['JUNK', Buffer.alloc(3)], ['data', pcm(10)]]);
    expect(parseWav(buf).samples.length).toBe(10);
  });

  it('rejects input that is not RIFF', () => rejects(Buffer.from('definitely not audio, just some text'), /no RIFF header/));
  it('rejects RIFF that is not WAVE', () => rejects(riff([['fmt ', fmt()], ['data', pcm(10)]], 'AVI '), /not WAVE/));
  it('rejects a file with no fmt chunk', () => rejects(riff([['data', pcm(10)]]), /no fmt chunk/));
  it('rejects a file with no data chunk', () => rejects(riff([['fmt ', fmt()]]), /no data chunk/));
  it('rejects float PCM and names the format tag', () => rejects(riff([['fmt ', fmt({ tag: 3 })], ['data', pcm(10)]]), /format tag is 3/));
  it('rejects 44.1 kHz and says so', () => rejects(riff([['fmt ', fmt({ rate: 44100 })], ['data', pcm(10)]]), /got 44100 Hz mono 16-bit/));
  it('rejects stereo and says so', () => rejects(riff([['fmt ', fmt({ channels: 2 })], ['data', pcm(10)]]), /got 16000 Hz stereo 16-bit/));
  it('rejects 8-bit', () => rejects(riff([['fmt ', fmt({ bits: 8 })], ['data', pcm(10)]]), /8-bit/));
  it('rejects an odd data length', () => rejects(riff([['fmt ', fmt()], ['data', Buffer.alloc(7)]]), /whole number of 16-bit samples/));
  it('rejects zero-length data', () => rejects(riff([['fmt ', fmt()], ['data', Buffer.alloc(0)]]), /no audio/));

  it('rejects a data chunk that claims more bytes than the file has', () => {
    const buf = riff([['fmt ', fmt()], ['data', pcm(100)]]);
    rejects(buf.subarray(0, buf.length - 50), /truncated/);
  });
});

describe('wavToFloat32', () => {
  it('maps the int16 range onto -1..1', () => {
    const f = wavToFloat32(Int16Array.from([-32768, 0, 32767]));
    expect(f[0]).toBe(-1);
    expect(f[1]).toBe(0);
    expect(f[2]).toBeCloseTo(1, 4);
  });
});
