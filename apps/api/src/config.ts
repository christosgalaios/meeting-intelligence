import { z } from 'zod';

// Tuned from the retrieval eval, see apps/api/README.md. The spec's starting guess was 0.55.
export const DEFAULT_RETRIEVAL_MIN_SCORE = 0.58;

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1).default('postgres://meetings:meetings@localhost:5432/meetings'),
  // Empty string counts as unset so `ANTHROPIC_API_KEY=` in .env and compose means retrieval-only.
  ANTHROPIC_API_KEY: z.string().optional().transform((v) => (v && v.trim() !== '' ? v.trim() : undefined)),
  PORT: z.coerce.number().int().positive().default(3001),
  RETRIEVAL_MIN_SCORE: z.coerce.number().min(0).max(1).default(DEFAULT_RETRIEVAL_MIN_SCORE),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Voice transcription is on only when this points at a directory holding the models (compose sets /models/voice).
  VOICE_MODELS_DIR: z.string().optional().transform((v) => (v && v.trim() !== '' ? v.trim() : undefined)),
  VOICE_MAX_SECONDS: z.coerce.number().int().positive().default(1800),
  VOICE_THREADS: z.coerce.number().int().positive().default(2),
  VOICE_MAX_QUEUE: z.coerce.number().int().positive().default(4),
  SEED_ON_START: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  // The localhost default is for development only; a production process must be told where its database is.
  if (source.NODE_ENV === 'production' && !source.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when NODE_ENV=production');
  }
  return ConfigSchema.parse(source);
}
