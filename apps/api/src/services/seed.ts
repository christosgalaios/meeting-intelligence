import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileSlug } from '../transcript/slug.js';
import { ingestTranscript, type IngestDeps } from './ingest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/services and dist/services are both two levels below apps/api.
export const SEED_DIR = path.resolve(here, '../../seed/transcripts');

/** Idempotent: a transcript whose slug already exists is skipped. */
export async function seedTranscripts(deps: IngestDeps, dir = SEED_DIR): Promise<{ added: number; skipped: number }> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.txt')).sort();
  let added = 0;
  let skipped = 0;
  for (const file of files) {
    const { rows } = await deps.pool.query('SELECT 1 FROM meetings WHERE slug = $1', [fileSlug(file)]);
    if (rows.length > 0) {
      skipped++;
      continue;
    }
    await ingestTranscript(deps, { filename: file, text: await readFile(path.join(dir, file), 'utf8') });
    added++;
  }
  deps.log.info({ added, skipped }, 'seed.done');
  return { added, skipped };
}
