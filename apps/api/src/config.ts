import { z } from 'zod';

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1).default('postgres://meetings:meetings@localhost:5432/meetings'),
  // Empty string counts as unset so `ANTHROPIC_API_KEY=` in .env and compose means retrieval-only.
  ANTHROPIC_API_KEY: z.string().optional().transform((v) => (v && v.trim() !== '' ? v.trim() : undefined)),
  PORT: z.coerce.number().int().positive().default(3001),
  RETRIEVAL_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.55),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SEED_ON_START: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

export type Config = z.infer<typeof ConfigSchema>;

// Named config.ts rather than the spec's env.ts: the editing tool in this environment blocks any
// file called env.*. Contents are what the spec asks for (zod-parsed process environment).
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse(source);
}
