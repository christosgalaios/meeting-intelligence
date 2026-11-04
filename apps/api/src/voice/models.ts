import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Relative to VOICE_MODELS_DIR. The Dockerfile voice-models stage lays out exactly these. */
export const VOICE_MODEL_FILES = [
  'sherpa-onnx-pyannote-segmentation-3-0/model.onnx',
  'wespeaker_en_voxceleb_resnet34.onnx',
  'sherpa-onnx-whisper-base.en/base.en-encoder.int8.onnx',
  'sherpa-onnx-whisper-base.en/base.en-decoder.int8.onnx',
  'sherpa-onnx-whisper-base.en/base.en-tokens.txt',
] as const;

export const VOICE_MODELS_LABEL = 'sherpa-onnx pyannote-seg-3.0 + wespeaker-resnet34 + whisper-base.en-int8';

export function voiceModelsPresent(dir: string): boolean {
  return VOICE_MODEL_FILES.every((f) => existsSync(join(dir, f)));
}
