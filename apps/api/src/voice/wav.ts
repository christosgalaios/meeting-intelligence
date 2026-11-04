import { AppError } from '../errors.js';

export const WAV_SAMPLE_RATE = 16000;

export interface ParsedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  samples: Int16Array;
}

const reject = (message: string) => new AppError('UNPROCESSABLE', message);

/**
 * Parses the one format the API accepts: 16 kHz, mono, 16-bit PCM. Walks the chunks instead of assuming a 44-byte
 * header, because encoders legally put LIST/INFO chunks before `data`. Throws a 422 that says what was found.
 */
export function parseWav(buf: Buffer): ParsedWav {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF') throw reject('This is not a WAV file (no RIFF header).');
  if (buf.toString('ascii', 8, 12) !== 'WAVE') throw reject('This is not a WAV file (RIFF but not WAVE).');

  let fmt: { tag: number; channels: number; sampleRate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const start = pos + 8;
    if (id === 'fmt ') {
      if (size < 16 || start + 16 > buf.length) throw reject('The WAV fmt chunk is truncated.');
      fmt = {
        tag: buf.readUInt16LE(start),
        channels: buf.readUInt16LE(start + 2),
        sampleRate: buf.readUInt32LE(start + 4),
        bits: buf.readUInt16LE(start + 14),
      };
    } else if (id === 'data') {
      if (start + size > buf.length) throw reject('The WAV data chunk is longer than the file; the upload looks truncated.');
      data = buf.subarray(start, start + size);
      break;
    }
    pos = start + size + (size % 2); // chunks are word-aligned
  }

  if (!fmt) throw reject('The WAV file has no fmt chunk.');
  if (!data) throw reject('The WAV file has no data chunk.');
  if (fmt.tag !== 1) throw reject(`Expected 16-bit PCM WAV; the format tag is ${fmt.tag} (not integer PCM).`);
  if (fmt.sampleRate !== WAV_SAMPLE_RATE || fmt.channels !== 1 || fmt.bits !== 16) {
    const layout = fmt.channels === 1 ? 'mono' : fmt.channels === 2 ? 'stereo' : `${fmt.channels} channels`;
    throw reject(`Expected a 16 kHz mono 16-bit PCM WAV; got ${fmt.sampleRate} Hz ${layout} ${fmt.bits}-bit.`);
  }
  if (data.length === 0) throw reject('The WAV file contains no audio.');
  if (data.length % 2 !== 0) throw reject('The WAV data length is not a whole number of 16-bit samples.');

  // Copy rather than view: a Buffer slice may sit at an odd offset, which an Int16Array cannot be built over.
  const samples = new Int16Array(data.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2);
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bits, samples };
}

export function wavToFloat32(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i]! / 32768;
  return out;
}

/** Used by tests and the smoke script; the server never writes audio. */
export function encodeWav(samples: Int16Array, sampleRate = WAV_SAMPLE_RATE): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i]!, 44 + i * 2);
  return buf;
}
