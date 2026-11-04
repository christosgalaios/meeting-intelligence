// Decodes any audio file the browser can play into 16 kHz mono 16-bit WAV, the one format the API accepts. Doing it
// here keeps ffmpeg out of the API image. Nothing is uploaded until this has succeeded.
export const TARGET_RATE = 16000;
/** Mirrors VOICE_MAX_SECONDS on the API: 30 minutes. The API enforces it too. */
export const MAX_AUDIO_SECONDS = 1800;

export class AudioTooLong extends Error {
  readonly seconds: number;
  constructor(seconds: number) {
    super(`That recording is ${Math.ceil(seconds / 60)} minutes; the limit is ${MAX_AUDIO_SECONDS / 60}.`);
    this.name = 'AudioTooLong';
    this.seconds = seconds;
  }
}

export class AudioUndecodable extends Error {
  constructor() {
    super('Your browser could not decode this file. Convert it to MP3, M4A or WAV and try again.');
    this.name = 'AudioUndecodable';
  }
}

/** Average the channels, then resample by linear interpolation if the decoder did not already give 16 kHz. */
export function toMono16k(channels: Float32Array[], rate: number): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  let mono: Float32Array;
  if (channels.length === 1) mono = first;
  else {
    mono = new Float32Array(first.length);
    for (const ch of channels) for (let i = 0; i < mono.length; i++) mono[i]! += ch[i]! / channels.length;
  }
  if (rate === TARGET_RATE) return mono;
  const out = new Float32Array(Math.floor((mono.length * TARGET_RATE) / rate));
  const ratio = rate / TARGET_RATE;
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos);
    const frac = pos - j;
    out[i] = mono[j]! * (1 - frac) + (mono[Math.min(j + 1, mono.length - 1)] ?? 0) * frac;
  }
  return out;
}

/** RIFF header plus little-endian int16 samples, clamped to the int16 range. */
export function encodeWavPcm16(samples: Float32Array, rate = TARGET_RATE): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // integer PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, Math.round(x < 0 ? x * 32768 : x * 32767), true);
  }
  return buf;
}

export async function decodeToWav16k(file: File): Promise<{ blob: Blob; seconds: number }> {
  // An offline context decodes at its own rate (16 kHz), so a 30 minute stereo file is not first expanded to 48 kHz.
  let decoded: AudioBuffer;
  try {
    const ctx = new OfflineAudioContext(1, 1, TARGET_RATE);
    decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new AudioUndecodable();
  }
  const seconds = decoded.length / decoded.sampleRate;
  if (seconds > MAX_AUDIO_SECONDS) throw new AudioTooLong(seconds);
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  const samples = toMono16k(channels, decoded.sampleRate);
  return { blob: new Blob([encodeWavPcm16(samples)], { type: 'audio/wav' }), seconds };
}
